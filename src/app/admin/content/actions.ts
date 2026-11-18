"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { filteredIds, MAX_SELECTION, type LibraryFilters, type StatusFilter } from "@/server/content/library/list";
import { addSentence, addWord, copyItem, type AddResult, type CopyResult } from "@/server/content/library/create";
import { previewRemoval, removeItems, type RemovalSummary } from "@/server/content/library/remove";
import { contentStatuses, isLibrarySlug, statusActions, withoutLevel, type LibrarySlug, type StatusAction } from "@/server/content/library/slugs";
import { changeStatus, type StatusResult } from "@/server/content/library/status";
import { forgetContent } from "@/server/learn/content";
import { logError } from "@/server/errors";
import { appSetting } from "@/server/settings/read";

/** The chosen items: some ids, or everything the list's filter shows (across all its pages). */
export type Selection = { ids: number[] } | { filter: { level: string | null; status: string | null; incomplete: boolean; q: string } };

export type StatusOutcome = ({ state: "done" } & StatusResult) | { state: "failed" };

async function idsOf(slug: LibrarySlug, language: string, selection: Selection): Promise<number[]> {
  if ("ids" in selection) return [...new Set(selection.ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, MAX_SELECTION);
  const levels = await appSetting<string[]>(`levels.${language}`);
  const { level, status, incomplete, q } = selection.filter;
  const filters: LibraryFilters = {
    level: level && levels.includes(level) && !withoutLevel.has(slug) ? level : null,
    status: status === "suspended" || contentStatuses.includes(status as never) ? (status as StatusFilter) : null,
    incomplete: incomplete === true,
    q: String(q ?? "").trim().slice(0, 80),
    page: 1,
  };
  return filteredIds(slug, language, filters);
}

const valid = (slug: string, language: string): slug is LibrarySlug => isLibrarySlug(slug) && isLanguage(language);

/** Approve, back to draft, suspend, unsuspend, retire or bring back the chosen items (PRD §13.2). */
export async function applyStatus(slug: string, language: string, selection: Selection, action: StatusAction): Promise<StatusOutcome> {
  const admin = await requireAdmin();
  if (!valid(slug, language) || !statusActions.includes(action)) return { state: "failed" };
  try {
    const result = await changeStatus(slug, language, await idsOf(slug, language, selection), action, admin.id);
    revalidatePath("/admin", "layout");
    forgetContent();
    return { state: "done", ...result };
  } catch (error) {
    await logError("library.status", error, { userId: admin.id });
    return { state: "failed" };
  }
}

export type RemovalOutcome = { state: "preview" | "deleted" | "nothing"; summary: RemovalSummary } | { state: "failed" };

/** What deleting the chosen items would take with it; nothing changes. */
export async function previewDelete(slug: string, language: string, selection: Selection): Promise<RemovalOutcome> {
  const admin = await requireAdmin();
  if (!valid(slug, language)) return { state: "failed" };
  try {
    return { state: "preview", summary: await previewRemoval(slug, language, await idsOf(slug, language, selection)) };
  } catch (error) {
    await logError("library.previewDelete", error, { userId: admin.id });
    return { state: "failed" };
  }
}

/** Deletes the chosen items in any status, with what exists only for them; «برگردان» in the log undoes it. */
export async function deleteSelected(slug: string, language: string, selection: Selection): Promise<RemovalOutcome> {
  const admin = await requireAdmin();
  if (!valid(slug, language)) return { state: "failed" };
  try {
    const result = await removeItems(slug, language, await idsOf(slug, language, selection), admin.id);
    revalidatePath("/admin", "layout");
    forgetContent();
    return result;
  } catch (error) {
    await logError(`library.delete.${slug}`, error, { userId: admin.id });
    return { state: "failed" };
  }
}

export type AddOutcome = AddResult | { state: "failed" };

/** A word or phrase made by hand (owner's choice): a draft, opened next in its edit form. */
export async function addWordByHand(language: string, values: Record<string, unknown>): Promise<AddOutcome> {
  const admin = await requireAdmin();
  if (!isLanguage(language)) return { state: "failed" };
  try {
    const result = await addWord(language, values, admin.id);
    if (result.state === "added") revalidatePath("/admin", "layout");
    return result;
  } catch (error) {
    await logError("library.addWord", error, { userId: admin.id });
    return { state: "failed" };
  }
}

/** A practice sentence made by hand, with an optional blank on one word. */
export async function addSentenceByHand(language: string, values: Record<string, unknown>): Promise<AddOutcome> {
  const admin = await requireAdmin();
  if (!isLanguage(language)) return { state: "failed" };
  try {
    const result = await addSentence(language, values, admin.id);
    if (result.state === "added") revalidatePath("/admin", "layout");
    return result;
  } catch (error) {
    await logError("library.addSentence", error, { userId: admin.id });
    return { state: "failed" };
  }
}

/** «کپی از این مورد»: a new draft with the same content. */
export async function copyItemAction(slug: string, id: number): Promise<CopyResult | { state: "failed" }> {
  const admin = await requireAdmin();
  if (!isLibrarySlug(slug) || !Number.isInteger(id)) return { state: "gone" };
  try {
    const result = await copyItem(slug, id, admin.id);
    if (result.state === "copied") revalidatePath("/admin", "layout");
    return result;
  } catch (error) {
    await logError(`library.copy.${slug}`, error, { userId: admin.id });
    return { state: "failed" };
  }
}

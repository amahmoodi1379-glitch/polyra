"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { filteredIds, MAX_SELECTION, type LibraryFilters, type StatusFilter } from "@/server/content/library/list";
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

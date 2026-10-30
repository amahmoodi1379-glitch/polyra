"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { deleteItem as removeItem, type DeleteResult } from "@/server/content/library/delete";
import { editors } from "@/server/content/library/edit";
import { same } from "@/server/content/library/log";
import { suggestTokens, type TokenEdit } from "@/server/content/library/edit/tokens";
import { isLanguage } from "@/server/content/languages";
import type { FieldError } from "@/server/content/library/edit/types";
import { isLibrarySlug } from "@/server/content/library/slugs";
import { logError } from "@/server/errors";

export type SaveOutcome =
  | { state: "saved"; values: Record<string, unknown>; notes: string[] }
  | { state: "invalid"; errors: FieldError[] }
  | { state: "gone" }
  /** Someone else saved the item after this form was opened. */
  | { state: "changed" }
  | { state: "failed" };

/**
 * Saves one item's form (PRD §13.2, §13.7); the same rules as import apply. `base` is what the form
 * was opened on: when the item no longer loads the same, someone else saved it in between and this
 * save is refused instead of silently undoing theirs. The saved item comes back as it now loads.
 */
export async function saveItem(slug: string, id: number, values: Record<string, unknown>, base: Record<string, unknown>): Promise<SaveOutcome> {
  const admin = await requireAdmin();
  if (!isLibrarySlug(slug) || !Number.isInteger(id)) return { state: "gone" };
  try {
    const editor = editors[slug];
    const current = await editor.load(id);
    if (!current) return { state: "gone" };
    if (!same(current.values, base)) return { state: "changed" };
    const result = await editor.save(id, values, admin.id);
    if (result.state !== "saved") return result;
    revalidatePath("/admin", "layout");
    const after = await editor.load(id);
    return { state: "saved", values: (after ?? result).values as Record<string, unknown>, notes: result.notes };
  } catch (error) {
    await logError(`library.save.${slug}`, error, { userId: admin.id });
    return { state: "failed" };
  }
}

/** Deletes a draft for good (PRD §13.7: «حذف واقعی فقط برای draft ممکن است»). */
export async function deleteDraft(slug: string, id: number): Promise<DeleteResult | { state: "failed" }> {
  const admin = await requireAdmin();
  if (!isLibrarySlug(slug) || !Number.isInteger(id)) return { state: "gone" };
  try {
    const result = await removeItem(slug, id, admin.id);
    if (result.state === "deleted") revalidatePath("/admin", "layout");
    return result;
  } catch (error) {
    await logError(`library.delete.${slug}`, error, { userId: admin.id });
    return { state: "failed" };
  }
}

/** Word rows for a changed sentence: rows that still fit are kept, new pieces get the likeliest word. */
export async function suggestWords(language: string, text: string, previous: TokenEdit[]) {
  const admin = await requireAdmin();
  if (!isLanguage(language)) return null;
  try {
    return await suggestTokens(language, text.slice(0, 1000), previous.slice(0, 300));
  } catch (error) {
    await logError("library.suggestWords", error, { userId: admin.id });
    return null;
  }
}

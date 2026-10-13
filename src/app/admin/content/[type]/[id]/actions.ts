"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { deleteItem as removeItem, type DeleteResult } from "@/server/content/library/delete";
import { editors } from "@/server/content/library/edit";
import { suggestTokens, type TokenEdit } from "@/server/content/library/edit/tokens";
import { isLanguage } from "@/server/content/languages";
import type { FieldError } from "@/server/content/library/edit/types";
import { isLibrarySlug } from "@/server/content/library/slugs";
import { logError } from "@/server/errors";

export type SaveOutcome =
  | { state: "saved"; values: Record<string, unknown>; notes: string[] }
  | { state: "invalid"; errors: FieldError[] }
  | { state: "gone" }
  | { state: "failed" };

/** Saves one item's form (PRD §13.2, §13.7). The same rules as import apply. */
export async function saveItem(slug: string, id: number, values: Record<string, unknown>): Promise<SaveOutcome> {
  const admin = await requireAdmin();
  if (!isLibrarySlug(slug) || !Number.isInteger(id)) return { state: "gone" };
  try {
    const result = await editors[slug].save(id, values, admin.id);
    if (result.state === "saved") revalidatePath("/admin", "layout");
    return result as SaveOutcome;
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

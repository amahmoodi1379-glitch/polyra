"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { isLibrarySlug, statusActions, type StatusAction } from "@/server/content/library/slugs";
import { changeStatus, type StatusResult } from "@/server/content/library/status";
import { logError } from "@/server/errors";

export type StatusOutcome = ({ state: "done" } & StatusResult) | { state: "failed" };

/** Approve, back to draft, suspend, unsuspend or retire the chosen items (PRD §13.2). */
export async function applyStatus(slug: string, language: string, ids: number[], action: StatusAction): Promise<StatusOutcome> {
  const admin = await requireAdmin();
  if (!isLibrarySlug(slug) || !isLanguage(language) || !statusActions.includes(action)) return { state: "failed" };
  const clean = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 500);
  try {
    const result = await changeStatus(slug, language, clean, action, admin.id);
    revalidatePath("/admin", "layout");
    return { state: "done", ...result };
  } catch (error) {
    await logError("library.status", error, { userId: admin.id });
    return { state: "failed" };
  }
}

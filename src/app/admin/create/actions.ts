"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { createBatch, isKindSlug } from "@/server/content/batches";
import { isLanguage } from "@/server/content/languages";
import { logError } from "@/server/errors";

/** Step 1 begins: the panel picks the next batch of this kind and opens its page (PRD §13.9). */
export async function startBatch(form: FormData) {
  const admin = await requireAdmin();
  const slug = String(form.get("kind") ?? "");
  const language = String(form.get("language") ?? "");
  const level = String(form.get("level") ?? "") || undefined;
  if (!isKindSlug(slug) || !isLanguage(language)) redirect("/admin/create");

  let target: string;
  try {
    const made = await createBatch({ slug, language, options: { level }, adminId: admin.id });
    target = "id" in made ? `/admin/batches/${made.id}` : `/admin/create?lang=${language}`;
  } catch (error) {
    const code = await logError("create.startBatch", error, { userId: admin.id });
    target = `/admin/create?lang=${language}&error=${code}`;
  }
  redirect(target);
}

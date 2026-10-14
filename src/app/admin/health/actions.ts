"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { createBatch } from "@/server/content/batches";
import { isLanguage } from "@/server/content/languages";
import { logError } from "@/server/errors";

/** «ساخت جمله برای این کلمه‌ها» (PRD §13.11): opens the four-step path for P-S with exactly these words. */
export async function makeSentences(form: FormData) {
  const admin = await requireAdmin();
  const language = String(form.get("language") ?? "");
  const level = String(form.get("level") ?? "");
  const wordIds = String(form.get("words") ?? "")
    .split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 1000);
  if (!isLanguage(language)) redirect("/admin/health");
  const back = `/admin/health?lang=${language}${level ? `&level=${encodeURIComponent(level)}` : ""}`;
  if (wordIds.length === 0) redirect(back);

  let target: string;
  try {
    const made = await createBatch({ slug: "sentences", language, options: { wordIds }, adminId: admin.id });
    target = "id" in made ? `/admin/batches/${made.id}` : back;
  } catch (error) {
    const code = await logError("health.makeSentences", error, { userId: admin.id });
    target = `${back}&error=${code}`;
  }
  redirect(target);
}

"use server";

import { revalidatePath } from "next/cache";
import { t } from "@/i18n";
import { requireAdmin } from "@/server/auth/session";
import { isLanguage, languageInfo } from "@/server/content/languages";
import { setLanguageLive, setLevelRelease } from "@/server/content/publish/levels";
import { publishReady } from "@/server/content/publish/run";
import { logError } from "@/server/errors";

/** What a button on «انتشار» shows after it ran: a plain Persian line, good or bad. */
export type PublishOutcome = { ok: boolean; message: string };

const failed = (key: "admin.publish.items.failed" | "admin.publish.levels.failed"): PublishOutcome => ({ ok: false, message: t(key) });

/** «همه تأییدشده‌های آماده را منتشر کن» (PRD §13.5). */
export async function publishAction(language: string): Promise<PublishOutcome> {
  const admin = await requireAdmin();
  if (!isLanguage(language)) return failed("admin.publish.items.failed");
  try {
    const result = await publishReady(language, admin.id);
    revalidatePath("/admin", "layout");
    return result.published > 0 ? { ok: true, message: t("admin.publish.items.done", { count: result.published }) } : { ok: false, message: t("admin.publish.items.nothing") };
  } catch (error) {
    await logError("publish.items", error, { userId: admin.id });
    return failed("admin.publish.items.failed");
  }
}

/** Opens or closes a level; `confirmed` means the teacher saw the warnings. */
export async function releaseAction(language: string, level: string, open: boolean, confirmed: boolean): Promise<PublishOutcome> {
  const admin = await requireAdmin();
  if (!isLanguage(language)) return failed("admin.publish.levels.failed");
  try {
    const result = await setLevelRelease(language, level, open, confirmed, admin.id);
    revalidatePath("/admin", "layout");
    if (result.state === "done") return { ok: true, message: t(open ? "admin.publish.levels.opened" : "admin.publish.levels.closedDone", { level }) };
    return { ok: false, message: t(`admin.publish.levels.blocked.${result.reason}`) };
  } catch (error) {
    await logError("publish.level", error, { userId: admin.id });
    return failed("admin.publish.levels.failed");
  }
}

/** Shows or hides a language in the app. */
export async function liveAction(language: string, live: boolean): Promise<PublishOutcome> {
  const admin = await requireAdmin();
  if (!isLanguage(language)) return failed("admin.publish.levels.failed");
  try {
    const result = await setLanguageLive(language, live, admin.id);
    revalidatePath("/admin", "layout");
    const name = languageInfo[language].name_fa;
    if (result.state === "done") return { ok: true, message: t(live ? "admin.publish.language.shown" : "admin.publish.language.hidden", { language: name }) };
    return { ok: false, message: t("admin.publish.language.blocked") };
  } catch (error) {
    await logError("publish.language", error, { userId: admin.id });
    return failed("admin.publish.levels.failed");
  }
}

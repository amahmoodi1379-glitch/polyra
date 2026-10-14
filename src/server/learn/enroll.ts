import { languageCodes, type LanguageCode } from "@/server/content/languages";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { phoneHash } from "./access";
import type { Learner } from "./session";

/**
 * Starting a language (PRD §3.1): which languages a learner may pick, the session length and the
 * enrollment made by «از صفر شروع می‌کنم». Placement comes in a later phase.
 */

export const SESSION_LENGTHS = [10, 15, 20, 30] as const;

/** Live languages; a tester or an admin sees every language (PRD §13.5). */
export async function learnerLanguages(user: Learner): Promise<LanguageCode[]> {
  if (user.is_admin || user.is_tester) return [...languageCodes];
  const live = await db.language.findMany({ where: { live: true }, select: { code: true } });
  return languageCodes.filter((code) => live.some((row) => row.code === code));
}

export async function enrollments(userId: number) {
  return db.enrollment.findMany({ where: { user_id: userId }, orderBy: { created_at: "asc" }, select: { language: true, created_at: true } });
}

/** «از صفر شروع می‌کنم»: the enrollment and the four skills at the lowest level (PRD §3.1, §10.3). */
export async function startFromZero(user: Learner & { phone: string | null }, language: LanguageCode, now = new Date()) {
  const levels = await appSetting<string[]>(`levels.${language}`);
  const lowest = levels[0];
  const used = user.phone ? await db.trialLedger.findUnique({ where: { phone_hash_language: { phone_hash: phoneHash(user.phone), language } }, select: { id: true } }) : null;
  await db.$transaction(async (tx) => {
    const found = await tx.enrollment.findUnique({ where: { user_id_language: { user_id: user.id, language } }, select: { id: true } });
    if (found) return;
    // A number that already had this language's free period gets none (PRD §12.1).
    await tx.enrollment.create({ data: { user_id: user.id, language, start_mode: "zero", ...(used ? { trial_started_at: now, trial_ends_at: now } : {}) } });
    for (const skill of ["vocab", "grammar", "listening", "reading"] as const) {
      await tx.skillLevel.upsert({
        where: { user_id_language_skill: { user_id: user.id, language, skill } },
        create: { user_id: user.id, language, skill, level: lowest, known_below: lowest },
        update: {},
      });
    }
  });
}

export async function setSessionLength(userId: number, minutes: number) {
  if (!SESSION_LENGTHS.includes(minutes as (typeof SESSION_LENGTHS)[number])) throw new Error(`Session length ${minutes} is not allowed`);
  await db.user.update({ where: { id: userId }, data: { session_length_min: minutes } });
}

/** «پاک کردن پیشرفت من در این زبان», for a tester (PRD §13.5): back to before the first session. */
export async function resetProgress(user: Learner, language: LanguageCode) {
  if (!user.is_tester && !user.is_admin) throw new Error("Only a tester can reset progress");
  const where = { user_id: user.id, language };
  await db.$transaction([
    db.reviewLog.deleteMany({ where }),
    db.session.deleteMany({ where }),
    db.itemState.deleteMany({ where }),
    db.notebookEntry.deleteMany({ where }),
    db.newWordQueue.deleteMany({ where }),
    db.dailyCounter.deleteMany({ where }),
    db.confusionPair.deleteMany({ where }),
    db.skillLevel.deleteMany({ where }),
    db.enrollment.deleteMany({ where }),
  ]);
}

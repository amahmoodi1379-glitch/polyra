import type { QuestionAnswer } from "@/engine/questions";
import { num } from "@/engine/settings";
import type { TextPartialE } from "@/engine/state";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { engineSettings } from "@/server/settings/read";
import type { Learner, StoredPlan } from "./session";

/**
 * Where a text stage stands while the learner is in it (PRD §7.4, «تلاش نیمه‌تمام»): the answers so
 * far, the plays used and the place in the sound. The browser sends it now and then; it is kept in
 * `text_state.partial` for `text.resume_hours`, and on the session's card so a reload goes on from it.
 */

export type TextProgress = { sessionId: string; cardId: string; answers: Record<string, QuestionAnswer>; plays: number; positionMs: number };

export async function saveTextProgress(user: Learner, progress: TextProgress, now = new Date()): Promise<"ok" | "gone"> {
  const settings = await engineSettings();
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM session WHERE id = ${progress.sessionId}::uuid FOR UPDATE`;
    const row = await tx.session.findUnique({ where: { id: progress.sessionId } });
    if (!row || row.user_id !== user.id || row.ended_at) return "gone";
    const plan = row.plan as unknown as StoredPlan;
    const card = plan.queue[0];
    if (!card || card.id !== progress.cardId || card.t !== "text" || !card.text) return "gone";
    const info = card.text;
    // Plays only go up: a lost note never gives plays back (PRD §7.4).
    const plays = Math.max(progress.plays, info.resume?.plays ?? 0);
    const partial: TextPartialE = {
      attempt: info.attempt,
      stage: info.stage,
      answers: progress.answers,
      plays,
      positionMs: Math.max(0, Math.round(progress.positionMs)),
      ...(info.borrowed ? { borrowed: true } : {}),
    };
    const until = new Date(now.getTime() + num(settings, "text.resume_hours") * 3_600_000);
    const json = partial as unknown as Prisma.InputJsonValue;
    await tx.textState.upsert({
      where: { user_id_text_id_track: { user_id: user.id, text_id: info.textId, track: info.track } },
      create: { user_id: user.id, text_id: info.textId, track: info.track, partial: json, partial_until: until },
      update: { partial: json, partial_until: until },
    });
    const queue = [{ ...card, text: { ...info, resume: partial } }, ...plan.queue.slice(1)];
    // The plan's own `textStates` keep their build-time value: grading starts from them (PRD §15.4).
    const stored: StoredPlan = { ...plan, queue };
    await tx.session.update({ where: { id: row.id }, data: { plan: stored as unknown as Prisma.InputJsonValue, last_answer_at: now } });
    return "ok";
  });
}

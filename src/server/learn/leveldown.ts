import { levelDownSkills } from "@/engine/leveldown";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { skillsOf } from "./learner";
import { learnContext, type EndSummary, type Learner, type StoredPlan } from "./session";

/**
 * «بله» on «یک سطح پایین‌تر برویم؟» (PRD §11.7): the offer kept in the session's end summary is applied
 * once. Vocabulary's level and known_below go one down and its cards stay; grammar's known level goes one
 * down so the next new unit is that level's first; a track's level goes one down.
 */
export async function acceptLevelDown(user: Learner, sessionId: string, now = new Date()): Promise<"done" | "gone"> {
  const first = await db.session.findUnique({ where: { id: sessionId }, select: { user_id: true, language: true } });
  if (!first || first.user_id !== user.id) return "gone";
  const ctx = await learnContext(user, first.language, now);
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM session WHERE id = ${sessionId}::uuid FOR UPDATE`;
    const row = await tx.session.findUniqueOrThrow({ where: { id: sessionId } });
    const plan = row.plan as unknown as StoredPlan;
    const message = plan.end?.message;
    if (!plan.end || message?.kind !== "leveldown" || message.applied) return "gone";
    const where = { user_id: user.id, language: row.language };
    const skills = levelDownSkills(skillsOf(await tx.skillLevel.findMany({ where }), ctx.content.levels[0]), message);
    const changed = skills.find((one) => one.skill === message.skill)!;
    const data = { level: changed.level, known_below: changed.knownBelow };
    await tx.skillLevel.upsert({ where: { user_id_language_skill: { ...where, skill: changed.skill } }, create: { ...where, skill: changed.skill, ...data }, update: data });
    const end: EndSummary = { ...plan.end, message: { ...message, applied: true } };
    await tx.session.update({ where: { id: sessionId }, data: { plan: { ...plan, end } as unknown as Prisma.InputJsonValue } });
    await tx.event.create({ data: { ...where, name: "leveldown", props: { skill: message.skill, from: message.from, to: message.to }, ts: now } });
    return "done";
  });
}

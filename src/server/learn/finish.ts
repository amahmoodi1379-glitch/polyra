import { hasCard, levelIndex } from "@/engine/content";
import { activeCards, isDue } from "@/engine/session/build";
import { num } from "@/engine/settings";
import { leftInARow, mayOfferShorter, pickSessionMessage, shorterLength, type ClosedSession } from "@/engine/messages";
import { finishDay } from "@/engine/streak";
import { addDays, tehranDate, tehranDayStart } from "@/engine/time";
import type { Enrollment, Prisma, Session } from "@/generated/prisma/client";
import { SESSION_LENGTHS } from "./enroll";
import { asDate, dailyOf, dateOnly, enrollmentOf, itemStateOf, skillsOf } from "./learner";
import { closeSession, startInfo, type EndMessage, type EndSummary, type LearnContext, type StoredPlan } from "./session";

/**
 * The end of a finished session (PRD §3.9): the streak and its freezes, skill levels (texts too, §7.5), the station
 * passed, the can-do line and tomorrow's reviews. Runs in the transaction of the last answer.
 */

type Tx = Prisma.TransactionClient;

export async function finishSession(tx: Tx, row: Session, plan: StoredPlan, ctx: LearnContext, at: Date): Promise<EndSummary> {
  const { content, settings } = ctx;
  const today = tehranDate(at);
  const where = { user_id: row.user_id, language: row.language };
  await closeSession(row, "finished", at, ctx, tx);

  // Streak (PRD §3.9): every scope but «تمرین بیشتر» counts.
  const enrollment = await tx.enrollment.findUniqueOrThrow({ where: { user_id_language: where } });
  const streak = plan.scope !== "extra" ? await countStreakDay(tx, enrollment, today, settings) : { counted: false, count: enrollment.streak_count, freezeEarned: false, freezes: enrollment.freeze_count };

  // Skill levels moved when the session closed (PRD §9.6, §6.2); read them back for the station.
  const [itemRows, skillRows, daily, logs] = await Promise.all([
    tx.itemState.findMany({ where }),
    tx.skillLevel.findMany({ where }),
    tx.dailyCounter.findUnique({ where: { user_id_language_date_tehran: { ...where, date_tehran: asDate(today) } } }),
    tx.reviewLog.findMany({
      where: { session_id: row.id, item_type: "grammar_unit", step_after: { gte: 2 }, step_before: { lt: 2 } },
      orderBy: { ts: "desc" },
      select: { item_id: true },
    }),
  ]);
  const items = itemRows.map(itemStateOf);
  const skills = skillsOf(skillRows, content.levels[0]);
  const vocab = skills.find((skill) => skill.skill === "vocab")!;

  // A station passed in this session (PRD §3.9): vocabulary first.
  let station: EndSummary["station"] = null;
  if (plan.start) {
    const after = startInfo(content, { items, skills: [{ ...vocab, level: plan.start.vocab.level }, ...skills.filter((skill) => skill.skill !== "vocab")] }, settings);
    if (after.vocab.station > plan.start.vocab.station) {
      const size = num(settings, "station.words");
      const total = Math.ceil([...content.words.values()].filter((word) => hasCard(word) && word.level === plan.start!.vocab.level).length / size);
      station = { skill: "vocab", level: plan.start.vocab.level, number: after.vocab.station, total, count: after.vocab.station * size };
    } else if (after.grammar.level === plan.start.grammar.level && after.grammar.station > plan.start.grammar.station) {
      const size = num(settings, "station.units");
      const total = Math.ceil(content.units.filter((unit) => unit.level === plan.start!.grammar.level).length / size);
      station = { skill: "grammar", level: plan.start.grammar.level, number: after.grammar.station, total, count: after.grammar.station * size };
    }
  }

  // «حالا می‌توانی…»: the last unit of this session that reached step 2 and has a can-do line.
  const canDo = logs.map((log) => content.units.find((unit) => unit.id === log.item_id)?.canDoFa).find((line) => !!line) ?? null;

  const below = vocab.knownBelow ? levelIndex(content, vocab.knownBelow) : -1;
  const introduced = new Set(items.filter((item) => item.itemType === "word").map((item) => item.itemId));
  let knownWords = 0;
  for (const word of content.words.values()) if (hasCard(word) && (introduced.has(word.id) || levelIndex(content, word.level) < below)) knownWords++;

  const tomorrow = addDays(today, 1);
  const active = activeCards(content);
  const dueTomorrow = items.filter((item) => isDue(item, tehranDayStart(tomorrow), tomorrow) && active(item)).length;
  const counts = dailyOf(daily, today);

  const message = await endMessage(tx, row, enrollment, ctx, at);

  const end: EndSummary = {
    correct: plan.counters.correct,
    wrong: plan.counters.wrong,
    newWordsToday: counts.newWords,
    newUnitsToday: counts.newUnits,
    knownWords,
    canDo,
    station,
    streak,
    tomorrow: dueTomorrow,
    message,
  };
  await tx.session.update({ where: { id: row.id }, data: { plan: { ...plan, end } as unknown as Prisma.InputJsonValue } });
  return end;
}

/**
 * Today counts in the streak (PRD §3.9): missed days covered by forgiveness or a freeze, or the streak
 * broken; a freeze earned for a full week. Also used by a finished weekly writing (PRD §8b.6).
 */
export async function countStreakDay(tx: Tx, enrollment: Enrollment, today: string, settings: LearnContext["settings"]): Promise<EndSummary["streak"]> {
  const before = enrollmentOf(enrollment);
  const where = { user_id: enrollment.user_id, language: enrollment.language };
  const since = [before.freezeCheckedWeek, before.streakLastDate].filter((date): date is string => !!date).sort()[0] ?? addDays(today, -14);
  const days = await tx.dailyCounter.findMany({ where: { ...where, date_tehran: { gte: asDate(addDays(since, -7)) } }, select: { date_tehran: true, active_sec: true } });
  const active = new Map(days.map((day) => [dateOnly(day.date_tehran)!, day.active_sec]));
  const done = finishDay(before, today, (date) => active.get(date) ?? 0, settings);
  await tx.enrollment.update({
    where: { id: enrollment.id },
    data: {
      streak_count: done.state.streakCount,
      streak_last_date: done.state.streakLastDate ? asDate(done.state.streakLastDate) : null,
      streak_forgiven_week: done.state.streakForgivenWeek ? asDate(done.state.streakForgivenWeek) : null,
      streak_forgiven_count: done.state.streakForgivenCount,
      freeze_count: done.state.freezeCount,
      freeze_checked_week: done.state.freezeCheckedWeek ? asDate(done.state.freezeCheckedWeek) : null,
    },
  });
  return { counted: true, count: done.state.streakCount, freezeEarned: done.event.freezeEarned > 0, freezes: done.state.freezeCount };
}

/**
 * The one message of this end screen (PRD §3.11), and the note that it was shown. Shorter sessions
 * follow sessions left in a row since the last time it was asked; «امروز وقت کم دارم» is not about the
 * session length, so it neither counts nor breaks the run (DECISIONS.md).
 */
async function endMessage(tx: Tx, row: Session, enrollment: Enrollment, ctx: LearnContext, at: Date): Promise<EndMessage | null> {
  const applying: EndMessage[] = [];
  if (mayOfferShorter(enrollment.shorten_asked_at, at, ctx.settings)) {
    const since = enrollment.shorten_asked_at ?? new Date(0);
    const previous = await tx.$queryRaw<ClosedSession[]>`
      SELECT end_reason AS "endReason", COALESCE((plan->>'doneCount')::int, 0) AS "doneCount", COALESCE((plan->>'plannedCount')::int, 0) AS "plannedCount"
      FROM session
      WHERE user_id = ${row.user_id} AND language = ${row.language} AND id <> ${row.id}::uuid AND ended_at IS NOT NULL
        AND scope <> 'quick' AND created_at < ${row.created_at} AND created_at > ${since}
      ORDER BY created_at DESC
      LIMIT ${num(ctx.settings, "abandon.sessions")}`;
    if (leftInARow(previous, ctx.settings)) {
      const user = await tx.user.findUniqueOrThrow({ where: { id: row.user_id }, select: { session_length_min: true } });
      applying.push({ kind: "shorter", from: user.session_length_min, to: shorterLength(user.session_length_min, SESSION_LENGTHS) });
    }
  }
  if (enrollment.slow_notice_due && enrollment.pace_mode === "slow") applying.push({ kind: "slowPace" });
  if (enrollment.phonics_off_due) applying.push({ kind: "phonicsOff" });

  const message = pickSessionMessage(applying);
  if (message) {
    const shown = { shorter: { shorten_asked_at: at }, slowPace: { slow_notice_due: false }, phonicsOff: { phonics_off_due: false } }[message.kind];
    await tx.enrollment.update({ where: { id: enrollment.id }, data: shown });
  }
  return message;
}

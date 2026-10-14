import { hasCard, levelIndex } from "@/engine/content";
import { grammarLevel, indexItems, vocabLevelUp } from "@/engine/levels";
import { isDue } from "@/engine/session/build";
import { num } from "@/engine/settings";
import { finishDay } from "@/engine/streak";
import { addDays, tehranDate, tehranDayStart } from "@/engine/time";
import type { Prisma, Session } from "@/generated/prisma/client";
import { asDate, dailyOf, dateOnly, enrollmentOf, itemStateOf, skillsOf } from "./learner";
import { closeSession, startInfo, type EndSummary, type LearnContext, type StoredPlan } from "./session";

/**
 * The end of a finished session (PRD §3.9): the streak and its freezes, skill levels, the station
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
  const before = enrollmentOf(enrollment);
  let streak = { counted: false, count: before.streakCount, freezeEarned: false, freezes: before.freezeCount };
  if (plan.scope !== "extra") {
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
    streak = { counted: true, count: done.state.streakCount, freezeEarned: done.event.freezeEarned > 0, freezes: done.state.freezeCount };
  }

  // Skill levels (PRD §9.6, §6.2).
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
  const index = indexItems(items);
  const skills = skillsOf(skillRows, content.levels[0]);
  const vocab = skills.find((skill) => skill.skill === "vocab")!;
  const up = vocabLevelUp(content, index, vocab, settings);
  if (up) {
    vocab.level = up;
    await tx.skillLevel.upsert({
      where: { user_id_language_skill: { ...where, skill: "vocab" } },
      create: { ...where, skill: "vocab", level: up, known_below: vocab.knownBelow },
      update: { level: up },
    });
  }
  const grammar = skills.find((skill) => skill.skill === "grammar")!;
  const reached = grammarLevel(content, index);
  if (levelIndex(content, reached) > levelIndex(content, grammar.level)) {
    grammar.level = reached;
    await tx.skillLevel.upsert({
      where: { user_id_language_skill: { ...where, skill: "grammar" } },
      create: { ...where, skill: "grammar", level: reached, known_below: grammar.knownBelow },
      update: { level: reached },
    });
  }

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
  const dueTomorrow = items.filter((item) => isDue(item, tehranDayStart(tomorrow), tomorrow)).length;
  const counts = dailyOf(daily, today);

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
  };
  await tx.session.update({ where: { id: row.id }, data: { plan: { ...plan, end } as unknown as Prisma.InputJsonValue } });
  return end;
}

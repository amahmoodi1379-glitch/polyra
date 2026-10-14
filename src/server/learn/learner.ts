import type { FsrsCard } from "@/engine/fsrs";
import { num, type Settings } from "@/engine/settings";
import {
  itemKey,
  type ConfusionE,
  type DailyE,
  type EnrollmentE,
  type ItemHistory,
  type ItemStateE,
  type LearnerSnapshot,
  type NotebookE,
  type QueueE,
  type SkillLevelE,
  type SkillName,
} from "@/engine/state";
import { addDays, tehranDayStart } from "@/engine/time";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

/**
 * What the engine knows about one learner in one language (`LearnerSnapshot`), read from the
 * database in a few queries: states, notebook, queue, today's counters, confusions, and what the
 * answer log says about exercises and sentences already seen.
 */

type Client = Prisma.TransactionClient | typeof db;

/** A `@db.Date` column as the Tehran date string the engine uses. */
export const dateOnly = (value: Date | null): string | null => (value ? value.toISOString().slice(0, 10) : null);
export const asDate = (date: string) => new Date(`${date}T00:00:00Z`);

/** How many recent sentences of an item are kept (the round rule looks at three rounds of five). */
const RECENT_SENTENCES = 15;

export function enrollmentOf(row: {
  language: string;
  start_mode: "zero" | "placement" | null;
  pace_mode: "normal" | "slow";
  last_spread_date: Date | null;
  phonics_auto: boolean;
  streak_count: number;
  streak_last_date: Date | null;
  streak_forgiven_week: Date | null;
  streak_forgiven_count: number;
  freeze_count: number;
  freeze_checked_week: Date | null;
}): EnrollmentE {
  return {
    language: row.language,
    startMode: row.start_mode,
    paceMode: row.pace_mode,
    lastSpreadDate: dateOnly(row.last_spread_date),
    phonicsAuto: row.phonics_auto,
    streakCount: row.streak_count,
    streakLastDate: dateOnly(row.streak_last_date),
    streakForgivenWeek: dateOnly(row.streak_forgiven_week),
    streakForgivenCount: row.streak_forgiven_count,
    freezeCount: row.freeze_count,
    freezeCheckedWeek: dateOnly(row.freeze_checked_week),
  };
}

export function itemStateOf(row: {
  item_type: "word" | "grammar_unit" | "conjugation";
  item_id: number;
  step: number;
  fsrs: Prisma.JsonValue;
  probation: "none" | "single" | "sample";
  source: ItemStateE["source"];
  introduced_at: Date | null;
  first_review_done: boolean;
  typed_once: boolean;
  deferred_until: Date | null;
  frozen: boolean;
  near_streak: number;
  fail_count: number;
  rounds_count: number;
}): ItemStateE {
  return {
    itemType: row.item_type,
    itemId: row.item_id,
    step: row.step,
    fsrs: row.fsrs as FsrsCard,
    probation: row.probation,
    source: row.source,
    introducedAt: row.introduced_at?.toISOString() ?? null,
    firstReviewDone: row.first_review_done,
    typedOnce: row.typed_once,
    deferredUntil: row.deferred_until?.toISOString() ?? null,
    frozen: row.frozen,
    nearStreak: row.near_streak,
    failCount: row.fail_count,
    roundsCount: row.rounds_count,
  };
}

/** The columns of an item state, for an insert or an update. */
export function itemStateRow(state: ItemStateE) {
  return {
    step: state.step,
    fsrs: state.fsrs as unknown as Prisma.InputJsonValue,
    probation: state.probation,
    source: state.source,
    introduced_at: state.introducedAt ? new Date(state.introducedAt) : null,
    first_review_done: state.firstReviewDone,
    typed_once: state.typedOnce,
    deferred_until: state.deferredUntil ? new Date(state.deferredUntil) : null,
    frozen: state.frozen,
    near_streak: state.nearStreak,
    fail_count: state.failCount,
    rounds_count: state.roundsCount,
  };
}

export const notebookOf = (row: {
  ref_type: NotebookE["refType"];
  ref_id: number;
  added_at: Date;
  until: Date;
  correct_count: number;
  last_correct_date: Date | null;
}): NotebookE => ({
  refType: row.ref_type,
  refId: row.ref_id,
  addedAt: row.added_at.toISOString(),
  until: row.until.toISOString(),
  correctCount: row.correct_count,
  lastCorrectDate: dateOnly(row.last_correct_date),
});

export const confusionOf = (row: { word_id: number; other_word_id: number; count: number; last_at: Date; card_shown_at: Date | null }): ConfusionE => ({
  wordId: row.word_id,
  otherWordId: row.other_word_id,
  count: row.count,
  lastAt: row.last_at.toISOString(),
  cardShownAt: row.card_shown_at?.toISOString() ?? null,
});

export function dailyOf(
  row: { new_words: number; words_cap_today: number | null; cap_prompt_shown: boolean; queue_words: number; new_units: number; new_conj: number; active_sec: number } | null,
  today: string,
): DailyE {
  return {
    date: today,
    newWords: row?.new_words ?? 0,
    wordsCapToday: row?.words_cap_today ?? null,
    capPromptShown: row?.cap_prompt_shown ?? false,
    queueWords: row?.queue_words ?? 0,
    newUnits: row?.new_units ?? 0,
    newConj: row?.new_conj ?? 0,
    activeSec: row?.active_sec ?? 0,
  };
}

const keyOf = (type: string | null, id: number | null) =>
  type && id !== null && (type === "word" || type === "grammar_unit" || type === "conjugation") ? itemKey(type, id) : null;

/** The learner's skill levels; a skill without a row starts at the lowest level (PRD §10.3). */
export function skillsOf(rows: { skill: SkillName; level: string; known_below: string | null }[], lowest: string): SkillLevelE[] {
  const skills: SkillName[] = ["vocab", "grammar", "listening", "reading"];
  return skills.map((skill) => {
    const row = rows.find((item) => item.skill === skill);
    return { skill, level: row?.level ?? lowest, knownBelow: row ? row.known_below : lowest };
  });
}

export async function loadLearner(
  client: Client,
  userId: number,
  language: string,
  lowestLevel: string,
  now: Date,
  today: string,
  settings: Settings,
): Promise<LearnerSnapshot | null> {
  const where = { user_id: userId, language };
  const [user, enrollment, skills, items, notebook, queue, daily, confusions] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { session_length_min: true } }),
    client.enrollment.findUnique({ where: { user_id_language: { user_id: userId, language } } }),
    client.skillLevel.findMany({ where }),
    client.itemState.findMany({ where }),
    client.notebookEntry.findMany({ where, orderBy: { added_at: "asc" } }),
    client.newWordQueue.findMany({ where, orderBy: { added_at: "asc" } }),
    client.dailyCounter.findUnique({ where: { user_id_language_date_tehran: { user_id: userId, language, date_tehran: asDate(today) } } }),
    client.confusionPair.findMany({ where }),
  ]);
  if (!user || !enrollment) return null;

  // What the answer log says (PRD §5.7, §9.2, §9.3, §9.10).
  const [counts, recent, seen, latency, pace, touched] = await Promise.all([
    client.$queryRaw<{ item_type: string; item_id: number; exercise_code: string; n: bigint }[]>`
      SELECT item_type, item_id, exercise_code, count(*) AS n FROM review_log
      WHERE user_id = ${userId} AND language = ${language} AND kind::text IN ('review', 'followup', 'practice') AND exercise_code IS NOT NULL AND item_id IS NOT NULL
      GROUP BY item_type, item_id, exercise_code`,
    client.$queryRaw<{ item_type: string; item_id: number; exercise_code: string | null; sentence_id: number | null }[]>`
      SELECT item_type, item_id, exercise_code, sentence_id FROM (
        SELECT item_type, item_id, exercise_code, sentence_id, ts, row_number() OVER (PARTITION BY item_type, item_id ORDER BY ts DESC, seq DESC NULLS LAST) AS rn
        FROM review_log WHERE user_id = ${userId} AND language = ${language} AND kind::text IN ('review', 'followup', 'practice') AND item_id IS NOT NULL
      ) last WHERE rn <= ${RECENT_SENTENCES} ORDER BY ts DESC, rn ASC`,
    client.$queryRaw<{ sentence_id: number; n: bigint }[]>`
      SELECT sentence_id, count(*) AS n FROM review_log
      WHERE user_id = ${userId} AND language = ${language} AND sentence_id IS NOT NULL AND kind::text <> 'intro'
      GROUP BY sentence_id`,
    client.$queryRaw<{ exercise_code: string; median: number; n: bigint }[]>`
      SELECT exercise_code, percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) AS median, count(*) AS n FROM review_log
      WHERE user_id = ${userId} AND language = ${language} AND latency_ms IS NOT NULL AND exercise_code IS NOT NULL AND kind::text IN ('review', 'followup', 'practice')
      GROUP BY exercise_code`,
    client.reviewLog.findMany({
      where: {
        user_id: userId,
        language,
        kind: "review",
        fsrs_rating: { not: null },
        first_typing: false,
        ts: { gte: new Date(now.getTime() - num(settings, "pace.window_days") * 86_400_000) },
      },
      select: { result: true },
    }),
    client.reviewLog.findMany({
      where: { user_id: userId, language, ts: { gte: tehranDayStart(today), lt: tehranDayStart(addDays(today, 1)) }, kind: { in: ["review", "followup", "practice", "intro"] } },
      select: { item_type: true, item_id: true },
      distinct: ["item_type", "item_id"],
    }),
  ]);

  const history = new Map<string, ItemHistory>();
  const historyOf = (key: string) => {
    let entry = history.get(key);
    if (!entry) history.set(key, (entry = { codeCounts: {}, lastCode: null, recentSentences: [] }));
    return entry;
  };
  for (const row of counts) {
    const key = keyOf(row.item_type, row.item_id);
    if (key) historyOf(key).codeCounts[row.exercise_code] = Number(row.n);
  }
  for (const row of recent) {
    const key = keyOf(row.item_type, row.item_id);
    if (!key) continue;
    const entry = historyOf(key);
    if (entry.lastCode === null && row.exercise_code) entry.lastCode = row.exercise_code;
    if (row.sentence_id !== null) entry.recentSentences.push(row.sentence_id);
  }

  return {
    userId,
    sessionLength: user.session_length_min,
    enrollment: enrollmentOf(enrollment),
    skills: skillsOf(skills, lowestLevel),
    items: items.map(itemStateOf),
    notebook: notebook.map(notebookOf),
    queue: queue.map((row): QueueE => ({ wordId: row.word_id, source: row.source, addedAt: row.added_at.toISOString() })),
    today: dailyOf(daily, today),
    confusions: confusions.map(confusionOf),
    history,
    sentenceSeen: new Map(seen.map((row) => [row.sentence_id, Number(row.n)])),
    latency: Object.fromEntries(latency.map((row) => [row.exercise_code, { median: Number(row.median), count: Number(row.n) }])),
    paceReviews: pace.map((row) => ({ ok: row.result === "correct" || row.result === "near", firstTyping: false })),
    recentIntroWordIds: items
      .filter((row) => row.item_type === "word" && row.introduced_at)
      .sort((a, b) => b.introduced_at!.getTime() - a.introduced_at!.getTime())
      .slice(0, 20)
      .map((row) => row.item_id),
    touchedToday: touched.map((row) => keyOf(row.item_type, row.item_id)).filter((key): key is string => !!key),
  };
}

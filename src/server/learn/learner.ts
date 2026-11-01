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
  type PhonicsStateE,
  type QueueE,
  type SkillLevelE,
  type SkillName,
  type TextPartialE,
  type TextScoreE,
  type TextStateE,
} from "@/engine/state";
import type { Track } from "@/engine/content";
import { addDays, tehranDayStart } from "@/engine/time";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

/**
 * What the engine knows about one learner in one language (`LearnerSnapshot`), read from the
 * database in a few queries: states, notebook, queue, today's counters, confusions, texts, and what
 * the answer log says about exercises and sentences already seen.
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
  phonics_done: boolean;
  phonics_skips: number;
  streak_count: number;
  streak_last_date: Date | null;
  streak_forgiven_week: Date | null;
  streak_forgiven_count: number;
  freeze_count: number;
  freeze_checked_week: Date | null;
  text_prompt_date: Date | null;
}): EnrollmentE {
  return {
    language: row.language,
    startMode: row.start_mode,
    paceMode: row.pace_mode,
    lastSpreadDate: dateOnly(row.last_spread_date),
    // Every lesson over: the rounds stop for good (PRD §8.4), even when a lesson is added later.
    phonicsAuto: row.phonics_auto && !row.phonics_done,
    phonicsSkips: row.phonics_skips,
    streakCount: row.streak_count,
    streakLastDate: dateOnly(row.streak_last_date),
    streakForgivenWeek: dateOnly(row.streak_forgiven_week),
    streakForgivenCount: row.streak_forgiven_count,
    freezeCount: row.freeze_count,
    freezeCheckedWeek: dateOnly(row.freeze_checked_week),
    textPromptDate: dateOnly(row.text_prompt_date),
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
  row: {
    new_words: number;
    words_cap_today: number | null;
    cap_prompt_shown: boolean;
    queue_words: number;
    new_units: number;
    new_conj: number;
    active_sec: number;
    new_text_sec_listening: number;
    new_text_sec_reading: number;
    text_session_done: boolean;
  } | null,
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
    newTextSec: { listening: row?.new_text_sec_listening ?? 0, reading: row?.new_text_sec_reading ?? 0 },
    textSessionDone: row?.text_session_done ?? false,
  };
}

type TextStateRow = {
  text_id: number;
  track: Track;
  attempts_done: number;
  first_score: number | null;
  scores: Prisma.JsonValue;
  last_attempt_at: Date | null;
  next_attempt_at: Date | null;
  partial: Prisma.JsonValue;
  partial_until: Date | null;
  used_in_test: boolean;
};

export const textStateOf = (row: TextStateRow): TextStateE => ({
  textId: row.text_id,
  track: row.track,
  attemptsDone: row.attempts_done,
  firstScore: row.first_score,
  scores: Array.isArray(row.scores) ? (row.scores as TextScoreE[]) : [],
  lastAttemptAt: row.last_attempt_at?.toISOString() ?? null,
  nextAttemptAt: row.next_attempt_at?.toISOString() ?? null,
  partial: row.partial && typeof row.partial === "object" ? (row.partial as TextPartialE) : null,
  partialUntil: row.partial_until?.toISOString() ?? null,
  usedInTest: row.used_in_test,
});

/** The columns of a text state, for an insert or an update. */
export const textStateRow = (state: TextStateE) => ({
  attempts_done: state.attemptsDone,
  first_score: state.firstScore,
  scores: state.scores as unknown as Prisma.InputJsonValue,
  last_attempt_at: state.lastAttemptAt ? new Date(state.lastAttemptAt) : null,
  next_attempt_at: state.nextAttemptAt ? new Date(state.nextAttemptAt) : null,
  partial: state.partial ? (state.partial as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
  partial_until: state.partialUntil ? new Date(state.partialUntil) : null,
  used_in_test: state.usedInTest,
});

/** A learner's text states in one language (`text_state` has no language of its own). */
export function loadTextStates(client: Client, userId: number, language: string): Promise<TextStateRow[]> {
  return client.$queryRaw<TextStateRow[]>`
    SELECT s.text_id, s.track::text AS track, s.attempts_done, s.first_score, s.scores, s.last_attempt_at, s.next_attempt_at, s.partial, s.partial_until, s.used_in_test
    FROM text_state s JOIN text t ON t.id = s.text_id WHERE s.user_id = ${userId} AND t.language = ${language}`;
}

/** A learner's phonics lessons in one language (`phonics_state` has no language of its own). */
export async function loadPhonicsStates(client: Client, userId: number, language: string): Promise<PhonicsStateE[]> {
  const rows = await client.$queryRaw<{ lesson_id: number; rounds_done: number; last_score: number | null; next_at: Date | null; done: boolean }[]>`
    SELECT s.lesson_id, s.rounds_done, s.last_score, s.next_at, s.done
    FROM phonics_state s JOIN phonics_lesson l ON l.id = s.lesson_id WHERE s.user_id = ${userId} AND l.language = ${language}`;
  return rows.map(phonicsStateOf);
}

export const phonicsStateOf = (row: { lesson_id: number; rounds_done: number; last_score: number | null; next_at: Date | null; done: boolean }): PhonicsStateE => ({
  lessonId: row.lesson_id,
  roundsDone: row.rounds_done,
  lastScore: row.last_score,
  nextAt: row.next_at?.toISOString() ?? null,
  done: row.done,
});

/** How many finished mixed sessions in a row, the newest first, had no text in them (PRD §10.11 condition 3). */
async function mixedWithoutText(client: Client, userId: number, language: string, settings: Settings): Promise<number> {
  const rows = await client.$queryRaw<{ had: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM review_log r WHERE r.session_id = s.id AND r.item_type = 'text' AND r.kind::text <> 'intro') AS had
    FROM session s WHERE s.user_id = ${userId} AND s.language = ${language} AND s.scope::text = 'mixed' AND s.end_reason::text = 'finished'
    ORDER BY s.ended_at DESC LIMIT ${num(settings, "text.session_every")}`;
  const first = rows.findIndex((row) => row.had);
  return first === -1 ? rows.length : first;
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
  const [counts, recent, seen, latency, pace, touched, drills, texts, withoutText, phonics] = await Promise.all([
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
      select: { fsrs_rating: true },
    }),
    client.reviewLog.findMany({
      where: { user_id: userId, language, ts: { gte: tehranDayStart(today), lt: tehranDayStart(addDays(today, 1)) }, kind: { in: ["review", "followup", "practice", "intro"] } },
      select: { item_type: true, item_id: true },
      distinct: ["item_type", "item_id"],
    }),
    client.$queryRaw<{ sentence_id: number; count: number; last_at: Date | null }[]>`
      SELECT d.sentence_id, d.count, d.last_at FROM sentence_drill_state d JOIN sentence s ON s.id = d.sentence_id
      WHERE d.user_id = ${userId} AND s.language = ${language}`,
    loadTextStates(client, userId, language),
    mixedWithoutText(client, userId, language, settings),
    loadPhonicsStates(client, userId, language),
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
    drills: drills.map((row) => ({ sentenceId: row.sentence_id, count: row.count, lastAt: row.last_at?.toISOString() ?? null })),
    texts: texts.map(textStateOf),
    phonics,
    mixedWithoutText: withoutText,
    history,
    sentenceSeen: new Map(seen.map((row) => [row.sentence_id, Number(row.n)])),
    latency: Object.fromEntries(latency.map((row) => [row.exercise_code, { median: Number(row.median), count: Number(row.n) }])),
    // A rating above «again» is a right or nearly right review; for a round it is the round's result, not its last question's (PRD §9.10).
    paceReviews: pace.map((row) => ({ ok: (row.fsrs_rating ?? 0) >= 2, firstTyping: false })),
    recentIntroWordIds: items
      .filter((row) => row.item_type === "word" && row.introduced_at)
      .sort((a, b) => b.introduced_at!.getTime() - a.introduced_at!.getTime())
      .slice(0, 20)
      .map((row) => row.item_id),
    touchedToday: touched.map((row) => keyOf(row.item_type, row.item_id)).filter((key): key is string => !!key),
  };
}

import { Prisma } from "@/generated/prisma/client";
import { num } from "@/engine/settings";
import { db } from "@/server/db";
import { engineSettings } from "@/server/settings/read";

/**
 * «یادگیری واقعی» (PRD §13.11): does a real learner remember? From graded answers in `review_log`, in one
 * language, optionally one level (the item's), between two dates. Testers and teachers are left out
 * unless asked for, so a teacher trying the app does not move the numbers.
 */

export type LearningFilter = { language: string; level: string | null; from: Date; to: Date; testers: boolean };

/** Intervals since the item's previous graded answer (PRD §13.11): 1 day, 2–7, 8–30, more than 30. */
export const INTERVALS = ["d1", "d2_7", "d8_30", "d31"] as const;
export type Interval = (typeof INTERVALS)[number];
export const STEPS = [1, 2, 3, 4, 5, 6] as const;

/** A cell's target is 85–90%; below 75% learners forget, above 95% they review too early (PRD §13.11). */
export const LOW_MARK = 0.75;
export const HIGH_MARK = 0.95;
/** Fewer answers than this say nothing yet: the cell is shown but not coloured. */
export const FEW = 20;

export type Cell = { n: number; ok: number };
export type CodeRow = { code: string; n: number; ok: number; idk: number; medianMs: number | null };
export type Pair = { a: string; b: string; count: number; people: number };
export type ProductionRow = { kind: "dialogue" | "errorfix"; id: number; title: string; n: number; ok: number };

const LEVEL_JOIN = Prisma.sql`
  LEFT JOIN "word" w ON r.item_type = 'word' AND w.id = r.item_id
  LEFT JOIN "grammar_unit" g ON r.item_type = 'grammar_unit' AND g.id = r.item_id
  LEFT JOIN "conjugation_table" c ON r.item_type = 'conjugation' AND c.id = r.item_id
  LEFT JOIN "word" cw ON cw.id = c.word_id`;
const LEVEL = Prisma.sql`COALESCE(w.level, g.level, cw.level)`;

/** Learners only, unless testers are asked for. */
const people = (filter: LearningFilter, column: Prisma.Sql) =>
  filter.testers ? Prisma.empty : Prisma.sql`AND ${column} IN (SELECT id FROM "user" WHERE NOT is_tester AND NOT is_admin)`;

/** Step × interval and the first review (PRD §13.11), from answers that rated the item in FSRS. */
async function memory(filter: LearningFilter) {
  const level = filter.level ? Prisma.sql`AND ${LEVEL} = ${filter.level}` : Prisma.empty;
  const rows = await db.$queryRaw<{ step: number; bucket: Interval | null; first: boolean; n: bigint; ok: bigint }[]>`
    WITH rated AS (
      SELECT r.user_id, r.item_type, r.item_id, r.kind, r.ts, r.result, r.step_before,
        LAG(r.ts) OVER (PARTITION BY r.user_id, r.item_type, r.item_id ORDER BY r.ts, r.seq) AS prev_ts,
        COUNT(*) FILTER (WHERE r.kind = 'review') OVER (PARTITION BY r.user_id, r.item_type, r.item_id ORDER BY r.ts, r.seq ROWS UNBOUNDED PRECEDING) AS reviews
      FROM "review_log" r
      WHERE r.language = ${filter.language} AND r.fsrs_rating IS NOT NULL AND r.ts < ${filter.to} ${people(filter, Prisma.sql`r.user_id`)}
    ),
    picked AS (
      SELECT r.*, EXTRACT(EPOCH FROM (r.ts - r.prev_ts)) / 86400.0 AS days
      FROM rated r ${LEVEL_JOIN}
      WHERE r.kind = 'review' AND r.ts >= ${filter.from} ${level}
    )
    SELECT GREATEST(1, LEAST(6, COALESCE(step_before, 1)))::int AS step,
      CASE WHEN days IS NULL THEN NULL WHEN days < 1.5 THEN 'd1' WHEN days < 7.5 THEN 'd2_7' WHEN days < 30.5 THEN 'd8_30' ELSE 'd31' END AS bucket,
      (reviews = 1) AS first,
      COUNT(*) AS n,
      COUNT(*) FILTER (WHERE result IN ('correct', 'near')) AS ok
    FROM picked GROUP BY 1, 2, 3`;
  const grid = Object.fromEntries(STEPS.map((step) => [step, Object.fromEntries(INTERVALS.map((bucket) => [bucket, { n: 0, ok: 0 }]))])) as Record<number, Record<Interval, Cell>>;
  const first: Cell = { n: 0, ok: 0 };
  for (const row of rows) {
    if (row.bucket) {
      grid[row.step][row.bucket].n += Number(row.n);
      grid[row.step][row.bucket].ok += Number(row.ok);
    }
    if (row.first) {
      first.n += Number(row.n);
      first.ok += Number(row.ok);
    }
  }
  return { grid, first };
}

/** Accuracy, «نمی‌دانم» and the median time of each exercise code (PRD §13.11). */
async function codes(filter: LearningFilter): Promise<CodeRow[]> {
  const level = filter.level ? Prisma.sql`AND ${LEVEL} = ${filter.level}` : Prisma.empty;
  const rows = await db.$queryRaw<{ code: string; n: bigint; ok: bigint; idk: bigint; median: number | null }[]>`
    SELECT r.exercise_code AS code, COUNT(*) AS n,
      COUNT(*) FILTER (WHERE r.result IN ('correct', 'near')) AS ok,
      COUNT(*) FILTER (WHERE r.result = 'idk') AS idk,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY r.latency_ms) AS median
    FROM "review_log" r ${LEVEL_JOIN}
    WHERE r.language = ${filter.language} AND r.ts >= ${filter.from} AND r.ts < ${filter.to}
      AND r.exercise_code IS NOT NULL AND r.result IN ('correct', 'near', 'wrong', 'idk')
      AND r.kind NOT IN ('placement', 'exam') ${level} ${people(filter, Prisma.sql`r.user_id`)}
    GROUP BY r.exercise_code ORDER BY r.exercise_code`;
  return rows.map((row) => ({ code: row.code, n: Number(row.n), ok: Number(row.ok), idk: Number(row.idk), medianMs: row.median === null ? null : Math.round(row.median) }));
}

/** Learners who practised in the period: how many are in slow pace, sticky words, and the pairs most mixed up (PRD §13.11). */
async function learners(filter: LearningFilter, leechAt: number) {
  const active = await db.$queryRaw<{ user_id: number }[]>`
    SELECT DISTINCT s.user_id FROM "session" s
    WHERE s.language = ${filter.language} AND s.created_at >= ${filter.from} AND s.created_at < ${filter.to} ${people(filter, Prisma.sql`s.user_id`)}`;
  const ids = active.map((row) => row.user_id);
  const [slow, freeze, sticky, pairs] = await Promise.all([
    db.enrollment.count({ where: { language: filter.language, user_id: { in: ids }, pace_mode: "slow" } }),
    db.enrollment.count({ where: { language: filter.language, user_id: { in: ids }, freeze_count: { gt: 0 } } }),
    db.itemState.count({ where: { language: filter.language, item_type: "word", user_id: { in: ids }, fail_count: { gte: leechAt } } }),
    ids.length === 0
      ? Promise.resolve([] as { a: number; b: number; count: bigint; people: bigint }[])
      : db.$queryRaw<{ a: number; b: number; count: bigint; people: bigint }[]>`
          SELECT LEAST(word_id, other_word_id) AS a, GREATEST(word_id, other_word_id) AS b, SUM(count) AS count, COUNT(DISTINCT user_id) AS people
          FROM "confusion_pair" WHERE language = ${filter.language} AND user_id IN (${Prisma.join(ids)}) AND count > 0
          GROUP BY 1, 2 ORDER BY 3 DESC, 4 DESC LIMIT 10`,
  ]);
  const lemmas = new Map((await db.word.findMany({ where: { id: { in: pairs.flatMap((pair) => [pair.a, pair.b]) } }, select: { id: true, lemma: true } })).map((row) => [row.id, row.lemma]));
  return {
    active: ids.length,
    slow,
    freeze,
    sticky,
    pairs: pairs.map((pair) => ({ a: lemmas.get(pair.a) ?? "?", b: lemmas.get(pair.b) ?? "?", count: Number(pair.count), people: Number(pair.people) })) as Pair[],
  };
}

/** «بگو، بعد بشنو» by level, dialogues and find-the-mistake by item, writing by week (PRD §13.11). */
async function production(filter: LearningFilter) {
  const level = (column: Prisma.Sql) => (filter.level ? Prisma.sql`AND ${column} = ${filter.level}` : Prisma.empty);
  const [speak, items, writing] = await Promise.all([
    db.$queryRaw<{ level: string; result: string; n: bigint }[]>`
      SELECT s.level, r.result::text AS result, COUNT(*) AS n FROM "review_log" r JOIN "sentence" s ON s.id = r.sentence_id
      WHERE r.language = ${filter.language} AND r.kind = 'self' AND r.ts >= ${filter.from} AND r.ts < ${filter.to} ${level(Prisma.sql`s.level`)} ${people(filter, Prisma.sql`r.user_id`)}
      GROUP BY 1, 2`,
    db.$queryRaw<{ kind: "dialogue" | "errorfix"; id: number; title: string; n: bigint; ok: bigint }[]>`
      SELECT r.kind::text AS kind, r.item_id AS id, COALESCE(d.title_fa, e.marked_text, '') AS title, COUNT(*) AS n, COUNT(*) FILTER (WHERE r.result = 'correct') AS ok
      FROM "review_log" r
      LEFT JOIN "dialogue" d ON r.kind = 'dialogue' AND d.id = r.item_id
      LEFT JOIN "errorfix_item" e ON r.kind = 'errorfix' AND e.id = r.item_id
      WHERE r.language = ${filter.language} AND r.kind IN ('dialogue', 'errorfix') AND r.ts >= ${filter.from} AND r.ts < ${filter.to}
        ${level(Prisma.sql`COALESCE(d.level, e.level)`)} ${people(filter, Prisma.sql`r.user_id`)}
      GROUP BY 1, 2, 3 ORDER BY 4 DESC LIMIT 200`,
    db.$queryRaw<{ week: Date; n: bigint }[]>`
      SELECT date_trunc('week', (w.created_at AT TIME ZONE 'Asia/Tehran') + interval '2 days') - interval '2 days' AS week, COUNT(*) AS n
      FROM "writing_entry" w JOIN "writing_task" t ON t.id = w.writing_task_id
      WHERE t.language = ${filter.language} AND w.created_at >= ${filter.from} AND w.created_at < ${filter.to} ${level(Prisma.sql`t.level`)} ${people(filter, Prisma.sql`w.user_id`)}
      GROUP BY 1 ORDER BY 1`,
  ]);
  const byLevel = new Map<string, { ok: number; near: number; no: number }>();
  for (const row of speak) {
    const line = byLevel.get(row.level) ?? { ok: 0, near: 0, no: 0 };
    if (row.result === "self_ok") line.ok += Number(row.n);
    else if (row.result === "self_near") line.near += Number(row.n);
    else line.no += Number(row.n);
    byLevel.set(row.level, line);
  }
  return {
    speak: [...byLevel.entries()].map(([lvl, line]) => ({ level: lvl, ...line })).sort((a, b) => a.level.localeCompare(b.level)),
    items: items.map((row) => ({ kind: row.kind, id: row.id, title: row.title.replace(/[{}]/g, ""), n: Number(row.n), ok: Number(row.ok) })) as ProductionRow[],
    writing: writing.map((row) => ({ week: row.week, n: Number(row.n) })),
  };
}

export const FUNNEL = ["signup", "firstSession", "day2", "day3", "trialEnd", "purchase"] as const;
export type FunnelStep = (typeof FUNNEL)[number];

/**
 * Where learners stop (PRD §13.11): of those who started this language in the period, how many closed a
 * first session, practised on a second and a third day, were still there in the last day of the free
 * period, and bought.
 */
async function funnel(filter: LearningFilter): Promise<Record<FunnelStep, number>> {
  const rows = await db.$queryRaw<{ signup: bigint; first: bigint; day2: bigint; day3: bigint; trial: bigint; purchase: bigint }[]>`
    WITH cohort AS (
      SELECT e.user_id, e.trial_ends_at FROM "enrollment" e
      WHERE e.language = ${filter.language} AND e.created_at >= ${filter.from} AND e.created_at < ${filter.to} ${people(filter, Prisma.sql`e.user_id`)}
    ),
    days AS (
      SELECT s.user_id, COUNT(DISTINCT (s.created_at AT TIME ZONE 'Asia/Tehran')::date) AS days, MAX(s.created_at) AS last_at,
        COUNT(*) FILTER (WHERE s.ended_at IS NOT NULL) AS closed
      FROM "session" s JOIN cohort c ON c.user_id = s.user_id WHERE s.language = ${filter.language} GROUP BY s.user_id
    )
    SELECT COUNT(*) AS signup,
      COUNT(*) FILTER (WHERE d.closed > 0) AS first,
      COUNT(*) FILTER (WHERE d.days >= 2) AS day2,
      COUNT(*) FILTER (WHERE d.days >= 3) AS day3,
      COUNT(*) FILTER (WHERE c.trial_ends_at IS NOT NULL AND d.last_at >= c.trial_ends_at - interval '1 day') AS trial,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM "order" o WHERE o.user_id = c.user_id AND o.language = ${filter.language} AND o.status = 'paid')) AS purchase
    FROM cohort c LEFT JOIN days d ON d.user_id = c.user_id`;
  const row = rows[0];
  return {
    signup: Number(row?.signup ?? 0),
    firstSession: Number(row?.first ?? 0),
    day2: Number(row?.day2 ?? 0),
    day3: Number(row?.day3 ?? 0),
    trialEnd: Number(row?.trial ?? 0),
    purchase: Number(row?.purchase ?? 0),
  };
}

export async function learningReport(filter: LearningFilter) {
  const settings = await engineSettings();
  const [mem, byCode, who, prod, steps] = await Promise.all([memory(filter), codes(filter), learners(filter, num(settings, "leech.threshold")), production(filter), funnel(filter)]);
  return { ...mem, codes: byCode, learners: who, production: prod, funnel: steps };
}

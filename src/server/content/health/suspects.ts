import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { itemTitles } from "@/server/reports/list";
import { reportSlug } from "@/server/reports/slugs";

/**
 * «سلامت محتوا» from learners' answers (PRD §13.11): items whose answers at one step are mostly wrong or
 * mostly «نمی‌دانم», and texts whose first attempt is far too hard or too easy for their place in the order.
 */

/** At least this many answers at one step before an item is judged. */
export const SUSPECT_MIN = 30;
/** Accuracy below this, or «نمی‌دانم» above it, makes an item suspect. */
export const SUSPECT_SHARE = 0.4;
/** A text's mean first-attempt score outside these is flagged. */
export const TEXT_LOW = 0.4;
export const TEXT_HIGH = 0.95;
/** First attempts a text needs before its mean says anything. */
export const TEXT_MIN = 10;

export type SuspectRow = { type: string; id: number; step: number; n: number; ok: number; idk: number; title: string | null; href: string | null };
export type TextRow = { id: number; title: string; level: string; track: "listening" | "reading"; n: number; mean: number; href: string };

const learnersOnly = Prisma.sql`AND r.user_id IN (SELECT id FROM "user" WHERE NOT is_tester AND NOT is_admin)`;

export async function suspectItems(language: string, testers = false): Promise<SuspectRow[]> {
  const rows = await db.$queryRaw<{ type: string; id: number; step: number; n: bigint; ok: bigint; idk: bigint }[]>`
    SELECT r.item_type AS type, r.item_id AS id, COALESCE(r.step_before, 0)::int AS step, COUNT(*) AS n,
      COUNT(*) FILTER (WHERE r.result IN ('correct', 'near')) AS ok, COUNT(*) FILTER (WHERE r.result = 'idk') AS idk
    FROM "review_log" r
    WHERE r.language = ${language} AND r.item_type IN ('word', 'grammar_unit', 'conjugation') AND r.item_id IS NOT NULL
      AND r.kind IN ('review', 'followup', 'practice') AND r.result IN ('correct', 'near', 'wrong', 'idk') ${testers ? Prisma.empty : learnersOnly}
    GROUP BY 1, 2, 3
    HAVING COUNT(*) >= ${SUSPECT_MIN}
      AND (COUNT(*) FILTER (WHERE r.result IN ('correct', 'near')) < ${SUSPECT_SHARE}::float8 * COUNT(*) OR COUNT(*) FILTER (WHERE r.result = 'idk') > ${SUSPECT_SHARE}::float8 * COUNT(*))
    ORDER BY COUNT(*) FILTER (WHERE r.result IN ('correct', 'near'))::float / COUNT(*) ASC LIMIT 200`;
  const named = await itemTitles(rows.map((row) => ({ type: row.type, id: row.id })));
  return rows.map((row) => {
    const key = `${row.type}:${row.id}`;
    const slug = reportSlug[row.type];
    return {
      type: row.type,
      id: row.id,
      step: row.step,
      n: Number(row.n),
      ok: Number(row.ok),
      idk: Number(row.idk),
      title: named.get(key)?.title ?? null,
      href: slug && named.has(key) ? `/admin/content/${slug}/${row.id}` : null,
    };
  });
}

export async function textsOutOfPlace(language: string, testers = false): Promise<TextRow[]> {
  const rows = await db.$queryRaw<{ id: number; title: string; level: string; track: "listening" | "reading"; n: bigint; mean: number }[]>`
    SELECT t.id, t.title, t.level, s.track::text AS track, COUNT(*) AS n, AVG(s.first_score) AS mean
    FROM "text_state" s JOIN "text" t ON t.id = s.text_id
    WHERE t.language = ${language} AND s.first_score IS NOT NULL ${testers ? Prisma.empty : Prisma.sql`AND s.user_id IN (SELECT id FROM "user" WHERE NOT is_tester AND NOT is_admin)`}
    GROUP BY 1, 2, 3, 4
    HAVING COUNT(*) >= ${TEXT_MIN} AND (AVG(s.first_score) < ${TEXT_LOW}::float8 OR AVG(s.first_score) > ${TEXT_HIGH}::float8)
    ORDER BY 6 ASC`;
  return rows.map((row) => ({ ...row, n: Number(row.n), mean: Number(row.mean), href: `/admin/content/texts/${row.id}` }));
}

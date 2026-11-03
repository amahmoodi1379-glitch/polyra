import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { librarySlugs, withoutLevel, type LibrarySlug } from "@/server/content/library/slugs";
import { languageCodes } from "@/server/content/languages";

/**
 * «داشبورد» (PRD §13.2): new sign-ups, free periods ending soon, active subscriptions, sessions per day,
 * and how much content there is by language, level and status. Testers and teachers are not counted
 * as learners.
 */

/** Days of sessions shown, today included. */
export const DASH_DAYS = 14;
/** «رو به پایان»: a free period that ends within this many hours. */
export const ENDING_HOURS = 48;

const DAY = 86_400_000;
const learners = Prisma.sql`(SELECT id FROM "user" WHERE NOT is_tester AND NOT is_admin AND deleted_at IS NULL)`;

export type ContentCount = { slug: LibrarySlug; level: string | null; status: string; n: number };

const contentTables: Record<LibrarySlug, string> = {
  words: "word",
  sentences: "sentence",
  units: "grammar_unit",
  tables: "conjugation_table",
  transforms: "transform_item",
  translations: "translate_item",
  texts: "text",
  dialogues: "dialogue",
  errorfix: "errorfix_item",
  writing: "writing_task",
  phonics: "phonics_lesson",
};

/** Types without a level of their own take their verb's or their unit's. */
const parentLevel: Partial<Record<LibrarySlug, string>> = {
  tables: `(SELECT level FROM "word" WHERE id = word_id)`,
  transforms: `(SELECT level FROM "grammar_unit" WHERE id = grammar_unit_id)`,
  translations: `(SELECT level FROM "grammar_unit" WHERE id = grammar_unit_id)`,
};

/** Content counts of one language by type, level and status (phonics lessons have no level). */
async function contentCounts(language: string): Promise<ContentCount[]> {
  const parts = await Promise.all(
    librarySlugs.map(async (slug) => {
      const table = contentTables[slug];
      const level = Prisma.raw(parentLevel[slug] ?? (withoutLevel.has(slug) ? "NULL" : `"level"`));
      const rows = await db.$queryRaw<{ level: string | null; status: string; n: bigint }[]>`
        SELECT ${level}::text AS level, status::text AS status, COUNT(*) AS n FROM ${Prisma.raw(`"${table}"`)} WHERE language = ${language} GROUP BY 1, 2`;
      return rows.map((row) => ({ slug, level: row.level, status: row.status, n: Number(row.n) }));
    }),
  );
  return parts.flat();
}

export async function dashboard(now = new Date()) {
  const since = (days: number) => new Date(now.getTime() - days * DAY);
  const [signups, ending, subscriptions, sessions, content] = await Promise.all([
    db.$queryRaw<{ d1: bigint; d7: bigint; d30: bigint; all: bigint }[]>`
      SELECT COUNT(*) FILTER (WHERE created_at >= ${since(1)}) AS d1, COUNT(*) FILTER (WHERE created_at >= ${since(7)}) AS d7,
        COUNT(*) FILTER (WHERE created_at >= ${since(30)}) AS d30, COUNT(*) AS all
      FROM "user" WHERE id IN ${learners}`,
    db.$queryRaw<{ language: string; n: bigint }[]>`
      SELECT e.language, COUNT(*) AS n FROM "enrollment" e
      WHERE e.trial_ends_at > ${now} AND e.trial_ends_at <= ${new Date(now.getTime() + ENDING_HOURS * 3_600_000)} AND e.user_id IN ${learners}
        AND NOT EXISTS (SELECT 1 FROM "subscription" s WHERE s.user_id = e.user_id AND s.language = e.language AND s.ends_at > ${now})
      GROUP BY 1`,
    db.$queryRaw<{ language: string; n: bigint }[]>`
      SELECT language, COUNT(DISTINCT user_id) AS n FROM "subscription" WHERE starts_at <= ${now} AND ends_at > ${now} AND user_id IN ${learners} GROUP BY 1`,
    db.$queryRaw<{ day: Date; language: string; n: bigint; people: bigint }[]>`
      SELECT (created_at AT TIME ZONE 'Asia/Tehran')::date AS day, language, COUNT(*) AS n, COUNT(DISTINCT user_id) AS people FROM "session"
      WHERE created_at >= ${since(DASH_DAYS + 1)} AND user_id IN ${learners} GROUP BY 1, 2 ORDER BY 1`,
    Promise.all(languageCodes.map(async (language) => ({ language, rows: await contentCounts(language) }))),
  ]);
  const perLanguage = (rows: { language: string; n: bigint }[]) => Object.fromEntries(languageCodes.map((code) => [code, Number(rows.find((row) => row.language === code)?.n ?? 0)])) as Record<string, number>;
  return {
    signups: { day: Number(signups[0]?.d1 ?? 0), week: Number(signups[0]?.d7 ?? 0), month: Number(signups[0]?.d30 ?? 0), all: Number(signups[0]?.all ?? 0) },
    ending: perLanguage(ending),
    subscriptions: perLanguage(subscriptions),
    sessions: sessions.map((row) => ({ day: row.day.toISOString().slice(0, 10), language: row.language, n: Number(row.n), people: Number(row.people) })),
    content,
  };
}

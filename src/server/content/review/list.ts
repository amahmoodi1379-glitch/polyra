import { db } from "@/server/db";
import { levelRank } from "../languages";
import { librarySlugs, type LibrarySlug } from "../library/slugs";
import type { ImportReport } from "../report";
import { slugOfEntity } from "./queue";

export type ReviewRef = { slug: LibrarySlug; id: number };
/** One batch's items (from its page), or everything of a language, or one type of it. */
export type ReviewScope = { batch: number | null; slug: LibrarySlug | null };

type Waiting = { id: number; level: string | null; first?: boolean };

const waiting = { status: "needs_review" as const };
const levelled = { id: true, level: true } as const;

/** Items of one type waiting for review, with what orders them. */
async function rowsOf(slug: LibrarySlug, language: string, ids: number[] | null): Promise<Waiting[]> {
  const where = { language, ...waiting, ...(ids ? { id: { in: ids } } : {}) };
  switch (slug) {
    case "words": {
      const rows = await db.word.findMany({ where, select: { ...levelled, mastery: true, mastery_suggested: true } });
      // B1 and B2 words whose chatbot suggestion differs from the default come first (PRD §13.4).
      return rows.map((row) => ({ ...row, first: levelRank(row.level) >= levelRank("B1") && !!row.mastery_suggested && row.mastery_suggested !== row.mastery }));
    }
    case "sentences":
      return db.sentence.findMany({ where, select: levelled });
    case "units":
      return db.grammarUnit.findMany({ where, select: levelled });
    case "texts":
      return db.text.findMany({ where, select: levelled });
    case "dialogues":
      return db.dialogue.findMany({ where, select: levelled });
    case "errorfix":
      return db.errorfixItem.findMany({ where, select: levelled });
    case "writing":
      return db.writingTask.findMany({ where, select: levelled });
    case "tables": {
      const rows = await db.conjugationTable.findMany({ where, select: { id: true, word: { select: { level: true } } } });
      return rows.map((row) => ({ id: row.id, level: row.word.level }));
    }
    case "transforms": {
      const rows = await db.transformItem.findMany({ where, select: { id: true, grammar_unit: { select: { level: true } } } });
      return rows.map((row) => ({ id: row.id, level: row.grammar_unit.level }));
    }
    case "translations": {
      const rows = await db.translateItem.findMany({ where, select: { id: true, grammar_unit: { select: { level: true } } } });
      return rows.map((row) => ({ id: row.id, level: row.grammar_unit.level }));
    }
    case "phonics":
      return (await db.phonicsLesson.findMany({ where, select: { id: true } })).map((row) => ({ ...row, level: null }));
  }
}

/** The ids a batch imported, by type; null for a batch that is gone. */
async function batchIds(batchId: number, language: string): Promise<Map<LibrarySlug, number[]> | null> {
  const batch = await db.importBatch.findUnique({ where: { id: batchId }, select: { language: true, report: true } });
  if (!batch || batch.language !== language) return null;
  const out = new Map<LibrarySlug, number[]>();
  for (const { entity } of (batch.report as ImportReport | null)?.accepted ?? []) {
    if (!entity) continue;
    const slug = slugOfEntity[entity.type];
    out.set(slug, [...(out.get(slug) ?? []), entity.id]);
  }
  return out;
}

/**
 * What is waiting for «بازبینی», in the order it is shown: by type (words first, as in the menu),
 * then level, then B1 and B2 words to check for «نوشتنی / شناختنی» first, then the order they came in.
 */
export async function reviewQueue(language: string, scope: ReviewScope): Promise<ReviewRef[]> {
  const ids = scope.batch !== null ? await batchIds(scope.batch, language) : null;
  if (scope.batch !== null && !ids) return [];
  const slugs = librarySlugs.filter((slug) => (scope.slug === null || slug === scope.slug) && (!ids || ids.has(slug)));
  const out: ReviewRef[] = [];
  for (const slug of slugs) {
    const rows = await rowsOf(slug, language, ids ? ids.get(slug)! : null);
    rows.sort((a, b) => levelRank(a.level) - levelRank(b.level) || Number(!!b.first) - Number(!!a.first) || a.id - b.id);
    for (const row of rows) out.push({ slug, id: row.id });
  }
  return out;
}

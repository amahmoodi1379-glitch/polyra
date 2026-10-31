import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { Tx } from "../kinds/types";
import { logChange } from "../library/log";
import { entityOf, type LibrarySlug } from "../library/slugs";
import { moveItem, sentenceUses, skeletons, statusRows } from "../library/status";
import { turnSentenceIds } from "../library/list";
import type { ImportReport } from "../report";
import { slugOfEntity } from "./queue";

/** What keeps an item from being approved: it is not finished, or «حل کردن» still has a question about it. */
export type Blocker = "skeleton" | "duplicate" | "openRows";
export type ReviewDecision = "approve" | "reject";
export type Mastery = "produce" | "recognize";
export type DecideResult = { state: "done" } | { state: "gone" } | { state: "blocked"; blockers: Blocker[] } | { state: "inUse" };

const openRow = { OR: [{ candidate_reason: { not: null } }, { suspect: true }] } satisfies Prisma.SentenceWordWhereInput;

/** Sentences an item is made of, whose open word rows keep it back (PRD §13.9). */
async function sentencesOf(tx: Tx, slug: LibrarySlug, id: number): Promise<number[]> {
  if (slug === "sentences") return [id];
  if (slug === "texts") return (await tx.text.findUnique({ where: { id }, select: { sentence_ids: true } }))?.sentence_ids ?? [];
  if (slug === "dialogues") return turnSentenceIds((await tx.dialogue.findUnique({ where: { id }, select: { turns: true } }))?.turns);
  return [];
}

export async function reviewBlockers(tx: Tx, slug: LibrarySlug, id: number): Promise<Blocker[]> {
  const blockers: Blocker[] = [];
  if ((await skeletons(tx, slug, [id])).has(id)) blockers.push("skeleton");
  if (slug === "words" && (await tx.word.count({ where: { id, dup_of_id: { not: null } } })) > 0) blockers.push("duplicate");
  const sentences = await sentencesOf(tx, slug, id);
  if (sentences.length > 0 && (await tx.sentenceWord.count({ where: { sentence_id: { in: sentences }, ...openRow } })) > 0) blockers.push("openRows");
  return blockers;
}

/**
 * A batch whose items are all decided is «بازبینی‌شده» (PRD §4, import_batch.state). Every batch that
 * accepted the item counts: a word made as a list skeleton is finished by a later batch.
 */
async function closeBatches(tx: Tx, slug: LibrarySlug, id: number) {
  const batches = await tx.importBatch.findMany({
    where: { state: "qa_done", report: { path: ["accepted"], array_contains: [{ entity: { type: entityOf[slug], id } }] } },
    select: { id: true, language: true, report: true },
  });
  for (const batch of batches) {
    const bySlug = new Map<LibrarySlug, number[]>();
    for (const { entity } of (batch.report as ImportReport | null)?.accepted ?? []) {
      if (!entity) continue;
      const slug = slugOfEntity[entity.type];
      bySlug.set(slug, [...(bySlug.get(slug) ?? []), entity.id]);
    }
    let open = false;
    for (const [slug, ids] of bySlug) {
      if ((await statusRows(tx, slug, batch.language, ids)).some((row) => row.status === "needs_review")) open = true;
    }
    if (!open) await tx.importBatch.update({ where: { id: batch.id }, data: { state: "reviewed" } });
  }
}

/**
 * The teacher's decision on one item in «بازبینی» (PRD §13.9 step 4, owner decision: approving is
 * only done here, one item at a time, and the log row records who saw it). «رد» retires the item
 * with its targets or questions. A B1 or B2 word may come with «نوشتنی / شناختنی» (PRD §13.4):
 * a change is the teacher's own, so it is marked «دستی».
 */
export async function decideReview(
  slug: LibrarySlug,
  language: string,
  id: number,
  decision: ReviewDecision,
  adminId: number | null,
  options: { mastery?: Mastery } = {},
): Promise<DecideResult> {
  return db.$transaction(async (tx) => {
    const [row] = await statusRows(tx, slug, language, [id]);
    if (!row || row.status !== "needs_review") return { state: "gone" as const };

    if (decision === "reject") {
      if (slug === "sentences" && (await sentenceUses(tx, language, [id])).has(id)) return { state: "inUse" as const };
      await moveItem(tx, slug, row, { status: "retired" }, adminId, "review");
    } else {
      const blockers = await reviewBlockers(tx, slug, id);
      if (blockers.length > 0) return { state: "blocked" as const, blockers };
      if (slug === "words" && options.mastery) {
        const word = await tx.word.findUniqueOrThrow({ where: { id }, select: { mastery: true, mastery_manual: true } });
        if (word.mastery !== options.mastery) {
          await tx.word.update({ where: { id }, data: { mastery: options.mastery, mastery_manual: true } });
          await logChange(tx, adminId, {
            action: "edit",
            entity: "word",
            entityId: id,
            before: { mastery: word.mastery, mastery_manual: word.mastery_manual },
            after: { mastery: options.mastery, mastery_manual: true },
          });
        }
      }
      await moveItem(tx, slug, row, { status: "approved" }, adminId, "review");
    }
    await closeBatches(tx, slug, id);
    return { state: "done" as const };
  });
}

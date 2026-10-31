import { seeded, shuffle } from "@/engine/random";
import type { Prisma } from "@/generated/prisma/client";
import { appSetting } from "@/server/settings/read";
import type { Tx } from "../kinds/types";
import { entityOf, librarySlugs, type LibrarySlug } from "../library/slugs";
import { moveItem, setStatus, skeletons, statusRows } from "../library/status";
import type { EntityRef, ImportReport } from "../report";

/** The library type of each `EntityRef` (its table name, PRD §4). */
export const slugOfEntity = Object.fromEntries(librarySlugs.map((slug) => [entityOf[slug], slug])) as Record<EntityRef["type"], LibrarySlug>;

const openRow = { OR: [{ candidate_reason: { not: null } }, { suspect: true }] } satisfies Prisma.SentenceWordWhereInput;

export type ReviewSent = { review: number; unseen: number };

const refKey = (ref: EntityRef) => `${ref.type}:${ref.id}`;

/**
 * After a batch's quality check its items go to «بازبینی» (PRD §13.4, §13.9 step 4): the drafts that
 * are complete become `needs_review`; a word list skeleton waits for its meaning. Vocabulary sentences
 * of a level whose share (`review.sentence_share`) is below 100 are sampled: the flagged ones (a QA
 * finding, an import warning, an open word row) and that share of the rest at random go to review,
 * the others are approved unseen, each with a log row that says so. A QA finding the panel could not
 * place may be about any sentence, so then every sentence of the batch is reviewed.
 */
export async function sendToReview(
  tx: Tx,
  batch: { id: number; language: string; report: ImportReport },
  flagged: (EntityRef | null)[],
  adminId: number | null,
): Promise<ReviewSent> {
  const sent: ReviewSent = { review: 0, unseen: 0 };
  const marked = new Set(
    [...flagged, ...batch.report.warnings.map((flag) => flag.entity ?? null)].filter((ref): ref is EntityRef => ref !== null).map(refKey),
  );
  const unplaced = flagged.some((ref) => ref === null);
  const bySlug = new Map<LibrarySlug, number[]>();
  for (const { entity } of batch.report.accepted) {
    if (!entity) continue;
    const slug = slugOfEntity[entity.type];
    const ids = bySlug.get(slug) ?? [];
    if (!ids.includes(entity.id)) ids.push(entity.id);
    bySlug.set(slug, ids);
  }

  for (const [slug, ids] of bySlug) {
    const empty = await skeletons(tx, slug, ids);
    const drafts = (await statusRows(tx, slug, batch.language, ids)).filter((row) => row.status === "draft" && !empty.has(row.id));
    let unseen = new Set<number>();
    if (slug === "sentences" && !unplaced) unseen = await unsampled(tx, batch, drafts.map((row) => row.id), marked);
    await setStatus(
      tx,
      slug,
      drafts.filter((row) => !unseen.has(row.id)).map((row) => row.id),
      "needs_review",
    );
    for (const row of drafts.filter((row) => unseen.has(row.id))) await moveItem(tx, slug, row, { status: "approved" }, adminId, "review", { unseen: true });
    sent.unseen += unseen.size;
    sent.review += drafts.length - unseen.size;
  }
  return sent;
}

/**
 * Of these sentences, the vocabulary ones (every target a word) that are approved without review:
 * per level, all but the flagged ones and a share of the rest, rounded up.
 */
async function unsampled(tx: Tx, batch: { id: number }, ids: number[], marked: Set<string>): Promise<Set<number>> {
  const share = await appSetting<Record<string, number>>("review.sentence_share");
  const rows = await tx.sentence.findMany({
    where: { id: { in: ids } },
    select: { id: true, level: true, targets: { select: { target_type: true } }, words: { where: openRow, select: { id: true } } },
    orderBy: { id: "asc" },
  });
  const byLevel = new Map<string, number[]>();
  for (const row of rows) {
    const percent = row.level ? (share[row.level] ?? 100) : 100;
    const vocabulary = row.targets.length > 0 && row.targets.every((target) => target.target_type === "word");
    if (percent >= 100 || !vocabulary || row.words.length > 0 || marked.has(refKey({ type: "sentence", id: row.id }))) continue;
    byLevel.set(row.level!, [...(byLevel.get(row.level!) ?? []), row.id]);
  }
  const out = new Set<number>();
  for (const [level, list] of byLevel) {
    const seen = Math.ceil(((share[level] ?? 100) / 100) * list.length);
    for (const id of shuffle(seeded("review", batch.id, level), list).slice(seen)) out.add(id);
  }
  return out;
}

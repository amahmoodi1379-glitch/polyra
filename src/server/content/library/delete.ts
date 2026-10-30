import { db } from "@/server/db";
import type { Tx } from "../kinds/types";
import { turnSentenceIds } from "./list";
import { logChange, plain } from "./log";
import { entityOf, type LibrarySlug } from "./slugs";
import { dropUnusedSentences, sentenceUses } from "./status";

export type DeleteResult = { state: "deleted" } | { state: "notDraft" } | { state: "inUse" } | { state: "gone" };

type Row = Record<string, unknown> & { id: number; language: string; status: string };

async function find(tx: Tx, slug: LibrarySlug, id: number): Promise<Row | null> {
  const where = { where: { id } };
  switch (slug) {
    case "words":
      return tx.word.findUnique(where);
    case "sentences":
      return tx.sentence.findUnique(where);
    case "units":
      return tx.grammarUnit.findUnique(where);
    case "tables":
      return tx.conjugationTable.findUnique(where);
    case "transforms":
      return tx.transformItem.findUnique(where);
    case "translations":
      return tx.translateItem.findUnique(where);
    case "texts":
      return tx.text.findUnique(where);
    case "dialogues":
      return tx.dialogue.findUnique(where);
    case "errorfix":
      return tx.errorfixItem.findUnique(where);
    case "writing":
      return tx.writingTask.findUnique(where);
    case "phonics":
      return tx.phonicsLesson.findUnique(where);
  }
}

/** Is anything still pointing at this item? Then it must be retired instead (PRD §13.7). */
async function inUse(tx: Tx, slug: LibrarySlug, row: Row): Promise<boolean> {
  const id = row.id;
  if (slug === "words") {
    const code = row.code as string;
    const counts = await Promise.all([
      tx.sentenceWord.count({ where: { word_id: id } }),
      tx.sentenceTarget.count({ where: { target_type: "word", target_id: id } }),
      tx.conjugationTable.count({ where: { word_id: id } }),
      tx.word.count({ where: { language: row.language, id: { not: id }, OR: [{ sense_of: code }, { parts: { has: code } }, { dup_of_id: id }] } }),
      tx.text.count({ where: { language: row.language, key_word_ids: { has: id } } }),
    ]);
    return counts.some((count) => count > 0);
  }
  if (slug === "sentences") return (await sentenceUses(tx, row.language, [id])).size > 0;
  if (slug === "units") {
    const code = row.unit_code as string;
    const counts = await Promise.all([
      tx.sentenceTarget.count({ where: { target_type: "grammar", target_id: id } }),
      tx.conjugationTable.count({ where: { unit_code: code } }),
      tx.errorfixItem.count({ where: { unit_codes: { has: code } } }),
    ]);
    return counts.some((count) => count > 0);
  }
  return false;
}

/** Deletes a draft for good, with its own child rows, and logs what it was. */
export async function deleteItem(slug: LibrarySlug, id: number, adminId: number): Promise<DeleteResult> {
  return db.$transaction(async (tx) => {
    const row = await find(tx, slug, id);
    if (!row) return { state: "gone" as const };
    if (row.status !== "draft") return { state: "notDraft" as const };
    if (await inUse(tx, slug, row)) return { state: "inUse" as const };

    const where = { where: { id } };
    switch (slug) {
      case "words":
        await tx.formException.deleteMany({ where: { word_id: id } });
        await tx.word.delete(where);
        break;
      case "sentences":
        await tx.sentence.delete(where);
        break;
      case "units":
        await tx.grammarUnit.delete(where);
        break;
      case "tables":
        await tx.conjugationTable.delete(where);
        break;
      case "transforms":
        await tx.transformItem.delete(where);
        break;
      case "translations":
        await tx.translateItem.delete(where);
        break;
      case "texts":
        await tx.text.delete(where);
        break;
      case "dialogues":
        await tx.dialogue.delete(where);
        break;
      case "errorfix":
        await tx.errorfixItem.delete(where);
        break;
      case "writing":
        await tx.writingTask.delete(where);
        break;
      case "phonics":
        await tx.phonicsLesson.delete(where);
        break;
    }
    // The sentences of a text or dialogue go with it when nothing else uses them.
    const own = slug === "texts" ? (row.sentence_ids as number[]) : slug === "dialogues" ? turnSentenceIds(row.turns) : [];
    const sentences = await dropUnusedSentences(tx, row.language, own);
    await logChange(tx, adminId, {
      action: "delete",
      entity: entityOf[slug],
      entityId: id,
      before: { ...(plain(row) as Record<string, unknown>), ...(sentences.length ? { deleted_sentence_ids: sentences } : {}) },
      after: null,
    });
    return { state: "deleted" as const };
  });
}

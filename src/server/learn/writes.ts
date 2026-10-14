import type { NotebookOp } from "@/engine/notebook";
import { applyNotebook } from "@/engine/notebook";
import type { Settings } from "@/engine/settings";
import type { ConfusionE, ItemStateE } from "@/engine/state";
import type { Prisma } from "@/generated/prisma/client";
import { asDate, itemStateRow, notebookOf } from "./learner";

/**
 * Small writes shared by the session build, the answers and the close: item states, the notebook,
 * confusion pairs and today's counters. Each runs inside the caller's transaction.
 */

type Tx = Prisma.TransactionClient;
type Who = { userId: number; language: string };

/** Writes an item's state; true when the item is new (its first exercise was just answered). */
export async function saveItemState(tx: Tx, who: Who, state: ItemStateE): Promise<boolean> {
  const where = { user_id_item_type_item_id: { user_id: who.userId, item_type: state.itemType, item_id: state.itemId } };
  const found = await tx.itemState.findUnique({ where, select: { id: true } });
  if (found) {
    await tx.itemState.update({ where: { id: found.id }, data: itemStateRow(state) });
    return false;
  }
  await tx.itemState.create({ data: { user_id: who.userId, language: who.language, item_type: state.itemType, item_id: state.itemId, ...itemStateRow(state) } });
  return true;
}

/** Today's counters (PRD §10.5, §3.9), added to the row of the Tehran day. */
export type DailyAdd = Partial<Record<"new_words" | "queue_words" | "new_units" | "new_conj" | "active_sec", number>>;

export async function addDaily(tx: Tx, who: Who, today: string, add: DailyAdd, set: { words_cap_today?: number; cap_prompt_shown?: boolean } = {}) {
  const increments = Object.fromEntries(Object.entries(add).filter(([, value]) => value)) as DailyAdd;
  if (Object.keys(increments).length === 0 && Object.keys(set).length === 0) return;
  await tx.dailyCounter.upsert({
    where: { user_id_language_date_tehran: { user_id: who.userId, language: who.language, date_tehran: asDate(today) } },
    create: { user_id: who.userId, language: who.language, date_tehran: asDate(today), ...increments, ...set },
    update: { ...Object.fromEntries(Object.entries(increments).map(([key, value]) => [key, { increment: value }])), ...set },
  });
}

const noteKey = (entry: { refType: string; refId: number }) => `${entry.refType}:${entry.refId}`;

/** Applies notebook operations (PRD §9.5) to the learner's rows. */
export async function applyNotebookOps(tx: Tx, who: Who, ops: NotebookOp[], now: Date, today: string, settings: Settings) {
  if (ops.length === 0) return;
  const rows = await tx.notebookEntry.findMany({ where: { user_id: who.userId, language: who.language } });
  const before = rows.map(notebookOf);
  const after = applyNotebook(before, ops, now, today, settings);
  const kept = new Map(after.map((entry) => [noteKey(entry), entry]));
  for (const row of rows) {
    const entry = kept.get(noteKey({ refType: row.ref_type, refId: row.ref_id }));
    if (!entry) {
      await tx.notebookEntry.delete({ where: { id: row.id } });
      continue;
    }
    kept.delete(noteKey(entry));
    const data = {
      added_at: new Date(entry.addedAt),
      until: new Date(entry.until),
      correct_count: entry.correctCount,
      last_correct_date: entry.lastCorrectDate ? asDate(entry.lastCorrectDate) : null,
    };
    const same =
      row.added_at.getTime() === data.added_at.getTime() &&
      row.until.getTime() === data.until.getTime() &&
      row.correct_count === data.correct_count &&
      (row.last_correct_date?.getTime() ?? null) === (data.last_correct_date?.getTime() ?? null);
    if (!same) await tx.notebookEntry.update({ where: { id: row.id }, data });
  }
  for (const entry of kept.values()) {
    await tx.notebookEntry.create({
      data: {
        user_id: who.userId,
        language: who.language,
        ref_type: entry.refType,
        ref_id: entry.refId,
        added_at: new Date(entry.addedAt),
        until: new Date(entry.until),
        correct_count: entry.correctCount,
        last_correct_date: entry.lastCorrectDate ? asDate(entry.lastCorrectDate) : null,
      },
    });
  }
}

export async function saveConfusion(tx: Tx, who: Who, pair: ConfusionE) {
  const data = { count: pair.count, last_at: new Date(pair.lastAt), card_shown_at: pair.cardShownAt ? new Date(pair.cardShownAt) : null };
  await tx.confusionPair.upsert({
    where: { user_id_word_id_other_word_id: { user_id: who.userId, word_id: pair.wordId, other_word_id: pair.otherWordId } },
    create: { user_id: who.userId, language: who.language, word_id: pair.wordId, other_word_id: pair.otherWordId, ...data },
    update: data,
  });
}

import type { Tx } from "./kinds/types";

/**
 * `intro_order` is the order new words are introduced within one language and level (PRD §5.8).
 * Imports append at the end; a phrase goes after its last part and a new sense after its base word.
 */
export async function lastIntroOrder(tx: Tx, language: string, level: string) {
  const last = await tx.word.aggregate({ where: { language, level }, _max: { intro_order: true } });
  return last._max.intro_order ?? 0;
}

/** Moves each word right after its anchor (same language and level), then numbers the level 1..n. */
export async function placeAfter(tx: Tx, language: string, level: string, moves: { wordId: number; afterId: number }[]) {
  if (moves.length === 0) return;
  const rows = await tx.word.findMany({
    where: { language, level },
    orderBy: [{ intro_order: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    select: { id: true, intro_order: true },
  });
  const order = rows.map((row) => row.id);
  for (const move of moves) {
    const from = order.indexOf(move.wordId);
    if (from < 0 || !order.includes(move.afterId)) continue;
    order.splice(from, 1);
    order.splice(order.indexOf(move.afterId) + 1, 0, move.wordId);
  }
  const current = new Map(rows.map((row) => [row.id, row.intro_order]));
  for (const [index, id] of order.entries()) {
    if (current.get(id) !== index + 1) await tx.word.update({ where: { id }, data: { intro_order: index + 1 } });
  }
}

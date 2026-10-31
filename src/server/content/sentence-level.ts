import type { Tx } from "./kinds/types";
import { levelRank } from "./languages";

/** The highest of these levels, or null when there is none. */
export function topLevel(levels: (string | null | undefined)[]): string | null {
  return levels.reduce<string | null>((top, value) => (!value ? top : top && levelRank(top) >= levelRank(value) ? top : value), null);
}

/**
 * `sentence.level` (PRD §4.1) is the highest level of the sentence's words, so it is computed again
 * when a word moves to another level or a sentence's words change (a candidate settled, a duplicate
 * merged). A sentence with no word mapped yet keeps the level it was made for.
 */
export async function refreshSentenceLevels(tx: Tx, scope: { sentenceIds?: number[]; wordIds?: number[] }) {
  const ids = new Set(scope.sentenceIds ?? []);
  if (scope.wordIds?.length) {
    const rows = await tx.sentenceWord.findMany({ where: { word_id: { in: scope.wordIds } }, select: { sentence_id: true }, distinct: ["sentence_id"] });
    for (const row of rows) ids.add(row.sentence_id);
  }
  if (ids.size === 0) return;
  const sentences = await tx.sentence.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, level: true, words: { where: { kind: "word", word_id: { not: null } }, select: { word: { select: { level: true } } } } },
  });
  for (const sentence of sentences) {
    const level = topLevel(sentence.words.map((row) => row.word?.level)) ?? sentence.level;
    if (level !== sentence.level) await tx.sentence.update({ where: { id: sentence.id }, data: { level } });
  }
}

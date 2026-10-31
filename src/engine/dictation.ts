import { cleanAnswer, hasWordChar, matchText, words, type Lang } from "./text";

/**
 * Dictation scoring for Q-dict and L3 (PRD §7.3, "تصحیح دیکته"): both sides cleaned and split into
 * words, names left out, the words aligned by their longest common subsequence so one missed word
 * costs one word, an accent or a capital never counts, and 90% of the sentence's words is right.
 */

/** A dictation passes at this share of the sentence's words (PRD §7.3, step 5). */
export const DICTATION_PASS = 0.9;

/** One word of the sentence to write; a name's words are not scored (step 2). */
export type DictWord = { text: string; scored: boolean };

/** An elided article or pronoun before a word: «l'», «d'», «qu'». */
const ELISION = /^\p{L}{1,2}'/u;

/**
 * The sentence as words to write, with the words of its names (as written, so «Pierre» the name
 * and «pierre» the stone differ) marked as not scored, also behind an elision: «l'Italie».
 */
export function dictationWords(text: string, names: readonly string[]): DictWord[] {
  const nameWords = new Set(names.flatMap((name) => words(cleanAnswer(name, true))));
  return words(cleanAnswer(text, true))
    .filter(hasWordChar)
    .map((word) => ({ text: word, scored: !nameWords.has(word) && !nameWords.has(word.replace(ELISION, "")) }));
}

export type DictationResult = {
  /** For each sentence word: written, missed, or null for a name. */
  marks: (boolean | null)[];
  score: number;
  ok: boolean;
};

/** Scores a written answer against the sentence words; extra words cost nothing (step 5). */
export function scoreDictation(given: string, sentence: readonly DictWord[], lang: Lang): DictationResult {
  const typed = words(cleanAnswer(given, true)).filter(hasWordChar);
  const scored = sentence.map((word, i) => ({ word, i })).filter(({ word }) => word.scored);
  const same = (a: string, b: string) => matchText(a, b, lang, false).result !== "wrong";

  // Longest common subsequence of the scored words and the typed words.
  const n = scored.length;
  const m = typed.length;
  const table = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = same(typed[j], scored[i].word.text) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const marks: (boolean | null)[] = sentence.map((word) => (word.scored ? false : null));
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (same(typed[j], scored[i].word.text) && table[i][j] === table[i + 1][j + 1] + 1) {
      marks[scored[i].i] = true;
      i++;
      j++;
    } else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  const score = n === 0 ? 1 : table[0][0] / n;
  return { marks, score, ok: score >= DICTATION_PASS };
}

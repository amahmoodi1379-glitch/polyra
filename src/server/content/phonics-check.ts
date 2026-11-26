import type { PhonicsKind } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import type { PhonicsLessonRecord } from "@/schemas/phonics";
import { problem, type Problem } from "./problems";

/**
 * The checks of a phonics lesson that Zod cannot do (PRD §8.1, §13.3), without a database: the panel's
 * importer and edit form and the content packs' checker share them.
 */

const same = (a: string, b: string) => fold(a).replace(/\s+/g, " ").trim() === fold(b).replace(/\s+/g, " ").trim();

/** How many items each kind needs (PRD §8.1, §13.3). */
export const phonicsSizes: Record<PhonicsKind, { words: [number, number]; pairs: number; sentences: number }> = {
  contrast: { words: [6, 10], pairs: 5, sentences: 0 },
  rule: { words: [8, 12], pairs: 0, sentences: 0 },
  liaison: { words: [0, 0], pairs: 0, sentences: 8 },
};

/** Checks Zod cannot do: the counts of each kind and the wrong spellings (PRD §13.3). */
export function checkLesson(lesson: PhonicsLessonRecord, kind: PhonicsKind): Problem[] {
  const problems: Problem[] = [];
  if (lesson.kind !== kind) problems.push(problem("badValue", { value: lesson.kind, field: "kind" }));
  const size = phonicsSizes[kind];
  if (kind !== "liaison") {
    const [min, max] = size.words;
    if (lesson.example_words.length < min) problems.push(problem("tooFew", { field: "example_words", min }));
    if (lesson.example_words.length > max) problems.push(problem("tooMany", { field: "example_words", max }));
    for (const word of lesson.example_words) {
      if (word.wrong_spellings.length !== 2) problems.push(problem("wrongSpellingsCount", { text: word.text }));
      else if (word.wrong_spellings.some((spelling) => same(spelling, word.text))) problems.push(problem("wrongSpellingSame", { text: word.text }));
      else if (same(word.wrong_spellings[0], word.wrong_spellings[1])) problems.push(problem("listRepeat", { field: "wrong_spellings" }));
    }
  }
  if (lesson.minimal_pairs.length < size.pairs) problems.push(problem("tooFew", { field: "minimal_pairs", min: size.pairs }));
  for (const pair of lesson.minimal_pairs) {
    if (same(pair.a, pair.b)) problems.push(problem("pairSame", { text: pair.a }));
  }
  if (lesson.liaison_sentences.length < size.sentences) problems.push(problem("tooFew", { field: "liaison_sentences", min: size.sentences }));
  for (const sentence of lesson.liaison_sentences) {
    const words = sentence.text.trim().split(/\s+/).length;
    if (sentence.liaison_after_word_index.some((index) => index >= words - 1)) problems.push(problem("liaisonIndex", { text: sentence.text }));
  }
  return problems;
}

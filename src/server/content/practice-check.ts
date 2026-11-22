import type { PhonicsKind } from "@/generated/prisma/client";
import { fold } from "@/engine/tokens";
import type { PhonicsLessonRecord } from "@/schemas/phonics";
import type { WritingRecord } from "@/schemas/speaking";
import { problem, type Problem } from "./problems";

/**
 * The rules of dialogues, find-the-mistake texts, writing tasks and phonics lessons that need no
 * database: the importers, the edit forms and the content-pack checker share them.
 */

export type Range = [number, number];

/** Words of a text: pieces with a letter or a digit. */
export const wordCount = (text: string) => text.split(/\s+/).filter((piece) => /[\p{L}\p{N}]/u.test(piece)).length;

// --- Dialogues (PRD §8b.4) ---------------------------------------------------------------

/** 5 to 8 turns, three choices each. */
export const DIALOGUE_TURNS: Range = [5, 8];
export const DIALOGUE_CHOICES = 3;
/** An A1 dialogue uses the first 200 words of the teaching order (PRD §14.9). */
export const DIALOGUE_A1_WORDS = 200;

// --- Find the mistake (PRD §8b.5) ---------------------------------------------------------

/** 2 or 3 mistakes, each one word, marked {{wrong|right}}. */
const MARKS: Range = [2, 3];
const markPattern = /\{\{([^{}|]*)\|([^{}|]*)\}\}/g;
const oneWord = (text: string) => text.trim() !== "" && !/\s/.test(text.trim());

/** The marked mistakes in order: what was written and what it should be. */
export function marksOf(marked: string) {
  return [...marked.matchAll(markPattern)].map(([, wrong, right]) => ({ wrong: wrong.trim(), right: right.trim() }));
}

/**
 * Two or three marks, each one word that really changes, one explanation per mark, and no braces
 * left outside a mark (a `{{x}}` without "|" would show in the text) (PRD §8b.5).
 */
export function checkMarks(marked: string, explanations: number): Problem[] {
  const problems: Problem[] = [];
  const marks = marksOf(marked);
  if (/[{}]/.test(marked.replace(markPattern, ""))) problems.push(problem("strayBraces", { field: "marked_text" }));
  if (marks.length < MARKS[0] || marks.length > MARKS[1]) problems.push(problem("marksCount", { field: "marked_text", count: marks.length }));
  for (const mark of marks) {
    if (!oneWord(mark.wrong) || !oneWord(mark.right) || fold(mark.wrong) === fold(mark.right)) {
      problems.push(problem("markInvalid", { text: `${mark.wrong}|${mark.right}`, field: "marked_text" }));
    }
  }
  if (marks.length > 0 && explanations !== marks.length) problems.push(problem("errorsCount", { count: explanations, expected: marks.length, field: "errors" }));
  return problems;
}

/** The text with every mistake corrected: what the learner should end with. */
export function correctedText(marked: string) {
  return marked.replace(markPattern, (_, __, right: string) => right.trim());
}

// --- Guided writing (PRD §8b.6) -----------------------------------------------------------

/** 3 to 5 checklist items, 4 to 6 useful phrases. */
const CHECKLIST: Range = [3, 5];
const PHRASES: Range = [4, 6];

/** The rules of one task (PRD §8b.6, §13.3), for import and for the edit form. */
export function checkWriting(task: Pick<WritingRecord, "min_words" | "max_words" | "checklist_fa" | "useful_phrases" | "model_answer">, range: Range) {
  const problems: Problem[] = [];
  if (task.min_words < range[0] || task.max_words > range[1] || task.min_words >= task.max_words) {
    problems.push(problem("wordRange", { min: range[0], max: range[1] }));
  }
  if (task.checklist_fa.length < CHECKLIST[0]) problems.push(problem("tooFew", { field: "checklist_fa", min: CHECKLIST[0] }));
  if (task.checklist_fa.length > CHECKLIST[1]) problems.push(problem("tooMany", { field: "checklist_fa", max: CHECKLIST[1] }));
  if (task.useful_phrases.length < PHRASES[0]) problems.push(problem("tooFew", { field: "useful_phrases", min: PHRASES[0] }));
  if (task.useful_phrases.length > PHRASES[1]) problems.push(problem("tooMany", { field: "useful_phrases", max: PHRASES[1] }));
  const words = wordCount(task.model_answer);
  if (words < task.min_words || words > task.max_words) {
    problems.push(problem("modelLength", { count: words, min: task.min_words, max: task.max_words }));
  }
  return problems;
}

// --- Phonics (PRD §8.1, §13.3) ------------------------------------------------------------

/** Two labels or spellings that differ only in case, accents or spaces count as the same. */
export const samePhonics = (a: string, b: string) => fold(a).replace(/\s+/g, " ").trim() === fold(b).replace(/\s+/g, " ").trim();

/** How many items each kind needs. */
const sizes: Record<PhonicsKind, { words: Range; pairs: number; sentences: number }> = {
  contrast: { words: [6, 10], pairs: 5, sentences: 0 },
  rule: { words: [8, 12], pairs: 0, sentences: 0 },
  liaison: { words: [0, 0], pairs: 0, sentences: 8 },
};

/** Checks Zod cannot do: the counts of each kind and the wrong spellings (PRD §13.3). */
export function checkLesson(lesson: PhonicsLessonRecord, kind: PhonicsKind): Problem[] {
  const problems: Problem[] = [];
  if (lesson.kind !== kind) problems.push(problem("badValue", { value: lesson.kind, field: "kind" }));
  const size = sizes[kind];
  if (kind !== "liaison") {
    const [min, max] = size.words;
    if (lesson.example_words.length < min) problems.push(problem("tooFew", { field: "example_words", min }));
    if (lesson.example_words.length > max) problems.push(problem("tooMany", { field: "example_words", max }));
    for (const word of lesson.example_words) {
      if (word.wrong_spellings.length !== 2) problems.push(problem("wrongSpellingsCount", { text: word.text }));
      else if (word.wrong_spellings.some((spelling) => samePhonics(spelling, word.text))) problems.push(problem("wrongSpellingSame", { text: word.text }));
      else if (samePhonics(word.wrong_spellings[0], word.wrong_spellings[1])) problems.push(problem("listRepeat", { field: "wrong_spellings" }));
    }
  }
  if (lesson.minimal_pairs.length < size.pairs) problems.push(problem("tooFew", { field: "minimal_pairs", min: size.pairs }));
  for (const pair of lesson.minimal_pairs) {
    if (samePhonics(pair.a, pair.b)) problems.push(problem("pairSame", { text: pair.a }));
  }
  if (lesson.liaison_sentences.length < size.sentences) problems.push(problem("tooFew", { field: "liaison_sentences", min: size.sentences }));
  for (const sentence of lesson.liaison_sentences) {
    const words = sentence.text.trim().split(/\s+/).length;
    if (sentence.liaison_after_word_index.some((index) => index >= words - 1)) problems.push(problem("liaisonIndex", { text: sentence.text }));
  }
  return problems;
}

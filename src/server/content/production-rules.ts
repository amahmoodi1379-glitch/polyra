import { fold } from "@/engine/tokens";
import { problem, type Problem } from "./problems";

/**
 * The rules of find-the-mistake items and guided writing tasks (PRD §8b.5, §8b.6) that need no database:
 * the panel's importers and edit forms and the content packs (`npm run content:check`) share them.
 */

export type Range = [number, number];

/** Words of a text: pieces with a letter or a digit. */
export const wordCount = (text: string) => text.split(/\s+/).filter((piece) => /[\p{L}\p{N}]/u.test(piece)).length;

/** PRD §8b.5: 2 or 3 mistakes, each one word, marked {{wrong|right}}. */
const MARKS: Range = [2, 3];
export const markPattern = /\{\{([^{}|]*)\|([^{}|]*)\}\}/g;
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

/** PRD §8b.6: 3 to 5 checklist items, 4 to 6 useful phrases. */
const CHECKLIST: Range = [3, 5];
const PHRASES: Range = [4, 6];

type WritingRules = { min_words: number; max_words: number; checklist_fa: string[]; useful_phrases: unknown[]; model_answer: string };

/** The rules of one writing task (PRD §8b.6, §13.3), for import, the edit form and the packs. */
export function checkWriting(task: WritingRules, range: Range) {
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

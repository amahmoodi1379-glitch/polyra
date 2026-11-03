import type { NotebookRef } from "./state";

/**
 * «حق با تو بود» (PRD §13.10): when a teacher agrees that a learner's reported answer was right, that
 * learner's item is put back as if the answer had not been a mistake, without touching FSRS. Pure
 * functions; the server reads the answer's `review_log` row and writes what these return.
 */

/** The parts of a `review_log` row that say what the answer did. */
export type ReportedAnswer = {
  itemType: string | null;
  itemId: number | null;
  code: string | null;
  targetId: number | null;
  stepBefore: number | null;
  result: "correct" | "near" | "wrong" | "idk";
};

/** Only an answer recorded as wrong or «نمی‌دانم» is made good again. */
export const answerWasCounted = (answer: Pick<ReportedAnswer, "result">) => answer.result === "wrong" || answer.result === "idk";

/**
 * The notebook entry a wrong answer made (PRD §9.5): a grammar sentence's target, a conjugation table,
 * a word's gender (W2d), or the word. Null when the answer was on no such item.
 */
export function notebookRefOf(answer: ReportedAnswer): { refType: NotebookRef; refId: number } | null {
  if (answer.itemId === null) return null;
  if (answer.itemType === "grammar_unit") return answer.targetId !== null ? { refType: "grammar_target", refId: answer.targetId } : null;
  // A grammar sentence practised from the notebook: its key is the target itself.
  if (answer.itemType === "grammar_target") return { refType: "grammar_target", refId: answer.itemId };
  if (answer.itemType === "conjugation") return { refType: "conjugation", refId: answer.itemId };
  if (answer.itemType === "word") return { refType: answer.code === "W2d" ? "word_gender" : "word", refId: answer.itemId };
  return null;
}

/** The item's step back to the larger of now and before that answer, and one failure fewer (never below zero). */
export function rightAfterAll(state: { step: number; failCount: number }, stepBefore: number | null): { step: number; failCount: number } {
  return { step: Math.max(state.step, stepBefore ?? state.step), failCount: Math.max(0, state.failCount - 1) };
}

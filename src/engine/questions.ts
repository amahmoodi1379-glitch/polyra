import type { QuestionC } from "./content";
import { dictationWords, scoreDictation, type DictWord } from "./dictation";
import { cleanAnswer, toLatinDigits, type Lang } from "./text";

/**
 * Grading the questions of a text (PRD §7.3). Every question has one right answer; an order, a match
 * and a cloze are right only when every part is. «نمی‌دانم» and a wrong answer score the same (§7.4).
 */

/** What the browser sends for one question; `idk` is «نمی‌دانم». */
export type QuestionAnswer =
  | { idk: true }
  | { choice: number }
  | { value: boolean }
  | { order: number[] }
  | { pairs: [number, number][] }
  | { fills: string[] }
  | { sentence: number }
  | { text: string };

export type QuestionResult = "correct" | "wrong" | "idk";

export type GradedQuestion = {
  questionId: number;
  result: QuestionResult;
  /** The answer as written to `review_log.raw_answer`. */
  raw: string | null;
  /** A dictation's marks, word by word (PRD §7.3 step 6). */
  marks?: (boolean | null)[];
};

const sameList = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, i) => value === b[i]);
const pairKey = ([left, right]: [number, number]) => `${left}:${right}`;
/** A number, a time or a price as written: Persian digits are fine (PRD §5.6 step 5), case and spaces are not part of it. */
const numberForm = (text: string) => toLatinDigits(cleanAnswer(text, false)).toLowerCase().replace(/\s+/g, "");

/** A dictated sentence: its text and its names, which are not scored (PRD §7.3 step 2). */
export type DictSource = { text: string; names: readonly string[] };

/** The names of a sentence, from its glosses. */
export const dictSource = (sentence: { text: string; glosses: readonly { start: number; end: number; kind: string }[] }): DictSource => ({
  text: sentence.text,
  names: sentence.glosses.filter((gloss) => gloss.kind === "name").map((gloss) => sentence.text.slice(gloss.start, gloss.end)),
});

/** The words of a dictated sentence, its names not scored. */
export const dictationOf = (source: DictSource): DictWord[] => dictationWords(source.text, source.names);

function answered(question: QuestionC, answer: QuestionAnswer, sentence: DictSource | undefined, lang: Lang): Omit<GradedQuestion, "questionId"> {
  const right = (ok: boolean, raw: string) => ({ result: ok ? ("correct" as const) : ("wrong" as const), raw });
  switch (question.type) {
    case "mcq":
    case "ctx":
      return "choice" in answer ? right(answer.choice === question.correct, String(answer.choice)) : { result: "wrong", raw: null };
    case "tf":
      return "value" in answer ? right(answer.value === question.correct, String(answer.value)) : { result: "wrong", raw: null };
    case "order":
      return "order" in answer ? right(sameList(answer.order, question.correctOrder), answer.order.join(",")) : { result: "wrong", raw: null };
    case "match": {
      if (!("pairs" in answer)) return { result: "wrong", raw: null };
      const given = new Set(answer.pairs.map(pairKey));
      const ok = answer.pairs.length === question.pairs.length && question.pairs.every((pair) => given.has(pairKey(pair)));
      return right(ok, answer.pairs.map(pairKey).join(","));
    }
    case "cloze": {
      if (!("fills" in answer)) return { result: "wrong", raw: null };
      const ok = answer.fills.length === question.answers.length && question.answers.every((word, i) => answer.fills[i] === word);
      return right(ok, answer.fills.join(" | "));
    }
    case "find":
      return "sentence" in answer ? right(answer.sentence === question.correctSentence, String(answer.sentence)) : { result: "wrong", raw: null };
    case "num": {
      if (!("text" in answer)) return { result: "wrong", raw: null };
      const given = numberForm(answer.text);
      return right(given !== "" && question.accepted.some((value) => numberForm(value) === given), answer.text);
    }
    case "dict": {
      if (!("text" in answer) || !sentence) return { result: "wrong", raw: "text" in answer ? answer.text : null };
      const scored = scoreDictation(answer.text, dictationOf(sentence), lang);
      return { result: scored.ok ? "correct" : "wrong", raw: answer.text, marks: scored.marks };
    }
  }
}

/**
 * Grades one question. `sentence` is the text's sentence a dictation asks for. A missing answer is
 * «نمی‌دانم», or wrong when the time of a timed reading ran out (PRD §7.4).
 */
export function gradeQuestion(question: QuestionC, answer: QuestionAnswer | undefined, opts: { lang: Lang; sentence?: DictSource; timedOut?: boolean }): GradedQuestion {
  if (!answer) return { questionId: question.id, result: opts.timedOut ? "wrong" : "idk", raw: null };
  if ("idk" in answer) return { questionId: question.id, result: "idk", raw: null };
  return { questionId: question.id, ...answered(question, answer, opts.sentence, opts.lang) };
}

/** The share of right answers, the stage's `s` (PRD §7.4). */
export const stageScore = (graded: readonly GradedQuestion[]) => (graded.length === 0 ? 0 : graded.filter((item) => item.result === "correct").length / graded.length);

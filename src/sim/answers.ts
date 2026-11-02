/**
 * How a made-up learner answers (PRD §16.3): the right answer of every exercise and text question, a
 * near slip, and the wrong answers a learner gives. Used by the simulator, the engine tests and the
 * panel's «آزمایش مثل زبان‌آموز». Pure, like the engine.
 */
import type { QuestionC } from "@/engine/content";
import type { Ex, RawAnswer } from "@/engine/ex";
import type { Rng } from "@/engine/random";
import type { QuestionAnswer } from "@/engine/questions";
import type { Card, SessionPlan, TextView } from "@/engine/session/types";
import { folds, type Lang } from "@/engine/text";

export function rightAnswer(ex: Ex): RawAnswer {
  const spec = ex.a;
  switch (spec.kind) {
    case "choice":
    case "spot":
      return { choice: spec.correct };
    case "choice2":
      return { choices: spec.correct };
    case "type":
      return { text: spec.accepted[0], gender: spec.gender?.correct ?? null };
    case "letters":
      return { letters: spec.hidden.map((i) => [...spec.word][i]) };
    case "tiles":
      return { tiles: spec.orders[0] };
    case "pairs":
      return { firstPair: spec.pairs[spec.target] };
    case "sort":
      return { firstSort: Object.fromEntries(spec.items.map((item) => [item.id, item.set])) };
    case "table":
      return { rows: spec.rows.map((row) => row.accepted?.[0] ?? "") };
    case "dictation":
      return { text: spec.words.map((word) => word.text).join(" ") };
    case "liaison":
      return { gaps: spec.correct };
  }
}

export function wrongAnswer(ex: Ex): RawAnswer {
  const spec = ex.a;
  if (spec.kind === "choice") return { choice: spec.options.find((option) => option.id !== spec.correct)!.id };
  if (ex.idk) return { idk: true };
  if (spec.kind === "pairs") return { firstPair: spec.right.find((item) => item.id !== spec.pairs[spec.target])!.id };
  if (spec.kind === "sort") return { firstSort: Object.fromEntries(spec.items.map((item) => [item.id, item.set + 1])) };
  return { idk: true };
}

/** A typed answer one small slip away (PRD §5.6): without accents, or a German noun in lower case. Null when there is none. */
export function nearAnswer(ex: Ex, language: Lang): RawAnswer | null {
  if (ex.a.kind !== "type") return null;
  const right = ex.a.accepted[0];
  const [folded] = folds(right);
  if (folded !== right) return { text: folded, gender: ex.a.gender?.correct ?? null };
  if (language === "de" && /^\p{Lu}/u.test(right) && !ex.a.sentence) return { text: right.toLowerCase(), gender: ex.a.gender?.correct ?? null };
  return null;
}

/** A wrong answer of the kind a learner gives: a wrong option, a typo, or «نمی‌دانم». */
export function slipAnswer(ex: Ex, rng: Rng): RawAnswer {
  const spec = ex.a;
  if (ex.idk && rng() < 0.3) return { idk: true };
  if (spec.kind === "type") return { text: `${spec.accepted[0].slice(0, -2)}qx`, gender: spec.gender?.buttons.find((button) => button !== spec.gender?.correct) ?? null };
  if (spec.kind === "letters") return { letters: spec.hidden.map(() => "q") };
  if (spec.kind === "table") return { rows: spec.rows.map((row) => (row.accepted ? "qx" : "")) };
  if (spec.kind === "tiles") return { tiles: [...spec.orders[0]].reverse() };
  if (spec.kind === "dictation") return { text: spec.words.slice(0, Math.ceil(spec.words.length / 2)).map((word) => word.text).join(" ") };
  if (spec.kind === "liaison") return { gaps: spec.correct.slice(1) };
  return wrongAnswer(ex);
}

/** The right answer of a text question (PRD §7.3). */
export function rightQuestion(question: QuestionC, view: TextView): QuestionAnswer {
  switch (question.type) {
    case "mcq":
    case "ctx":
      return { choice: question.correct };
    case "tf":
      return { value: question.correct };
    case "order":
      return { order: question.correctOrder };
    case "match":
      return { pairs: question.pairs };
    case "cloze":
      return { fills: question.answers };
    case "find":
      return { sentence: question.correctSentence };
    case "num":
      return { text: question.accepted[0] };
    case "dict":
      return { text: view.sentences[question.sentence]?.text ?? "" };
  }
}

/** A wrong answer of a text question. */
export function wrongQuestion(question: QuestionC): QuestionAnswer {
  switch (question.type) {
    case "mcq":
    case "ctx":
      return { choice: (question.correct + 1) % question.options.length };
    case "tf":
      return { value: !question.correct };
    case "order":
      return { order: [...question.correctOrder].reverse() };
    case "match":
      return { pairs: question.pairs.map(([left], i) => [left, question.pairs[(i + 1) % question.pairs.length][1]] as [number, number]) };
    case "cloze":
      return { fills: question.answers.map(() => "qx") };
    case "find":
      return { sentence: question.correctSentence + 1 };
    case "num":
      return { text: "0" };
    case "dict":
      return { text: "qx" };
  }
}

/** The answers of a text stage: each question right with its chance, else wrong or now and then «نمی‌دانم». */
export function textAnswers(plan: SessionPlan, card: Card, rng: Rng, chance: number | ((question: QuestionC) => number)): RawAnswer {
  const info = card.text!;
  const view = plan.texts[info.textId];
  const answers: Record<string, QuestionAnswer> = {};
  for (const question of view.questions[info.set]) {
    const p = typeof chance === "number" ? chance : chance(question);
    answers[String(question.id)] = rng() < p ? rightQuestion(question, view) : rng() < 0.3 ? { idk: true } : wrongQuestion(question);
  }
  return { answers };
}

/**
 * A speaking card (PRD §8b), right with chance `p`: «درست گفتم» or «تقریباً» / «بلد نبودم»; each turn
 * of a dialogue, each mistake of a find-the-mistake text, now and then a right word changed.
 */
export function productionAnswer(card: Card, rng: Rng, p: number): RawAnswer {
  const prod = card.prod!;
  if (prod.kind === "speak") return { self: rng() < p ? "ok" : rng() < 0.5 ? "near" : "no" };
  if (prod.kind === "dialogue") return { turns: prod.view.turns.map((turn) => (rng() < p ? turn.correct : (turn.correct + 1 + Math.floor(rng() * (turn.choices.length - 1))) % turn.choices.length)) };
  const fixes: Record<string, string> = {};
  prod.view.pieces.forEach((piece, index) => {
    if (piece.mark !== null && rng() < p) fixes[String(index)] = prod.view.marks[piece.mark].right;
    else if (piece.mark === null && piece.word && rng() < (1 - p) * 0.1) fixes[String(index)] = `${piece.text}x`;
  });
  return { fixes };
}

/** How a made-up learner answers a card; `plan` and `at` let a model of memory look at the item's state. */
export type Policy = (card: Card, ex: Ex | null, rng: Rng, info: { plan: SessionPlan; at: Date }) => { answer: RawAnswer; latencyMs: number };

import { fold } from "@/engine/tokens";
import type { Token } from "@/schemas/common";
import { question as questionSchema, type QuestionRecord } from "@/schemas/texts";
import { problem, zodProblems, type Problem } from "./problems";

/**
 * The checks of a text's questions that Zod cannot do (PRD §7.3, §7.7, §13.3): which types each track
 * and band allows, how many questions each set has, and that every answer points at something real.
 */

export type Track = "reading" | "listening";
export type SetName = "A" | "B";
type QuestionType = QuestionRecord["type"];

export const tracks: Track[] = ["reading", "listening"];
export const setNames: SetName[] = ["A", "B"];

/** Question types per track and band (PRD §7.3). */
const typeRules: Record<QuestionType, { tracks: Track[]; bands: number[] }> = {
  mcq: { tracks: ["reading", "listening"], bands: [1, 2, 3, 4] },
  tf: { tracks: ["reading", "listening"], bands: [1, 2, 3] },
  order: { tracks: ["reading", "listening"], bands: [1, 2, 3, 4] },
  dict: { tracks: ["listening"], bands: [1] },
  num: { tracks: ["listening"], bands: [1, 2, 3] },
  match: { tracks: ["reading"], bands: [1, 2, 3] },
  find: { tracks: ["reading"], bands: [1, 2, 3, 4] },
  cloze: { tracks: ["reading"], bands: [2, 3, 4] },
  ctx: { tracks: ["reading"], bands: [3, 4] },
};

export function allowedTypes(track: Track, band: number): QuestionType[] {
  return (Object.keys(typeRules) as QuestionType[]).filter((type) => typeRules[type].tracks.includes(track) && typeRules[type].bands.includes(band));
}

/** Questions per set: 2 to 8 in band 1, 3 to 8 above; set A of a placement text has at least 4 (PRD §7.4, §7.7). */
export function questionRange(band: number, set: SetName, placement: boolean): [number, number] {
  const min = band === 1 ? 2 : 3;
  return [set === "A" && placement ? Math.max(min, 4) : min, 8];
}

const MCQ_OPTIONS = 4;
const ORDER_ITEMS = [4, 5];
const digit = /\p{Nd}/u;
const gapPattern = /\{\{\s*(\d+)\s*\}\}/g;

const same = (value: string) => fold(value).replace(/\s+/g, " ").trim();
const distinct = (values: string[]) => new Set(values.map(same)).size === values.length;
const inRange = (index: number, length: number) => Number.isInteger(index) && index >= 0 && index < length;
const isPermutation = (order: number[], length: number) =>
  order.length === length && new Set(order).size === length && order.every((index) => inRange(index, length));

export type TextForQuestions = {
  band: number;
  placement: boolean;
  sentences: { text: string; tokens: Pick<Token, "kind">[] }[];
};

export type CheckedQuestion = { track: Track; set: SetName; order_no: number; question: QuestionRecord };

function checkOne(item: QuestionRecord, path: string, text: TextForQuestions, words: string): Problem[] {
  const problems: Problem[] = [];
  const at = (field: string) => `${path}.${field}`;
  const sentenceCount = text.sentences.length;
  switch (item.type) {
    case "mcq":
    case "ctx":
      if (item.options.length !== MCQ_OPTIONS) problems.push(problem("optionsCount", { field: at("options"), count: MCQ_OPTIONS }));
      if (!distinct(item.options)) problems.push(problem("listRepeat", { field: at("options") }));
      if (!inRange(item.correct, item.options.length)) problems.push(problem("answerOutOfRange", { field: at("correct") }));
      if (item.type === "ctx" && !words.includes(same(item.word))) {
        problems.push(problem("ctxWord", { text: item.word, field: at("word") }));
      }
      break;
    case "order":
      if (!ORDER_ITEMS.includes(item.items.length) || !isPermutation(item.correct_order, item.items.length)) {
        problems.push(problem("orderInvalid", { field: at("items") }));
      } else if (!distinct(item.items)) {
        problems.push(problem("listRepeat", { field: at("items") }));
      }
      break;
    case "match": {
      const lefts = item.pairs.map(([left]) => left);
      const rights = item.pairs.map(([, right]) => right);
      const valid =
        item.right.length >= item.left.length &&
        isPermutation([...lefts].sort((a, b) => a - b), item.left.length) &&
        new Set(rights).size === rights.length &&
        rights.every((index) => inRange(index, item.right.length));
      if (!valid) problems.push(problem("matchInvalid", { field: at("pairs") }));
      if (!distinct(item.left)) problems.push(problem("listRepeat", { field: at("left") }));
      if (!distinct(item.right)) problems.push(problem("listRepeat", { field: at("right") }));
      break;
    }
    case "cloze": {
      const gaps = [...item.text_with_gaps.matchAll(gapPattern)].map((match) => Number(match[1]));
      const bank = new Set(item.bank.map(same));
      const valid =
        gaps.length === item.answers.length && gaps.every((gap, index) => gap === index + 1) && item.answers.every((answer) => bank.has(same(answer)));
      if (!valid) problems.push(problem("clozeInvalid", { field: at("text_with_gaps") }));
      if (!distinct(item.bank)) problems.push(problem("listRepeat", { field: at("bank") }));
      break;
    }
    case "find":
      if (!inRange(item.correct_sentence, sentenceCount)) problems.push(problem("answerOutOfRange", { field: at("correct_sentence") }));
      break;
    case "num":
      if (!digit.test(item.answer) || !item.accepted.some((value) => same(value) === same(item.answer))) {
        problems.push(problem("numInvalid", { field: at("answer") }));
      }
      if (!distinct(item.accepted)) problems.push(problem("listRepeat", { field: at("accepted") }));
      break;
    case "dict": {
      if (!inRange(item.sentence, sentenceCount)) {
        problems.push(problem("answerOutOfRange", { field: at("sentence") }));
        break;
      }
      const sentence = text.sentences[item.sentence];
      // A sentence with a number written in digits is not dictated; numbers are asked with num (PRD §7.3).
      if (sentence.tokens.some((token) => token.kind === "number") || digit.test(sentence.text)) {
        problems.push(problem("dictNumber", { field: at("sentence") }));
      }
      break;
    }
    case "tf":
      break;
  }
  return problems;
}

/** What makes two questions the same: their type and prompt, or the dictated sentence. */
function questionKey(item: QuestionRecord) {
  return item.type === "dict" ? `dict|${item.sentence}` : `${item.type}|${same(item.prompt)}`;
}

/**
 * Checks the four question sets of a text. Returns every problem with the path of its question (for
 * the fix prompt and the report), and the parsed questions in order when there is none.
 */
export function checkQuestionSets(sets: Record<Track, Record<SetName, unknown[]>>, text: TextForQuestions) {
  const problems: Problem[] = [];
  const questions: CheckedQuestion[] = [];
  const words = text.sentences.map((sentence) => same(sentence.text)).join(" ");

  for (const track of tracks) {
    const keys: Record<SetName, Map<string, string>> = { A: new Map(), B: new Map() };
    const allowed = allowedTypes(track, text.band);
    for (const set of setNames) {
      const list = sets[track][set];
      const [min, max] = questionRange(text.band, set, text.placement);
      const base = `question_sets.${track}.${set}`;
      if (list.length < min || list.length > max) problems.push(problem("questionCount", { field: base, count: list.length, min, max }));

      for (const [index, raw] of list.entries()) {
        const path = `${base}[${index}]`;
        const parsed = questionSchema.safeParse(raw, { reportInput: true });
        if (!parsed.success) {
          problems.push(...zodProblems(parsed.error, path));
          continue;
        }
        const item = parsed.data;
        if (!allowed.includes(item.type)) {
          problems.push(problem("questionType", { type: item.type, field: path, allowed: allowed.join("، ") }));
          continue;
        }
        // From band 3 the question is in the target language and its Persian translation can be opened (§7.3).
        if (text.band >= 3 && item.type !== "dict" && !item.prompt_fa) problems.push(problem("missing", { field: `${path}.prompt_fa` }));
        problems.push(...checkOne(item, path, text, words));
        keys[set].set(questionKey(item), item.type === "dict" ? `dict ${item.sentence + 1}` : item.prompt);
        questions.push({ track, set, order_no: index + 1, question: item });
      }
    }
    for (const [key, prompt] of keys.A) {
      if (keys.B.has(key)) problems.push(problem("questionRepeat", { text: prompt }));
    }
  }
  return { problems, questions };
}

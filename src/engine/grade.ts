import { scoreDictation } from "./dictation";
import type { AnswerSpec, Ex, RawAnswer } from "./ex";
import { parseItemKey } from "./state";
import { cleanAnswer, hasPersianLetter, matchAny, matchText, oneLetterOff, stripArticle, words, type Lang, type TextMatch } from "./text";

/**
 * `grade` (PRD §15.3): an exercise and the learner's raw answer in, the result out. The browser and
 * the server run the same function on the same exercise data.
 */

export type ResultReason = "accent" | "case" | "gender" | "typo";

export type Graded = {
  result: "correct" | "near" | "wrong" | "idk";
  reason: ResultReason | null;
  /** The other word the learner's answer belongs to (PRD §9.9). */
  chosenWordId: number | null;
  /** The answer as text, for `review_log.raw_answer`. */
  raw: string;
};

/** The answer is not graded: a synonym gets one more try, Persian letters a keyboard message (PRD §5.6). */
export type GradeOutcome = Graded | { result: "synonym"; first: string } | { result: "persian" };

export type GradeContext = {
  language: Lang;
  /** Word ids with this lower-case lemma, for a typed answer that is another word (PRD §9.9). */
  wordsWithLemma?: (lemma: string) => number[];
};

/** The exercises whose wrong answer can name another word, for confusion pairs (PRD §9.9). */
const PAIR_CODES = new Set(["W1a", "W1b", "W2a", "W2b", "W2c", "W3b", "W5a", "W6a"]);

const graded = (result: Graded["result"], raw: string, reason: ResultReason | null = null, chosenWordId: number | null = null): Graded => ({
  result,
  reason,
  chosenWordId,
  raw,
});

const fromMatch = (match: TextMatch, raw: string): Graded => (match.result === "near" ? graded("near", raw, match.reason) : graded(match.result, raw));

/** Words typed into a whole sentence may have one typo in a word the change did not touch (PRD §6.5). */
function transformTypo(given: string, outputs: string[], source: string, language: Lang): boolean {
  const norm = (text: string) => (language === "fr" ? text.toLowerCase() : text);
  const givenWords = words(norm(given));
  const sourceWords = new Set(words(norm(cleanAnswer(source, true))));
  return outputs.some((output) => {
    const outWords = words(norm(output));
    if (outWords.length !== givenWords.length) return false;
    const diff = outWords.flatMap((word, i) => (word === givenWords[i] ? [] : [i]));
    if (diff.length !== 1) return false;
    const i = diff[0];
    return sourceWords.has(outWords[i]) && oneLetterOff(givenWords[i], outWords[i]);
  });
}

/** Minimum letters of a word for the sample's one-letter allowance (PRD §5.6). */
export const TYPO_MIN_LETTERS = 5;

/**
 * The vocabulary sample and the vocabulary skip test (PRD §5.6): one letter missing, extra, changed or two
 * next ones swapped, in a word of at least five letters, when what was typed is not another word's form.
 */
function sampleTypo(given: string, accepted: string[], others: string[], language: Lang): boolean {
  const norm = (text: string) => (language === "fr" ? text.toLowerCase() : text);
  const typed = norm(given);
  if (others.some((form) => norm(form) === typed)) return false;
  return accepted.some((answer) => [...answer].length >= TYPO_MIN_LETTERS && oneLetterOff(typed, norm(answer)));
}

function gradeTyped(spec: Extract<AnswerSpec, { kind: "type" }>, answer: { text: string; gender?: string | null; retry?: boolean }, ex: Ex, ctx: GradeContext): GradeOutcome {
  const { language } = ctx;
  if (hasPersianLetter(answer.text)) return { result: "persian" };
  const prepare = (text: string) => {
    const cleaned = cleanAnswer(text, spec.multi);
    return spec.noun ? stripArticle(cleaned, language) : cleaned;
  };
  const given = prepare(answer.text);
  const raw = answer.gender ? `${answer.text} · ${answer.gender}` : answer.text;
  if (!given) return graded("wrong", raw);
  const accepted = spec.accepted.map(prepare);
  const match = matchAny(given, accepted, language, spec.sentence);

  if (match.result !== "wrong") {
    if (spec.gender && answer.gender !== spec.gender.correct) return graded("near", raw, "gender");
    return fromMatch(match, raw);
  }
  if (spec.transformSource && transformTypo(given, accepted, spec.transformSource, language)) return graded("near", raw, "typo");
  if (spec.typo && sampleTypo(given, accepted, spec.typo, language)) return graded("near", raw, "typo");

  const synonym = spec.synonyms.some((lemma) => matchText(given, prepare(lemma), language, spec.sentence).result !== "wrong");
  if (synonym) return answer.retry ? graded("wrong", raw) : { result: "synonym", first: spec.first };

  // A typed word that is another word of the list (PRD §9.9, W5a and W6a).
  let chosen: number | null = null;
  if (PAIR_CODES.has(ex.code) && ctx.wordsWithLemma) {
    const target = parseItemKey(ex.item).id;
    chosen = ctx.wordsWithLemma(given.toLowerCase()).find((id) => id !== target) ?? null;
  }
  return graded("wrong", raw, null, chosen);
}

function gradeTable(spec: Extract<AnswerSpec, { kind: "table" }>, rows: string[], language: Lang): GradeOutcome {
  if (rows.some(hasPersianLetter)) return { result: "persian" };
  const raw = rows.join(" | ");
  let near: ResultReason | null = null;
  for (const [i, row] of spec.rows.entries()) {
    if (!row.accepted) continue;
    const given = rows[i] ?? "";
    const multi = row.accepted.some((form) => form.includes(" "));
    const match = matchAny(
      cleanAnswer(given, multi),
      row.accepted.map((form) => cleanAnswer(form, multi)),
      language,
      false,
    );
    if (match.result === "wrong") return graded("wrong", raw);
    if (match.result === "near") near ??= match.reason;
  }
  return near ? graded("near", raw, near) : graded("correct", raw);
}

export function grade(ex: Ex, answer: RawAnswer, ctx: GradeContext): GradeOutcome {
  if ("idk" in answer) return graded("idk", "");
  const spec = ex.a;
  const isWord = ex.item.startsWith("w:");

  switch (spec.kind) {
    case "choice": {
      if (!("choice" in answer)) return graded("wrong", "");
      const option = spec.options.find((item) => item.id === answer.choice);
      const raw = option?.text ?? answer.choice;
      if (answer.choice === spec.correct) return graded("correct", raw);
      const chosen = isWord && PAIR_CODES.has(ex.code) && option?.wordId && option.wordId !== parseItemKey(ex.item).id ? option.wordId : null;
      return graded("wrong", raw, null, chosen);
    }
    case "choice2": {
      if (!("choices" in answer)) return graded("wrong", "");
      const raw = answer.choices.map((id, i) => spec.groups[i].find((item) => item.id === id)?.text ?? id).join(" | ");
      return graded(answer.choices[0] === spec.correct[0] && answer.choices[1] === spec.correct[1] ? "correct" : "wrong", raw);
    }
    case "spot": {
      if (!("choice" in answer)) return graded("wrong", "");
      const raw = spec.parts.find((part) => part.id === answer.choice)?.text ?? answer.choice;
      return graded(answer.choice === spec.correct ? "correct" : "wrong", raw);
    }
    case "type":
      if (!("text" in answer)) return graded("wrong", "");
      return gradeTyped(spec, answer, ex, ctx);
    case "letters": {
      if (!("letters" in answer)) return graded("wrong", "");
      const letters = [...spec.word];
      spec.hidden.forEach((position, i) => (letters[position] = answer.letters[i] ?? ""));
      const built = letters.join("");
      if (hasPersianLetter(built)) return { result: "persian" };
      return fromMatch(matchText(cleanAnswer(built, false), spec.word, ctx.language, false), built);
    }
    case "tiles": {
      if (!("tiles" in answer)) return graded("wrong", "");
      const built = answer.tiles.join(" ");
      return graded(spec.orders.some((order) => order.join(" ") === built) ? "correct" : "wrong", built);
    }
    case "pairs": {
      if (!("firstPair" in answer)) return graded("wrong", "");
      const raw = spec.right.find((item) => item.id === answer.firstPair)?.text ?? answer.firstPair;
      return graded(answer.firstPair === spec.pairs[spec.target] ? "correct" : "wrong", raw);
    }
    case "sort": {
      if (!("firstSort" in answer)) return graded("wrong", "");
      const ok = spec.items.every((item) => answer.firstSort[item.id] === item.set);
      return graded(ok ? "correct" : "wrong", spec.items.map((item) => `${item.text}:${answer.firstSort[item.id] ?? "-"}`).join(" "));
    }
    case "table":
      if (!("rows" in answer)) return graded("wrong", "");
      return gradeTable(spec, answer.rows, ctx.language);
    case "dictation": {
      if (!("text" in answer)) return graded("wrong", "");
      if (hasPersianLetter(answer.text)) return { result: "persian" };
      return graded(scoreDictation(answer.text, spec.words, ctx.language).ok ? "correct" : "wrong", answer.text);
    }
    case "liaison": {
      if (!("gaps" in answer)) return graded("wrong", "");
      const given = [...new Set(answer.gaps)].sort((a, b) => a - b);
      const right = given.length === spec.correct.length && given.every((gap, i) => gap === spec.correct[i]);
      return graded(right ? "correct" : "wrong", spec.words.map((word, i) => (given.includes(i) ? `${word}‿` : `${word} `)).join("").trim());
    }
  }
}

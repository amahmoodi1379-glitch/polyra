import { describe, expect, it } from "vitest";
import { checkTokens, fold, type VocabEntry, type Vocabulary } from "@/engine/tokens";
import { checkTarget } from "@/server/content/kinds/sentence-store";
import { demoUnits, grammarAnswer, sentencesAnswer, tablesAnswer, tokensOf, unitListAnswer, wordDistractors, wordsAnswer } from "../../fixtures/demo-fr/build";
import { cardWords, formExceptions } from "../../fixtures/demo-fr/words";

/** The demo's vocabulary as the importers will load it (src/server/content/vocabulary.ts). */
function demoVocabulary(): Vocabulary {
  const words = wordsAnswer().words;
  const tables = tablesAnswer().tables;
  const entries = words.map((word, id): VocabEntry & { code: string } => ({
    id,
    code: word.code,
    lemma: word.lemma,
    plural: word.plural,
    pos: word.pos,
    forms: tables.filter((table) => table.verb === word.code).flatMap((table) => Object.values(table.forms)),
    partLemmas: [],
  }));
  const byCode = new Map(entries.map((entry) => [entry.code, entry]));
  const lemmas = new Set(entries.flatMap((entry) => [fold(entry.lemma), ...(entry.plural ? [fold(entry.plural)] : [])]));
  const exceptions = new Set(formExceptions.map((item) => `${byCode.get(item.code)!.id}:${fold(item.surface)}`));
  return {
    byCode: (code) => byCode.get(code),
    hasLemmaOrPlural: (text) => lemmas.has(fold(text)),
    isException: (id, surface) => exceptions.has(`${id}:${fold(surface)}`),
  };
}

const vocabulary = demoVocabulary();

function expectClean(text: string, tokens: ReturnType<typeof tokensOf>) {
  const result = checkTokens(text, tokens, vocabulary);
  if (!result.ok) throw new Error(`${text}: ${JSON.stringify(result.problems)}`);
  const flagged = result.rows.filter((row) => row.suspect || row.candidate_reason);
  expect(flagged.map((row) => `${text}: ${row.surface}`)).toEqual([]);
}

describe("French demo content", () => {
  it("has 60 card words, unique codes and plain records", () => {
    const words = wordsAnswer().words;
    expect(cardWords).toHaveLength(60);
    expect(new Set(words.map((word) => word.code)).size).toBe(words.length);
    expect(unitListAnswer().units).toHaveLength(6);
  });

  it("maps every bank sentence without a candidate or a suspect, and every target follows the blank rules", () => {
    const answer = sentencesAnswer();
    for (const sentence of answer.sentences) {
      expectClean(sentence.text, sentence.tokens);
      for (const target of sentence.targets) {
        expect(checkTarget({ ...target, blanks: 1 }, sentence.text, "")).toEqual([]);
      }
    }
  });

  it("gives every card word at least three sentence targets", () => {
    const counts = new Map<string, number>();
    for (const sentence of sentencesAnswer().sentences) for (const target of sentence.targets) counts.set(target.target, (counts.get(target.target) ?? 0) + 1);
    const short = cardWords.filter((word) => (counts.get(word.code) ?? 0) < 3).map((word) => word.code);
    expect(short).toEqual([]);
  });

  it("maps every grammar sentence and keeps the blank rules", () => {
    for (const unit of demoUnits) {
      const answer = grammarAnswer(unit);
      for (const example of answer.unit.example_sentences) expectClean(example.text, example.tokens);
      for (const target of answer.targets) {
        expectClean(target.sentence.text, target.sentence.tokens);
        expect(checkTarget(target as Parameters<typeof checkTarget>[0], target.sentence.text, "")).toEqual([]);
      }
      for (const item of answer.translations) expectClean(item.accepted_outputs[0], item.tokens);
    }
  });

  it("gives verb meanings by person and negation", () => {
    const meaning = (text: string, surface: string) => tokensOf(text).find((token) => token.surface === surface)?.meaning_fa;
    expect(meaning("Nous mangeons ici.", "mangeons")).toBe("می‌خوریم");
    expect(meaning("Je ne parle pas français.", "parle")).toBe("حرف نمی‌زنم");
    expect(meaning("Il n'aime pas le café.", "aime")).toBe("دوست ندارد");
    expect(meaning("Paul n'est pas ici.", "est")).toBe("نیست");
    expect(meaning("Les chats.", "chats")).toBe("گربه‌ها");
  });

  it("picks wrong options in the blank's own form", () => {
    expect(wordDistractors("grande")).toEqual(expect.arrayContaining([expect.stringMatching(/e$/)]));
    expect(wordDistractors("mangeons")).toEqual(["avons", "sommes", "buvons"]);
    expect(wordDistractors("Bonjour").every((option) => /^\p{Lu}/u.test(option))).toBe(true);
  });
});

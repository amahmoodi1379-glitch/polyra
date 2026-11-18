import { describe, expect, it } from "vitest";
import { sentenceCore } from "@/schemas/common";
import { unitRecord } from "@/schemas/grammar";
import { wordRecord } from "@/schemas/words";
import { zodProblems } from "@/server/content/problems";

/**
 * Every Persian field holds Persian and every target-language field holds no Persian letter: a meaning
 * left in French, or a sentence with a Persian letter the learner could never type (PRD §5.6), is
 * refused on import and on edit with a plain message.
 */
const problemsOf = (schema: { safeParse: (value: unknown, params: { reportInput: true }) => { success: boolean; error?: unknown } }, value: unknown) => {
  const parsed = schema.safeParse(value, { reportInput: true });
  return parsed.success ? [] : zodProblems(parsed.error as Parameters<typeof zodProblems>[0]).map((item) => [item.key, item.vars?.field]);
};

const word = { code: "voiture", lemma: "voiture", pos: "noun", gender: "f", meaning_fa: "ماشین", level: "A1", concept_fa: "ماشین" };

describe("Persian and target-language fields (PRD §14)", () => {
  it("accepts a good word, Latin letters inside a Persian meaning included", () => {
    expect(problemsOf(wordRecord, word)).toEqual([]);
    expect(problemsOf(wordRecord, { ...word, meaning_fa: "ماشین (اتومبیل) CD" })).toEqual([]);
  });

  it("refuses a meaning written in the target language or mostly in Latin letters", () => {
    expect(problemsOf(wordRecord, { ...word, meaning_fa: "car" })).toEqual([["notPersian", "meaning_fa"]]);
    expect(problemsOf(wordRecord, { ...word, meaning_fa: "la petite voiture rouge ماشین" })).toEqual([["notPersian", "meaning_fa"]]);
    expect(problemsOf(wordRecord, { ...word, meaning_fa: "تی‌شرت (T-shirt)" })).toEqual([]);
    expect(problemsOf(wordRecord, { ...word, concept_fa: "vehicle" })).toEqual([["notPersian", "concept_fa"]]);
  });

  it("refuses a Persian letter in a lemma or a sentence", () => {
    expect(problemsOf(wordRecord, { ...word, lemma: "voitureی" })).toEqual([["persianInTarget", "lemma"]]);
    const sentence = { text: "J'ai une voiture.", translation_fa: "من یک ماشین دارم.", tokens: [{ surface: "voiture", code: "voiture" }] };
    expect(problemsOf(sentenceCore, sentence)).toEqual([]);
    expect(problemsOf(sentenceCore, { ...sentence, text: "J'ai une ماشین." })).toEqual([["persianInTarget", "text"]]);
    expect(problemsOf(sentenceCore, { ...sentence, translation_fa: "I have a car." })).toEqual([["notPersian", "translation_fa"]]);
  });

  it("a lesson may quote the language at length, but needs Persian", () => {
    const unit = { unit_code: "fr-a1-etre", title_fa: "فعل être", level: "A1", lesson_fa: "je suis, tu es, il est, nous sommes, vous êtes, ils sont: فعل بودن", rule_line_fa: "être یعنی بودن", common_mistake_fa: "je suis، نه je es" };
    expect(problemsOf(unitRecord, unit)).toEqual([]);
    expect(problemsOf(unitRecord, { ...unit, lesson_fa: "je suis, tu es" })).toEqual([["notPersian", "lesson_fa"]]);
  });

  it("an empty field is reported once, as missing", () => {
    expect(problemsOf(wordRecord, { ...word, meaning_fa: "  " })).toEqual([["missing", "meaning_fa"]]);
  });
});

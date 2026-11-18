import { describe, expect, it } from "vitest";
import { checkWordDistractors } from "@/server/content/distractor-check";
import type { VocabWord } from "@/server/content/vocabulary";

/** W3b's wrong options (PRD §5.5): never a second right answer, never ruled out by grammar alone. */
let next = 1;
const w = (lemma: string, over: Partial<VocabWord> = {}): VocabWord => ({
  id: next++,
  code: lemma,
  lemma,
  plural: null,
  pos: "noun",
  forms: [],
  partLemmas: [],
  level: "A1",
  no_card: false,
  status: "published",
  meaning_fa: lemma,
  concept_id: null,
  gender: null,
  ...over,
});

const keys = (report: { synonyms: { key: string; vars?: Record<string, unknown> }[]; cues: { key: string; vars?: Record<string, unknown> }[] }) => ({
  synonyms: report.synonyms.map((item) => item.vars?.value),
  cues: report.cues.map((item) => [item.key, item.vars?.value]),
});

describe("W3b wrong options (PRD §5.5)", () => {
  it("refuses a synonym: same concept or the same meaning", () => {
    const voiture = w("voiture", { gender: "f", meaning_fa: "ماشین", concept_id: 7 });
    const auto = w("auto", { gender: "f", meaning_fa: "خودرو", concept_id: 7 });
    const bagnole = w("bagnole", { gender: "f", meaning_fa: "ماشین" });
    const maison = w("maison", { gender: "f", meaning_fa: "خانه" });
    const words = [voiture, auto, bagnole, maison, w("table", { gender: "f", meaning_fa: "میز" })];
    const report = checkWordDistractors({ markedText: "J'ai une {{voiture}} rouge.", distractors: ["auto", "bagnole", "maison"], target: voiture, words, language: "fr", field: "distractors" });
    expect(keys(report)).toEqual({ synonyms: ["auto", "bagnole"], cues: [] });
  });

  it("warns about another part of speech, a gender the article rules out, and a German capital", () => {
    const pomme = w("pomme", { gender: "f", meaning_fa: "سیب" });
    const words = [pomme, w("manger", { pos: "verb", meaning_fa: "خوردن", forms: ["mange"] }), w("pain", { gender: "m", meaning_fa: "نان" }), w("poire", { gender: "f", meaning_fa: "گلابی" })];
    const fr = checkWordDistractors({ markedText: "Je mange une {{pomme}}.", distractors: ["mange", "pain", "poire"], target: pomme, words, language: "fr", field: "distractors" });
    expect(keys(fr)).toEqual({ synonyms: [], cues: [["distractorPos", "mange"], ["distractorGender", "pain"]] });

    const tisch = w("Tisch", { gender: "der", meaning_fa: "میز" });
    const deWords = [tisch, w("Stuhl", { gender: "der", meaning_fa: "صندلی" }), w("Lampe", { gender: "die", meaning_fa: "چراغ" }), w("Bett", { gender: "das", meaning_fa: "تخت" })];
    const de = checkWordDistractors({ markedText: "Ich kaufe einen {{Tisch}}.", distractors: ["Stuhl", "Lampe", "bett"], target: tisch, words: deWords, language: "de", field: "distractors" });
    expect(keys(de)).toEqual({ synonyms: [], cues: [["distractorGender", "Lampe"], ["distractorCase", "bett"]] });
  });

  it("leaves alone options the list does not know and a plural article", () => {
    const pomme = w("pomme", { gender: "f", meaning_fa: "سیب" });
    const report = checkWordDistractors({ markedText: "Il aime les {{pommes}}.", distractors: ["poires", "fraises", "cerises"], target: pomme, words: [pomme, w("pain", { gender: "m" })], language: "fr", field: "distractors" });
    expect(keys(report)).toEqual({ synonyms: [], cues: [] });
  });
});

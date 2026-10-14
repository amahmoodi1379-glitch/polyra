import { describe, expect, it } from "vitest";
import { buildConjEx, buildGrammarEx, buildWordEx } from "@/engine/build";
import type { Ex } from "@/engine/ex";
import { grade, type GradeContext } from "@/engine/grade";
import { cleanAnswer, matchText } from "@/engine/text";
import { content, env, frenchSet, unit, word } from "./kit";

const fr: GradeContext = { language: "fr" };
const de: GradeContext = { language: "de" };

function w5a(lemma: string) {
  const set = frenchSet();
  const data = content(set);
  const item = [...data.words.values()].find((entry) => entry.lemma === lemma)!;
  const ex = buildWordEx(env(data), item, "W5a")!;
  const lemmaIndex = data.lemmaIndex;
  const ctx: GradeContext = { language: "fr", wordsWithLemma: (text) => lemmaIndex.get(text) ?? [] };
  return { ex, ctx };
}

describe("typed answers (PRD §5.6)", () => {
  it("T05: «ecole» for «école» is near with reason accent", () => {
    const { ex, ctx } = w5a("école");
    expect(grade(ex, { text: "ecole", gender: "une" }, ctx)).toMatchObject({ result: "near", reason: "accent" });
    expect(grade(ex, { text: "une école", gender: "une" }, ctx)).toMatchObject({ result: "correct" });
  });

  it("T06: «voitur» for «voiture» is wrong", () => {
    const { ex, ctx } = w5a("voiture");
    expect(grade(ex, { text: "voitur", gender: "une" }, ctx)).toMatchObject({ result: "wrong" });
  });

  it("T09 (grading): right word with the wrong gender button is near with reason gender", () => {
    const { ex, ctx } = w5a("voiture");
    expect(ex.a).toMatchObject({ kind: "type", gender: { buttons: ["un", "une"], correct: "une" } });
    expect(grade(ex, { text: "voiture", gender: "un" }, ctx)).toMatchObject({ result: "near", reason: "gender" });
  });

  it("T10: a synonym asks for one more try; the retry is then graded normally", () => {
    const { ex, ctx } = w5a("voiture");
    expect(grade(ex, { text: "auto", gender: "une" }, ctx)).toEqual({ result: "synonym", first: "v" });
    expect(grade(ex, { text: "voiture", gender: "une", retry: true }, ctx)).toMatchObject({ result: "correct" });
    // A synonym again on the retry is wrong (DECISIONS.md).
    expect(grade(ex, { text: "auto", gender: "une", retry: true }, ctx)).toMatchObject({ result: "wrong" });
  });

  it("T11: French ignores capitals; German counts a lower-case noun as near (case)", () => {
    const { ex, ctx } = w5a("voiture");
    expect(grade(ex, { text: "Voiture", gender: "une" }, ctx)).toMatchObject({ result: "correct" });
    expect(matchText("tisch", "Tisch", "de", false)).toEqual({ result: "near", reason: "case" });
  });

  it("T76: an answer with a Persian letter is not graded", () => {
    const { ex, ctx } = w5a("voiture");
    expect(grade(ex, { text: "وoiture", gender: "une" }, ctx)).toEqual({ result: "persian" });
    // Persian digits alone are fine (they are turned into Latin digits).
    expect(cleanAnswer("۱۲", false)).toBe("12");
  });

  it("T87: German «Gehen» for «gehen» and «tisch» for «Tisch» are both near (case)", () => {
    const gehen = word(1, "gehen", "رفتن", { pos: "verb" }, "de");
    const tisch = word(2, "Tisch", "میز", { gender: "der" }, "de");
    const data = content({ words: [gehen, tisch] }, "de");
    const e = env(data);
    expect(grade(buildWordEx(e, gehen, "W5a")!, { text: "Gehen" }, de)).toMatchObject({ result: "near", reason: "case" });
    expect(grade(buildWordEx(e, tisch, "W5a")!, { text: "tisch", gender: "der" }, de)).toMatchObject({ result: "near", reason: "case" });
    expect(grade(buildWordEx(e, tisch, "W5a")!, { text: "der Tisch", gender: "der" }, de)).toMatchObject({ result: "correct" });
  });

  it("T105: a phrase typed with a capital and a full stop is correct", () => {
    const phrase = word(1, "prendre une décision", "تصمیم گرفتن", { pos: "phrase" });
    const data = content({ words: [phrase] });
    const ex = buildWordEx(env(data), phrase, "W5a")!;
    expect(grade(ex, { text: "Prendre une décision." }, fr)).toMatchObject({ result: "correct" });
    expect(grade(ex, { text: "prendre  une decision" }, fr)).toMatchObject({ result: "near", reason: "accent" });
  });

  it("W5a: typing another word of the list records it as the chosen word (PRD §9.9)", () => {
    const { ex, ctx } = w5a("cuisine");
    expect(grade(ex, { text: "cousine", gender: "une" }, ctx)).toMatchObject({ result: "wrong", chosenWordId: 21 });
  });
});

describe("conjugation tables (PRD §6.6)", () => {
  const verb = word(1, "manger", "خوردن", { pos: "verb" });
  const table = {
    id: 1,
    wordId: 1,
    tense: "présent",
    unitCode: null,
    forms: { je: "mange", tu: "manges", il_elle_on: "mange", nous: "mangeons", vous: "mangez", ils_elles: "mangent" },
    variants: {},
    reviewCard: true,
  };
  const data = content({ words: [verb], conjugations: [table] });

  it("T50: C4 with one form off by an accent is near; with a wrong form it is wrong", () => {
    const ex = buildConjEx(env(data), table, "C4")!;
    expect(ex.a.kind).toBe("table");
    const right = ["mange", "manges", "mange", "mangeons", "mangez", "mangent"];
    expect(grade(ex, { rows: right }, fr)).toMatchObject({ result: "correct" });
    expect(grade(ex, { rows: ["mange", "manges", "mange", "mangeons", "mangéz", "mangent"] }, fr)).toMatchObject({ result: "near", reason: "accent" });
    expect(grade(ex, { rows: ["mange", "manges", "mange", "mangons", "mangez", "mangent"] }, fr)).toMatchObject({ result: "wrong" });
  });

  it("C2 only grades the empty rows", () => {
    const ex = buildConjEx(env(data), table, "C2")!;
    if (ex.a.kind !== "table") throw new Error("C2 is a table");
    const rows = ex.a.rows.map((row) => (row.accepted ? row.accepted[0] : ""));
    expect(ex.a.rows.filter((row) => row.accepted).length).toBe(3);
    expect(ex.a.bank).toHaveLength(3);
    expect(grade(ex, { rows }, fr)).toMatchObject({ result: "correct" });
  });
});

describe("whole sentences (PRD §6.5)", () => {
  const words = [word(1, "pomme", "سیب"), word(2, "manger", "خوردن", { pos: "verb" })];
  const transform = { id: 1, unitId: 1, instructionFa: "منفی کن", source: "J'ai mangé une pomme.", outputs: ["Je n'ai pas mangé de pomme.", "Je n'ai pas mangé une pomme."] };
  const translate = { id: 1, unitId: 1, promptFa: "من به مدرسه می‌روم.", outputs: ["Je vais à l'école.", "Je vais à l'école primaire."] };
  const data = content({ words, units: [unit(1)], transforms: [transform], translates: [translate] });

  it("T70: G6 forgives one letter in an untouched word, not in a word the change made", () => {
    const ex = buildGrammarEx(env(data), data.units[0], "G6", { transform }) as Ex;
    expect(grade(ex, { text: "Je n'ai pas mangé de pome." }, fr)).toMatchObject({ result: "near", reason: "typo" });
    expect(grade(ex, { text: "Je n'ai pa mangé de pomme." }, fr)).toMatchObject({ result: "wrong" });
    expect(grade(ex, { text: "je n'ai pas mangé une pomme" }, fr)).toMatchObject({ result: "correct" });
  });

  it("T97: G6b accepts every output, an accent slip is near, a wrong letter is wrong", () => {
    const ex = buildGrammarEx(env(data), data.units[0], "G6b", { translate }) as Ex;
    expect(grade(ex, { text: "Je vais à l'école primaire." }, fr)).toMatchObject({ result: "correct" });
    expect(grade(ex, { text: "Je vais à l'ecole." }, fr)).toMatchObject({ result: "near", reason: "accent" });
    expect(grade(ex, { text: "Je vais à l'écolu." }, fr)).toMatchObject({ result: "wrong" });
  });
});

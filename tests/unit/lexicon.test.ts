import { describe, expect, it } from "vitest";
import { lexiconFlags, nounLexicon } from "@/server/content/lexicon";

/** A new noun's gender, plural and level against the open lexicons and the frequency rank (warnings only). */
const noun = (lemma: string, gender: string, plural: string | null = null, level = "A1") => ({ lemma, pos: "noun", gender, number: "sg", plural, level });
const keys = (flags: { key: string }[]) => flags.map((flag) => flag.key);

describe("noun lexicons (data/lexicon)", () => {
  it("are there for both languages", () => {
    expect(nounLexicon("fr")?.get("voiture")?.get("f")).toEqual(["voitures"]);
    expect(nounLexicon("de")?.get("Tisch")?.get("der")).toEqual(["Tische"]);
  });

  it("agree with right genders and plurals", () => {
    expect(lexiconFlags(noun("voiture", "f"), "fr", 262)).toEqual([]);
    expect(lexiconFlags(noun("cheval", "m", "chevaux"), "fr", 900)).toEqual([]);
    expect(lexiconFlags(noun("Tisch", "der", "Tische"), "de", 700)).toEqual([]);
    // A noun with two genders and two plurals: each pair is right.
    expect(lexiconFlags(noun("Leiter", "die", "Leitern"), "de", null)).toEqual([]);
    expect(lexiconFlags(noun("Leiter", "der", "Leiter"), "de", null)).toEqual([]);
  });

  it("warn about a wrong gender or plural", () => {
    expect(keys(lexiconFlags(noun("voiture", "m"), "fr", null))).toEqual(["lexiconGender"]);
    expect(keys(lexiconFlags(noun("Mädchen", "die", "Mädchen"), "de", null))).toEqual(["lexiconGender"]);
    expect(keys(lexiconFlags(noun("Tisch", "der", "Tischen"), "de", null))).toEqual(["lexiconPlural"]);
    expect(keys(lexiconFlags(noun("cheval", "m", "chevals"), "fr", null))).toEqual(["lexiconPlural"]);
  });

  it("find a word written with œ, which Lexique spells oe (soeur, oeil)", () => {
    expect(lexiconFlags(noun("sœur", "f"), "fr", null)).toEqual([]);
    expect(keys(lexiconFlags(noun("sœur", "m"), "fr", null))).toEqual(["lexiconGender"]);
    expect(lexiconFlags(noun("œuf", "m", "œufs"), "fr", null)).toEqual([]);
  });

  it("stay silent about a word they do not know and about other parts of speech", () => {
    expect(lexiconFlags(noun("Quatschwort", "der", "Quatschworte"), "de", null)).toEqual([]);
    expect(lexiconFlags({ ...noun("manger", "m"), pos: "verb" }, "fr", null)).toEqual([]);
  });

  it("warn about a level far from the word's frequency", () => {
    expect(keys(lexiconFlags({ ...noun("voiture", "f"), level: "A1" }, "fr", 9000))).toEqual(["levelRare"]);
    expect(keys(lexiconFlags({ ...noun("voiture", "f"), level: "B2" }, "fr", 262))).toEqual(["levelCommon"]);
    expect(lexiconFlags({ ...noun("voiture", "f"), level: "A2" }, "fr", 3000)).toEqual([]);
  });
});

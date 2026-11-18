import { describe, expect, it } from "vitest";
import { buildWordEx, germanPlurals, misspellings } from "@/engine/build";
import { content, env, word } from "./kit";

/**
 * Wrong options that a learner can rule out on sight teach nothing and make the exercise a guess about
 * the language's alphabet, not about the word (item-writing rule: every wrong option must be plausible).
 */
describe("made-up spellings for W3a (PRD §5.5)", () => {
  it("uses only letters of the word's own language", () => {
    for (const word of ["voiture", "fenêtre", "garçon", "école", "bonjour", "musique"]) {
      for (const form of misspellings(word, "fr")) expect(form).not.toMatch(/[äöüßÄÖÜ]/);
    }
    for (const word of ["Tisch", "Mädchen", "Straße", "Hund", "lesen", "Brot"]) {
      for (const form of misspellings(word, "de")) expect(form).not.toMatch(/[éèêàâçîôûù]/);
    }
  });

  it("keeps the first letter and a German noun's capital", () => {
    for (const form of misspellings("Tisch", "de")) {
      expect(form[0]).toBe("T");
      expect(form.slice(1)).toBe(form.slice(1).toLowerCase());
    }
    for (const form of misspellings("voiture", "fr")) expect(form[0]).toBe("v");
  });

  it("changes accents the way learners do", () => {
    expect(misspellings("école", "fr")).toEqual(expect.arrayContaining(["ecole", "ècole", "êcole"]));
    expect(misspellings("fenêtre", "fr")).toEqual(expect.arrayContaining(["fenetre", "fenétre"]));
    expect(misspellings("Mädchen", "de")).toEqual(expect.arrayContaining(["Madchen", "Medchen"]));
    expect(misspellings("Straße", "de")).toContain("Strase");
  });

  it("never spells an umlaut out or writes ß as ss: a typed answer counts those as almost right", () => {
    expect(misspellings("Mädchen", "de")).not.toContain("Maedchen");
    expect(misspellings("Straße", "de")).not.toContain("Strasse");
  });

  it("doubles and undoubles consonants only, swaps letters only after the first", () => {
    const forms = misspellings("pomme", "fr");
    expect(forms).toContain("pome");
    expect(forms).not.toContain("ppomme");
    expect(forms).not.toContain("pommme");
    expect(forms).not.toContain("opmme");
    expect(misspellings("voiture", "fr")).not.toContain("voituure");
  });

  it("still finds three forms for an ordinary word", () => {
    for (const [word, lang] of [["chat", "fr"], ["Hund", "de"], ["lesen", "de"], ["maison", "fr"]] as const) {
      expect(misspellings(word, lang).length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("W3a never offers a real word as a misspelling (PRD §5.5)", () => {
  const optionsOf = (data: ReturnType<typeof content>, id: number) => {
    const texts = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const ex = buildWordEx(env(data, { seed: `s${i}` }), data.words.get(id)!, "W3a");
      if (ex?.a.kind === "choice") for (const option of ex.a.options) texts.add(option.text);
    }
    return texts;
  };

  it("leaves out forms of the language's own word list: «sur» is never a wrong spelling of «sûr»", () => {
    const sur = word(1, "sûr", "مطمئن", { pos: "adj" });
    const plain = content({ words: [sur] });
    expect(optionsOf(plain, 1)).toContain("sur");
    const withList = { ...plain, realWords: new Set(["sur"]) };
    expect(optionsOf(withList, 1)).not.toContain("sur");
  });

  it("leaves out the word's homophones", () => {
    const tache = word(1, "tâche", "وظیفه", { gender: "f", homophones: ["tache"] });
    expect(optionsOf(content({ words: [tache] }), 1)).not.toContain("tache");
  });
});

describe("German plural options for W4c (PRD §5.5)", () => {
  it("never makes an impossible ending", () => {
    expect(germanPlurals("Tisch")).not.toContain("Tischn");
    expect(germanPlurals("Lampe")).not.toEqual(expect.arrayContaining(["Lampee"]));
    expect(germanPlurals("Lampe")).not.toContain("Lampeen");
    expect(germanPlurals("Lampe")).not.toContain("Lampeer");
    expect(germanPlurals("Wagen")).not.toContain("Wagenn");
  });

  it("offers the real plural among plausible look-alikes", () => {
    expect(germanPlurals("Tisch")).toEqual(expect.arrayContaining(["Tische", "Tischer", "Tischen", "Tischs"]));
    expect(germanPlurals("Lampe")).toEqual(expect.arrayContaining(["Lampen", "Lampes", "Lampe", "Lämpen"]));
    expect(germanPlurals("Mutter")).toEqual(expect.arrayContaining(["Mütter", "Muttern", "Mutter"]));
    expect(germanPlurals("Buch")).toContain("Bücher");
    expect(germanPlurals("Haus")).toContain("Häuser");
    expect(germanPlurals("Lehrerin")).toEqual(expect.arrayContaining(["Lehrerinnen", "Lehrerinen", "Lehrerine"]));
  });

  it("has fewer than three wrong forms where the plural is never in doubt, so W4c is skipped", () => {
    expect(germanPlurals("Mädchen").filter((form) => form !== "Mädchen").length).toBeLessThan(3);
    expect(germanPlurals("Auto").filter((form) => form !== "Autos").length).toBeLessThan(3);
  });
});

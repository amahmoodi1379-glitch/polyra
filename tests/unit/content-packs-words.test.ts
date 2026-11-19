import { describe, expect, it } from "vitest";
import { parseLexicon } from "@/server/content/lexicon";
import { checkWordPack, type PackFile } from "@/server/content/packs/words";

/** The word lists Claude writes (content/README.md) pass every rule of the panel's word import. */
const tsv = (...lines: string[][]) => ["lemma\tpos\tgender\tplural\tmeaning_fa\tconcept_fa\ttopic", ...lines.map((cells) => cells.join("\t"))].join("\n");
const ranks = new Map([
  ["voiture", 400],
  ["œil", 300],
  ["le", 2],
  ["manger", 250],
  ["courage", 1500],
]);
const lexicon = parseLexicon("voiture\tf=voitures\nœil\tm=yeux\ncourage\tm=courages\nTisch\tder=Tische\nMilch\tdie=Milche\n");
const check = (language: "fr" | "de", files: PackFile[]) => checkWordPack(language, files, ranks, lexicon);
const texts = (notes: { text: string }[]) => notes.map((note) => note.text).join("\n");

describe("word lists (content/<language>/words/<LEVEL>.tsv)", () => {
  it("reads a good list in teaching order with its optional cells", () => {
    const text = tsv(
      ["le", "det", "", "", "حرف تعریف معین (مذکر)", "حرف تعریف معین", "function", "no_card:1"],
      ["# body"],
      ["œil", "noun", "m", "yeux", "چشم", "چشم", "body"],
      ["voiture", "noun", "f", "", "ماشین، خودرو", "ماشین", "transport", "coll:en voiture → با ماشین"],
      ["manger", "verb", "", "", "خوردن", "خوردن", "food"],
      ["courage", "noun", "m", "", "شجاعت", "شجاعت", "feelings", "number:sg_only"],
    );
    const pack = check("fr", [{ level: "A1", file: "A1.tsv", text }]);
    expect(pack.errors).toEqual([]);
    expect(pack.warnings).toEqual([]);
    expect(pack.words.map((item) => [item.word.code, item.order, item.topic, item.rank])).toEqual([
      ["le", 1, "function", 2],
      ["œil", 2, "body", 300],
      ["voiture", 3, "transport", 400],
      ["manger", 4, "food", 250],
      ["courage", 5, "feelings", 1500],
    ]);
    expect(pack.words[0].word.no_card).toBe(true);
    expect(pack.words[2].word.collocations).toEqual([{ text: "en voiture", translation_fa: "با ماشین" }]);
    expect(pack.words[4].word).toMatchObject({ number: "sg_only", plural: null });
  });

  it("refuses what the panel's import refuses, with the line", () => {
    const text = tsv(
      ["voiture", "noun", "", "", "ماشین", "ماشین", "transport"],
      ["rouler", "verb", "", "", "drive", "راندن", "transport"],
      ["vite", "adv", "", "", "سریع", "سریع", "speed"],
      ["court", "adj", "", "", "کوتاه", "کوتاه", "qualities", "colour:x"],
      ["bagnole", "noun", "f", "", "ماشین (خودمانی)", "ماشین قدیمی", "transport", "register:familier"],
      ["a", "b"],
    );
    const pack = check("fr", [{ level: "A1", file: "A1.tsv", text }]);
    const at = (line: number) => texts(pack.errors.filter((note) => note.line === line));
    expect(at(2)).toMatch(/جنس/);
    expect(at(3)).toMatch(/فارسی/);
    expect(at(4)).toMatch(/unknown topic/);
    expect(at(5)).toMatch(/unknown cell/);
    expect(at(6)).toMatch(/colloquial word without a standard word/);
    expect(at(7)).toMatch(/needs 7 tab-separated columns/);
  });

  it("a German noun needs its plural unless it has none in use", () => {
    const text = tsv(["Tisch", "noun", "der", "", "میز", "میز", "home"], ["Milch", "noun", "die", "", "شیر", "شیر", "drink", "number:sg_only"]);
    const pack = check("de", [{ level: "A1", file: "A1.tsv", text }]);
    expect(pack.errors.map((note) => note.lemma)).toEqual(["Tisch"]);
  });

  it("no word twice across levels; a second sense and phrase parts must point down, not up", () => {
    const a1 = tsv(["glace", "noun", "f", "", "بستنی", "بستنی", "food"], ["avoir faim", "phrase", "", "", "گرسنه بودن", "گرسنگی", "food", "parts:avoir faim"]);
    const a2 = tsv(
      ["glace", "noun", "f", "", "آینه", "آینه", "home"],
      ["glace", "noun", "f", "", "یخ", "یخ", "weather", "code:glace-3", "sense_of:glace"],
      ["avoir", "verb", "", "", "داشتن", "داشتن", "function"],
      ["faim", "noun", "f", "", "گرسنگی", "گرسنگی", "food"],
    );
    const pack = check("fr", [
      { level: "A1", file: "A1.tsv", text: a1 },
      { level: "A2", file: "A2.tsv", text: a2 },
    ]);
    const found = pack.errors.map((note) => `${note.file}:${note.line} ${note.text.split(";")[0].replace(/«.*?»/g, "«»")}`).sort();
    expect(found).toEqual(["A1.tsv:3 part «» is of a higher level", "A1.tsv:3 part «» is of a higher level", "A2.tsv:2 code «» is also on A1.tsv:2", "A2.tsv:2 repeats A1.tsv:2"]);
  });

  it("finds the rank and lexicon entry of a word with œ, which the Lexique data spell oe", () => {
    const oe = new Map([["coeur", 290]]);
    const text = tsv(["cœur", "noun", "f", "", "قلب", "قلب", "body"]);
    const pack = checkWordPack("fr", [{ level: "A1", file: "A1.tsv", text }], oe, parseLexicon("coeur\tm=coeurs\n"));
    expect(pack.words[0].rank).toBe(290);
    expect(pack.warnings.map((note) => note.lemma)).toEqual(["cœur"]);
  });

  it("warns on a gender, plural or level the lexicon and the frequency list disagree with, unless checked", () => {
    const text = tsv(["voiture", "noun", "m", "", "ماشین", "ماشین", "transport"], ["œil", "noun", "m", "oeils", "چشم", "چشم", "body", "checked:plural"]);
    const pack = check("fr", [{ level: "B1", file: "B1.tsv", text }]);
    expect(pack.errors).toEqual([]);
    expect(pack.warnings.map((note) => [note.lemma, note.text.slice(-15)])).toEqual([
      ["voiture", "(checked:level if right)".slice(-15)],
      ["voiture", "(checked:gender if right)".slice(-15)],
      ["œil", "(checked:level if right)".slice(-15)],
    ]);
  });
});

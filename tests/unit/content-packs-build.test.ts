import { describe, expect, it } from "vitest";
import { standardTable } from "@/server/content/conjugation-check";
import { Analyzer } from "@/server/content/packs/analyze";
import { buildPack } from "@/server/content/packs/build";
import { buildGrammar } from "@/server/content/packs/grammar";
import { Morph } from "@/server/content/packs/morph";
import { buildSentences } from "@/server/content/packs/sentences";
import { buildTables } from "@/server/content/packs/tables";
import { checkWordPack, frequencyRanks, type PackWord } from "@/server/content/packs/words";
import { appSettingDefaults } from "@/server/settings/app-catalog";

/** The content packs: sentences mapped to words, wrong options and tables made from open data (content/README.md). */
const pack = buildPack("fr", { contentRoot: "tests/fixtures/packs" });
const level = pack.levels[0];
const sentence = (text: string) => level.sentences.find((item) => item.text === text)!;
const target = (text: string, code: string) => sentence(text).targets.find((item) => item.target === code)!;

const header = "lemma\tpos\tgender\tplural\tmeaning_fa\tconcept_fa\ttopic";
const words = (language: "fr" | "de", lines: string[]) => {
  const built = checkWordPack(language, [{ level: "A1", file: "A1.tsv", text: [header, ...lines].join("\n") }], frequencyRanks(language));
  expect(built.errors).toEqual([]);
  return built.words;
};
const analyzerOf = (language: "fr" | "de", list: PackWord[]) => new Analyzer(language, list, new Morph(language, list), new Set(["Marie"]));

describe("sentences of a pack", () => {
  it("maps every form to its word, elided ones too", () => {
    expect(pack.errors).toEqual([]);
    expect(sentence("J'ai une voiture.").tokens.map((token) => `${token.surface}=${token.code}`)).toEqual(["J'=je", "ai=avoir", "une=un", "voiture=voiture"]);
    expect(sentence("Les fleurs sont jaunes.").tokens.map((token) => token.code)).toEqual(["le", "fleur", "être", "jaune"]);
  });

  it("makes wrong options of the same kind and form, never one already in the sentence", () => {
    // A feminine noun: other feminine nouns; a plural: their plurals.
    expect(target("La voiture est petite.", "voiture").distractors).toEqual(["chaise", "maison", "fleur"]);
    expect(target("Les fleurs sont jaunes.", "fleur").distractors).toEqual(["pommes", "villes", "voitures"]);
    // An adjective agrees: «petite» gets feminine forms, «jaune» (no gender) only adjectives without one.
    expect(target("La maison est petite.", "petit").distractors).toEqual(["belle", "grande", "jaune"]);
    expect(target("La voiture est jaune.", "jaune").distractors).toEqual(["rose", "rouge", "triste"]);
    // No «homme» after «le» (it would be «l'homme»), no «chat» when the sentence has it.
    expect(target("Le chat et le chien sont dans la voiture.", "chien").distractors).toEqual(["pain", "livre", "garçon"]);
    // A conjugated verb: other forms of the same verb, with the infinitive as hint.
    expect(target("Je mange une pomme.", "manger")).toMatchObject({ distractors: ["manges", "mangeons", "mangez"], hint: "(manger)" });
  });

  it("joins a sentence written for two words into one with two targets", () => {
    expect(sentence("La maison est petite.").targets.map((item) => item.target).sort()).toEqual(["maison", "petit"]);
  });

  it("confirms the forms the import would doubt, and only those", () => {
    const surfaces = level.exceptions.map((item) => `${item.code}:${item.surface}`);
    expect(surfaces).toEqual(expect.arrayContaining(["être:suis", "être:sont", "avoir:ai", "aller:vais"]));
    expect(surfaces).not.toContain("manger:mange");
  });

  it("refuses a word the learner meets later than the sentence's word", () => {
    const list = words("fr", ["le\tdet\t\t\tحرف تعریف\tحرف تعریف\tfunction\tno_card:1", ...Array.from({ length: 30 }, (_, i) => `mot${i}\tnoun\tm\t\tکلمه\tکلمه ${i}\tabstract`), "chat\tnoun\tm\t\tگربه\tگربه\tanimals", "chien\tnoun\tm\t\tسگ\tسگ\tanimals"]);
    const analyzer = analyzerOf("fr", list);
    const built = buildSentences(analyzer, [{ file: "s.txt", text: "# chat\nLe [chat] et le chien. | گربه و سگ. | d: a, b, c" }], "A1", new Set());
    expect(built.errors.map((item) => item.text).join()).toMatch(/«chien» .* is taught after/);
  });
});

describe("grammar units of a pack", () => {
  it("builds the unit, its targets, transforms and translations", () => {
    const unit = level.units[0];
    expect(unit.listItem).toMatchObject({ unit_code: "fr-a1-etre", level: "A1" });
    const answer = unit.answer as { targets: { marked_text: string; blanks: number; distractors: unknown }[]; transforms: unknown[]; translations: unknown[] };
    expect(answer.targets[2]).toMatchObject({ marked_text: "Nous {{sommes}} dans la maison et vous {{êtes}} dans la voiture.", blanks: 2, distractors: [["sont", "êtes", "suis"], ["sommes", "es", "sont"]] });
    expect(answer.transforms).toHaveLength(1);
    expect(answer.translations).toHaveLength(1);
  });

  it("names what is wrong in a unit file, with the line", () => {
    const analyzer = analyzerOf("fr", pack.words);
    const text = ["code: x", "title: عنوان", "colour: red", "lesson:", "درس", "targets:", "Je [suis] petit. | من کوچکم. | d: es, est"].join("\n");
    const built = buildGrammar(analyzer, [{ file: "u.txt", text }], "A1");
    const lines = built.errors.map((item) => `${item.line}: ${item.text}`);
    expect(lines).toEqual(expect.arrayContaining([expect.stringMatching(/^3: unknown header line/), expect.stringMatching(/^1: missing header «rule:»/), expect.stringMatching(/^7: d: needs three wrong options/)]));
  });
});

describe("conjugation tables of a pack", () => {
  it("links each table to the most specific unit of its tense and marks review cards", () => {
    const table = (code: string, tense: string) => level.tables.find((item) => item.verb.word.code === code && item.tense === tense)!;
    expect(table("être", "présent")).toMatchObject({ unit_code: "fr-a1-etre", review_card: true });
    expect(table("parler", "présent")).toMatchObject({ unit_code: "fr-a1-er", review_card: true }); // the -er sample
    expect(table("aimer", "présent")).toMatchObject({ unit_code: "fr-a1-er", review_card: false });
    expect(table("aller", "passé composé").accepted_variants.je).toEqual(["suis allée"]);
  });

  it("reads German verb classes from the data: modal, separable, sein, irregular", () => {
    const list = words("de", [
      "machen\tverb\t\t\tانجام دادن\tانجام دادن\tactions",
      "spielen\tverb\t\t\tبازی کردن\tبازی کردن\tleisure",
      "kommen\tverb\t\t\tآمدن\tآمدن\ttravel",
      "fahren\tverb\t\t\tراندن\tراندن\ttransport",
      "können\tverb\t\t\tتوانستن\tتوانستن\tfunction",
      "aufstehen\tverb\t\t\tبلند شدن\tبلند شدن\tactions",
    ]);
    const units = [
      { unit_code: "praesens", level: "A1", order: 1, file: "a", tables: [{ tense: "Präsens", verbClass: null }, { tense: "Präsens", verbClass: "modal" }] },
      { unit_code: "perfekt", level: "A1", order: 2, file: "b", tables: [{ tense: "Perfekt", verbClass: null }] },
      { unit_code: "perfekt-sein", level: "A1", order: 3, file: "c", tables: [{ tense: "Perfekt", verbClass: "aux-sein" }] },
      { unit_code: "kj2", level: "B1", order: 1, file: "d", tables: [{ tense: "Konjunktiv II", verbClass: null }] },
    ];
    const built = buildTables("de", list, appSettingDefaults["conjugation.tenses.de"] as Record<string, string[]>, units);
    const table = (verb: string, tense: string) => built.tables.find((item) => item.verb.word.code === verb && item.tense === tense)!;
    expect(table("können", "Präsens")).toMatchObject({ unit_code: "praesens", review_card: true });
    expect(table("spielen", "Präsens").review_card).toBe(false);
    expect(table("fahren", "Präsens").review_card).toBe(true); // du fährst
    expect(table("kommen", "Präsens").review_card).toBe(false);
    expect(table("aufstehen", "Präsens").forms.ich).toBe("stehe auf");
    expect(table("aufstehen", "Perfekt")).toMatchObject({ unit_code: "perfekt-sein", forms: { ich: "bin aufgestanden" } });
    expect(table("machen", "Perfekt").unit_code).toBe("perfekt");
    expect(table("kommen", "Konjunktiv II").accepted_variants.du).toEqual(["würdest kommen", "kämst"]);
    expect(table("können", "Konjunktiv II").accepted_variants.du).toEqual(["würdest können"]);
    // B1 has a unit, so its other tenses need one too; B2 has none yet, so its tables wait.
    expect(built.errors.map((item) => item.text)).toEqual([
      "no grammar unit says «tables: Futur I»: its tables have no unit",
      "no grammar unit says «tables: Plusquamperfekt»: its tables have no unit",
    ]);
    expect(built.notes.map((item) => item.text)).toContain("no grammar unit says «tables: Konjunktiv I»: its tables have no unit (waits for the B2 grammar)");
  });

  it("writes German in today's spelling and makes the verbs Morphy lacks from their parts", () => {
    const forms = (verb: string, tense: string) => Object.values(standardTable("de", verb, tense)?.forms ?? {});
    expect(forms("müssen", "Präsens")).toEqual(["muss", "musst", "muss", "müssen", "müsst", "müssen"]);
    expect(forms("schließen", "Präteritum")[0]).toBe("schloss");
    expect(forms("essen", "Präteritum")[0]).toBe("aß"); // a long vowel keeps ß
    expect(forms("wissen", "Präsens")[0]).toBe("weiß");
    expect(forms("mitkommen", "Perfekt")[0]).toBe("bin mitgekommen");
    expect(forms("sich ausruhen", "Präsens")[0]).toBe("ruhe mich aus");
    expect(forms("möchten", "Präsens")).toEqual(["möchte", "möchtest", "möchte", "möchten", "möchtet", "möchten"]);
    const list = words("de", ["müssen\tverb\t\t\tمجبور بودن\tباید\tfunction", "mitkommen\tverb\t\t\tهمراه آمدن\tهمراه آمدن\ttravel", "ich\tpron\t\t\tمن\tمن\tfunction\tno_card:1", "du\tpron\t\t\tتو\tتو\tfunction\tno_card:1"]);
    const analysis = analyzerOf("de", list).analyze("Ich muss. Kommst du mit?", { level: "A1" });
    expect(analysis.errors).toEqual([]);
    expect(analysis.tokens.map((token) => `${token.surface}=${token.code}`)).toEqual(["Ich=ich", "muss=müssen", "Kommst ... mit=mitkommen", "du=du"]);
  });
});

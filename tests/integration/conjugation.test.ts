import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { batchReport, createBatch, qaPrompt, submitAnswer } from "@/server/content/batches";
import { contentStatus } from "@/server/content/status";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const example = (language: string) => JSON.parse(readFileSync(join(process.cwd(), `prompts/v1/examples/P-X.${language}.json`), "utf8"));
const fence = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

async function verbs(language: string, rows: [string, string][]) {
  await testDb.word.createMany({
    data: rows.map(([code, level], index) => ({ language, code, lemma: code, pos: "verb" as const, level, meaning_fa: "معنی", intro_order: index + 1 })),
  });
}

async function units(language: string, codes: [string, string][]) {
  await testDb.grammarUnit.createMany({
    data: codes.map(([unit_code, level], index) => ({ language, unit_code, title_fa: unit_code, level, order_no: index + 1 })),
  });
}

async function tableBatch(language: "fr" | "de", level?: string) {
  const made = await createBatch({ slug: "conjugation", language, adminId: 1, options: { level } });
  if (!("id" in made)) throw new Error(made.nothing);
  return testDb.importBatch.findUniqueOrThrow({ where: { id: made.id } });
}

describe("conjugation tables (P-X, PRD §6.6, §14.4)", () => {
  it("asks for the A1 tenses of A1 verbs first and imports the tables", async () => {
    await verbs("fr", [
      ["aller", "A1"],
      ["manger", "A1"],
      ["partir", "A1"],
      ["finir", "A2"],
    ]);
    await units("fr", [
      ["fr-a1-present-aller", "A1"],
      ["fr-a1-passe-compose-avoir-er", "A1"],
      ["fr-a1-passe-compose-etre", "A1"],
      ["fr-a2-imparfait", "A2"],
    ]);
    // A1 verbs × A1 tenses come first; A2 needs both A2 tenses for the A1 verbs and all A1 and A2 tenses for finir.
    expect((await contentStatus("fr")).tables).toEqual({ next: { level: "A1", count: 6 }, waitingForUnits: true, hasVerbs: true });

    const batch = await tableBatch("fr");
    expect(batch.prompt_text).toContain("aller | présent\naller | passé composé\nmanger | présent");
    expect(batch.prompt_text).toContain("fr-a1-passe-compose-etre | fr-a1-passe-compose-etre | A1");
    expect(batch.prompt_text).not.toContain("fr-a2-imparfait");
    expect(batch.prompt_text).toContain("je، tu، il_elle_on، nous، vous، ils_elles");
    expect(batch.prompt_text).not.toContain("⟦");
    // The pairs of an open batch are not offered again.
    expect((await contentStatus("fr")).tables.next).toEqual({ level: "A2", count: 3 * 2 + 4 });

    expect(await submitAnswer(batch.id, [fence(example("fr"))], "answer")).toEqual({ state: "imported", rejected: 0 });
    const partir = await testDb.conjugationTable.findFirstOrThrow({ where: { tense: "passé composé", word: { code: "partir" } } });
    expect(partir.forms).toEqual(expect.objectContaining({ nous: "sommes partis" }));
    expect(partir.accepted_variants).toEqual(expect.objectContaining({ je: ["suis partie"], vous: ["êtes parti", "êtes partie", "êtes parties"] }));
    expect(partir.unit_code).toBe("fr-a1-passe-compose-etre");
    expect(partir.review_card).toBe(true);

    // All three agree with the second source, so the teacher sees no warning.
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.added).toBe(3);
    expect(report.warnings).toEqual([]);
    expect(qaPrompt(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))).toContain('"tables"');
  });

  it("rejects missing forms, unknown verbs, tenses and units, and flags a table the second source disagrees with", async () => {
    await verbs("fr", [
      ["aller", "A1"],
      ["manger", "A1"],
    ]);
    await units("fr", [["fr-a1-passe-compose-avoir-er", "A1"]]);
    const batch = await tableBatch("fr");
    const [aller, manger] = example("fr").tables;
    const answer = {
      tables: [
        { ...aller, unit_code: "fr-a1-passe-compose-avoir-er", forms: { ...aller.forms, vous: "" } },
        { ...manger, verb: "chanter" },
        { ...manger, tense: "passé récent" },
        { ...manger, unit_code: "fr-a1-autre" },
        { ...manger, forms: { ...manger.forms, nous: "avons mangés" } },
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "imported", rejected: 4 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected.map((item) => item.problems.map((found) => found.key))).toEqual([
      ["formsMissing"],
      ["verbUnknown"],
      ["tenseUnknown"],
      ["unitUnknown"],
    ]);
    expect(report.warnings).toEqual([
      expect.objectContaining({
        label: "manger (passé composé)",
        problem: { key: "secondSourceDiffers", vars: { persons: "nous: avons mangés ≠ avons mangé" } },
      }),
    ]);
  });

  it("checks German tables too, with the auxiliary the verb takes", async () => {
    await verbs("de", [
      ["machen", "A1"],
      ["fahren", "A1"],
      ["aufstehen", "A1"],
    ]);
    await units("de", [
      ["de-a1-praesens-regelmaessig", "A1"],
      ["de-a1-praesens-vokalwechsel", "A1"],
      ["de-a1-perfekt-sein", "A1"],
    ]);
    const batch = await tableBatch("de");
    expect(batch.prompt_text).toContain("ich، du، er_sie_es، wir، ihr، sie_Sie");
    const answer = example("de");
    answer.tables[1].forms.du = "fahrst";
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "imported", rejected: 0 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.warnings.map((flag) => [flag.label, flag.problem.vars?.persons])).toEqual([["fahren (Präsens)", "du: fahrst ≠ fährst"]]);
  });

  it("updates a draft table on a second answer and leaves an approved one alone", async () => {
    await verbs("fr", [["aller", "A1"]]);
    await units("fr", [["fr-a1-present-aller", "A1"]]);
    const batch = await tableBatch("fr");
    const [aller] = example("fr").tables;
    await submitAnswer(batch.id, [fence({ tables: [aller], issues: [] })], "answer");
    await submitAnswer(batch.id, [fence({ tables: [{ ...aller, review_card: false }], issues: [] })], "fix");
    expect((await testDb.conjugationTable.findFirstOrThrow()).review_card).toBe(false);

    await testDb.conjugationTable.updateMany({ data: { status: "approved" } });
    expect(await submitAnswer(batch.id, [fence({ tables: [aller], issues: [] })], "fix")).toEqual({ state: "imported", rejected: 1 });
    expect((await testDb.conjugationTable.findFirstOrThrow()).review_card).toBe(false);
  });
});

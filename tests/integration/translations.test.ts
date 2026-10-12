import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { batchReport, createBatch, qaPrompt, submitAnswer } from "@/server/content/batches";
import { contentStatus } from "@/server/content/status";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const example = () => JSON.parse(readFileSync(join(process.cwd(), "prompts/v1/examples/P-TR.fr.json"), "utf8"));
const fence = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

/** The words of the French example, a unit with a lesson and one translation, and one without a lesson. */
async function setup() {
  const codes = ["hier", "je", "avoir", "parler", "avec", "mon", "mère", "nous", "regarder", "un", "film", "à"];
  await testDb.word.createMany({
    data: codes.map((code, index) => ({ language: "fr", code, lemma: code, pos: "noun" as const, level: "A1", meaning_fa: "معنی", intro_order: index + 1 })),
  });
  const unit = await testDb.grammarUnit.create({
    data: {
      language: "fr",
      unit_code: "fr-a1-passe-compose-avoir-er",
      title_fa: "گذشته با avoir (فعل‌های -er)",
      scope_fa: "فقط فعل‌های -er با avoir",
      level: "A1",
      order_no: 2,
      lesson_fa: "درس",
    },
  });
  await testDb.grammarUnit.create({
    data: { language: "fr", unit_code: "fr-a1-futur-proche", title_fa: "آینده نزدیک", level: "A1", order_no: 3 },
  });
  await testDb.translateItem.create({
    data: { language: "fr", grammar_unit_id: unit.id, prompt_fa: "دیروز تلویزیون تماشا کردم.", accepted_outputs: ["J'ai regardé la télé hier."], tokens: [] },
  });
  return unit;
}

async function translationBatch() {
  const made = await createBatch({ slug: "translations", language: "fr", adminId: 1 });
  if (!("id" in made)) throw new Error(made.nothing);
  return testDb.importBatch.findUniqueOrThrow({ where: { id: made.id } });
}

describe("short translations for a unit with a lesson (P-TR, PRD §14.6)", () => {
  it("asks only for what is missing, lists what exists, and adds the new ones once", async () => {
    const unit = await setup();
    expect((await contentStatus("fr")).translationsNext).toEqual({ title: unit.title_fa, level: "A1", count: 1, want: 8 });

    const batch = await translationBatch();
    expect(batch.prompt_text).toContain("7 ترجمه کوتاه بساز");
    expect(batch.prompt_text).toContain("unit_code: fr-a1-passe-compose-avoir-er");
    expect(batch.prompt_text).toContain("دیروز تلویزیون تماشا کردم.");
    expect(batch.prompt_text).toContain("parler | noun | معنی");
    expect(batch.prompt_text).not.toContain("⟦");

    // One P-TR per unit: while it exists the unit is not offered again.
    expect(await createBatch({ slug: "translations", language: "fr", adminId: 1 })).toEqual({ nothing: "همه درس‌ها ترجمه کوتاه کافی دارند." });

    const answer = example();
    answer.translations.push({ ...answer.translations[1] });
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "imported", rejected: 0 });
    const items = await testDb.translateItem.findMany({ where: { grammar_unit_id: unit.id }, orderBy: { id: "asc" } });
    expect(items.map((item) => item.prompt_fa)).toEqual(["دیروز تلویزیون تماشا کردم.", "دیروز با مادرم صحبت کردم.", "ما یک فیلم تماشا کردیم."]);
    expect(items[1].import_batch_id).toBe(batch.id);
    expect((items[1].tokens as { surface: string }[]).map((row) => row.surface)).toEqual(["Hier", "j'", "ai", "parlé", "avec", "ma", "mère"]);
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.added).toBe(2);
    expect(report.skipped).toBe(1);

    expect(qaPrompt(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))).toContain('"translations"');
    expect((await contentStatus("fr")).translationsNext).toBeNull();
  });

  it("rejects a translation whose words do not match its first output, and takes the rest", async () => {
    await setup();
    const batch = await translationBatch();
    const answer = example();
    answer.translations[0].tokens.pop();
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "imported", rejected: 1 });
    expect(await testDb.translateItem.count()).toBe(2);
  });

  it("refuses an answer made for another unit", async () => {
    await setup();
    const batch = await translationBatch();
    const answer = example();
    answer.unit_code = "fr-a1-futur-proche";
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "wrong_answer" });
    expect(await testDb.translateItem.count()).toBe(1);
  });

  it("waits while the unit's own lesson batch is not through QA", async () => {
    const unit = await setup();
    await testDb.importBatch.create({
      data: {
        language: "fr",
        prompt_kind: "P_G",
        prompt_version: "v1",
        prompt_text: "…",
        state: "imported",
        params: { level: "A1", unit_id: unit.id, unit_code: unit.unit_code, summary: [] },
        created_by: 1,
      },
    });
    expect((await contentStatus("fr")).translationsNext).toBeNull();
  });
});

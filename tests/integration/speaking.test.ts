import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { batchReport, createBatch, submitAnswer } from "@/server/content/batches";
import type { KindSlug } from "@/server/content/batches";
import { contentStatus } from "@/server/content/status";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const example = (kind: string, language: string) =>
  JSON.parse(readFileSync(join(process.cwd(), `prompts/v1/examples/${kind}.${language}.json`), "utf8"));
const fence = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

async function words(language: string, level: string, count: number) {
  await testDb.word.createMany({
    data: Array.from({ length: count }, (_, k) => ({
      language,
      code: `${level.toLowerCase()}-w${k}`,
      lemma: `${level.toLowerCase()}-w${k}`,
      pos: "noun" as const,
      level,
      meaning_fa: "معنی",
      intro_order: k + 1,
    })),
  });
}

async function units(language: string, codes: [string, string][]) {
  await testDb.grammarUnit.createMany({
    data: codes.map(([unit_code, level], index) => ({ language, unit_code, title_fa: unit_code, level, order_no: index + 1 })),
  });
}

async function batchOf(slug: KindSlug, language: "fr" | "de", level?: string) {
  const made = await createBatch({ slug, language, adminId: 1, options: { level } });
  if (!("id" in made)) throw new Error(made.nothing);
  return testDb.importBatch.findUniqueOrThrow({ where: { id: made.id } });
}

describe("situational dialogues (P-D, PRD §8b.4)", () => {
  it("waits for the first 200 words, then makes one dialogue with every line and choice as a sentence", async () => {
    await units("fr", [["fr-a1-present", "A1"]]);
    await words("fr", "A1", 150);
    expect((await contentStatus("fr")).dialogues).toEqual({ state: "needsWords", level: "A1", count: 200 });
    await words("fr", "A2", 60);
    await testDb.word.updateMany({ where: { level: "A2" }, data: { level: "A1", intro_order: null } });
    expect((await contentStatus("fr")).dialogues).toEqual({ state: "ready", level: "A1", left: 10, goal: 10, size: 1 });

    const batch = await batchOf("dialogues", "fr");
    expect(batch.prompt_text).toContain("موقعیت: کافه | code: fr-a1-d001");
    expect(batch.prompt_text).not.toContain("⟦");
    expect((await contentStatus("fr")).dialogues).toEqual({ state: "ready", level: "A1", left: 9, goal: 10, size: 1 });

    expect(await submitAnswer(batch.id, [fence(example("P-D", "fr"))], "answer")).toEqual({ state: "imported", rejected: 0 });
    const dialogue = await testDb.dialogue.findFirstOrThrow();
    expect(dialogue).toEqual(expect.objectContaining({ code: "fr-a1-d001", level: "A1", title_fa: "سفارش در کافه" }));
    const turns = dialogue.turns as { sentence_id: number; speaker: string; choices: { sentence_id: number }[]; correct: number; why_fa: string }[];
    expect(turns.map((turn) => [turn.speaker, turn.choices.length, turn.correct])).toEqual([
      ["B", 3, 0],
      ["B", 3, 1],
      ["B", 3, 2],
      ["B", 3, 0],
      ["B", 3, 2],
    ]);
    // 5 lines and 15 choices; "Voilà, merci." and the others are each one sentence row.
    expect(await testDb.sentence.count()).toBe(20);
    const price = await testDb.sentence.findUniqueOrThrow({ where: { id: turns[3].sentence_id } });
    expect(price.tts_text).toBe("Voilà. Ça fait cinq euros.");
  });

  it("rejects a dialogue with too few turns, a missing choice or a wrong answer index, and an answer for another code", async () => {
    await units("de", [["de-a1-praesens", "A1"]]);
    await words("de", "A1", 200);
    const batch = await batchOf("dialogues", "de");
    const answer = example("P-D", "de");
    answer.dialogue.turns = answer.dialogue.turns.slice(0, 4);
    answer.dialogue.turns[1].choices.pop();
    answer.dialogue.turns[2].correct = 3;
    answer.dialogue.turns[3].choices[2] = { ...answer.dialogue.turns[3].choices[0] };
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "imported", rejected: 1 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected[0].problems.map((found) => [found.key, found.vars?.field ?? ""])).toEqual([
      ["tooFew", "turns"],
      ["optionsCount", "turns[1].choices"],
      ["answerOutOfRange", "turns[2].correct"],
      ["listRepeat", "turns[3].choices"],
    ]);

    const other = example("P-D", "de");
    other.dialogue.code = "de-a1-d099";
    expect(await submitAnswer(batch.id, [fence(other)], "fix")).toEqual({ state: "wrong_answer" });
    expect(await submitAnswer(batch.id, [fence(example("P-D", "de"))], "fix")).toEqual({ state: "imported", rejected: 0 });
  });
});

describe("find-the-mistake texts (P-E, PRD §8b.5)", () => {
  it("starts at B1, checks the marks and the units, and stores each corrected text once", async () => {
    await units("fr", [
      ["fr-a1-passe-compose-avoir-er", "A1"],
      ["fr-a1-adjectifs-possessifs", "A1"],
      ["fr-a1-passe-compose-etre", "A1"],
      ["fr-a1-accord-adjectif", "A1"],
      ["fr-b1-subjonctif", "B1"],
    ]);
    await words("fr", "B1", 10);
    expect((await contentStatus("fr")).errorfix).toEqual({ state: "ready", level: "B1", left: 60, goal: 60, size: 5 });
    const batch = await batchOf("errorfix", "fr");
    expect(batch.prompt_text).toContain("کار: 5 متن کوتاه «غلط‌یابی» بساز.");
    expect(batch.prompt_text).toContain("fr-a1-accord-adjectif | fr-a1-accord-adjectif | A1");
    expect(batch.prompt_text).not.toContain("⟦");

    const answer = example("P-E", "fr");
    const [good, second] = answer.items;
    answer.items.push(
      { ...second, marked_text: "Ma sœur {{est|est}} arrivée hier soir. Elle est très fatiguée après le voyage.", unit_codes: ["fr-b2-nope"] },
      { ...good },
    );
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "imported", rejected: 1 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected[0].problems.map((found) => found.key)).toEqual(["marksCount", "markInvalid", "errorsCount", "unitUnknown"]);
    expect(report.added).toBe(2);
    expect(report.skipped).toBe(1);
    const item = await testDb.errorfixItem.findFirstOrThrow({ orderBy: { id: "asc" } });
    expect(item.errors).toEqual([
      { wrong: "sommes", right: "avons", why_fa: "manger در گذشته با avoir می‌آید، نه être." },
      { wrong: "notre", right: "nos", why_fa: "amis جمع است، پس صفت ملکی nos است، نه notre." },
    ]);
    expect((item.tokens as { surface: string }[]).map((row) => row.surface)).toContain("avons");
  });
});

describe("guided writing (P-WR, PRD §8b.6)", () => {
  it("checks the word range, the checklist and the model answer's length", async () => {
    await units("de", [["de-b1-weil", "B1"]]);
    await words("de", "B1", 10);
    expect((await contentStatus("de")).writing).toEqual({ state: "ready", level: "B1", left: 20, goal: 20, size: 5 });
    const batch = await batchOf("writing", "de");
    expect(batch.prompt_text).toContain("min_words و max_words بین 60 و 120.");
    expect(batch.prompt_text).not.toContain("⟦");

    const answer = example("P-WR", "de");
    const [task] = answer.tasks;
    answer.tasks.push(
      { ...task, prompt_fa: "یک پیام کوتاه بنویس.", max_words: 200, checklist_fa: ["یک مورد"], model_answer: "Hallo Lena!" },
      { ...task },
    );
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "imported", rejected: 2 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected.map((item) => item.problems.map((found) => found.key))).toEqual([
      ["wordRange", "tooFew", "modelLength"],
      ["repeatedInAnswer"],
    ]);
    const saved = await testDb.writingTask.findFirstOrThrow();
    expect(saved).toEqual(expect.objectContaining({ level: "B1", min_words: 60, max_words: 120 }));
    expect(saved.checklist_fa).toHaveLength(4);
  });
});

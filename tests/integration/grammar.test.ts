import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { batchFindings, batchReport, createBatch, fixPrompt, qaPrompt, submitAnswer, submitQa } from "@/server/content/batches";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const example = () => JSON.parse(readFileSync(join(process.cwd(), "prompts/v1/examples/P-G.fr.json"), "utf8"));
const fence = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

/** The words the French example uses, and two units from the unit list: one done, one waiting. */
async function setup() {
  const codes = ["hier", "je", "avoir", "manger", "un", "pomme", "nous", "regarder", "film", "tu", "parler", "avec"];
  const more = ["écouter", "de", "la", "musique", "et", "danser", "télévision"];
  await testDb.word.createMany({
    data: [...codes, ...more].map((code, index) => ({
      language: "fr",
      code,
      lemma: code,
      pos: "noun" as const,
      level: "A1",
      meaning_fa: "معنی",
      intro_order: index + 1,
    })),
  });
  await testDb.grammarUnit.create({
    data: { language: "fr", unit_code: "fr-a1-etre-present", title_fa: "فعل être در حال", level: "A1", order_no: 1, lesson_fa: "درس" },
  });
  return testDb.grammarUnit.create({
    data: {
      language: "fr",
      unit_code: "fr-a1-passe-compose-avoir-er",
      title_fa: "گذشته با avoir (فعل‌های -er)",
      scope_fa: "فقط فعل‌های -er با avoir",
      level: "A1",
      order_no: 2,
    },
  });
}

async function grammarBatch() {
  const made = await createBatch({ slug: "grammar", language: "fr", adminId: 1 });
  if (!("id" in made)) throw new Error(made.nothing);
  return testDb.importBatch.findUniqueOrThrow({ where: { id: made.id } });
}

describe("grammar unit (P-G, PRD §14.6)", () => {
  it("asks for the next unit without a lesson and fills it: lesson, targets, transforms, translations", async () => {
    const unit = await setup();
    const batch = await grammarBatch();
    expect(batch.prompt_text).toContain("unit_code: fr-a1-passe-compose-avoir-er");
    expect(batch.prompt_text).toContain("فعل être در حال");
    expect(batch.prompt_text).toContain("manger | noun | معنی");
    expect(batch.prompt_text).toContain("تعداد target: 40");
    expect(batch.prompt_text).not.toContain("⟦");

    // While this batch is open, nothing else is waiting.
    expect(await createBatch({ slug: "grammar", language: "fr", adminId: 1 })).toEqual({ nothing: "همه واحدهای فهرست درس دارند." });

    expect(await submitAnswer(batch.id, [`Voilà:\n${fence(example())}`], "answer")).toEqual({ state: "imported", rejected: 0 });
    const saved = await testDb.grammarUnit.findUniqueOrThrow({ where: { id: unit.id } });
    expect(saved.lesson_fa).toContain("avoir");
    expect(saved.example_sentence_ids).toHaveLength(2);
    expect(saved.import_batch_id).toBe(batch.id);
    expect(await testDb.sentenceTarget.count({ where: { target_type: "grammar", target_id: unit.id } })).toBe(2);
    expect(await testDb.transformItem.count({ where: { grammar_unit_id: unit.id } })).toBe(1);
    const translation = await testDb.translateItem.findFirstOrThrow({ where: { grammar_unit_id: unit.id } });
    expect(translation.accepted_outputs).toHaveLength(4);
    expect((translation.tokens as { surface: string }[]).map((row) => row.surface)).toEqual(["Hier", "j'", "ai", "regardé", "la", "télévision"]);

    // QA sees the unit in its own structure, and a finding points at the right sentence.
    const done = await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    const qa = qaPrompt(done)!;
    expect(qa).toContain('"unit"');
    expect(qa).toContain('"translations"');
    const finding = { path: "targets[1].distractors[1][1]", severity: "high", problem: "dansée could be read as right", suggestion: "dansais" };
    await submitQa(batch.id, [JSON.stringify({ findings: [finding] })]);
    expect(batchFindings(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))).toEqual([
      expect.objectContaining({ label: "Nous avons écouté de la musique et nous avons dansé.", entity: expect.objectContaining({ type: "sentence" }) }),
    ]);
  });

  it("rejects only the broken part, and the fix answer carries just that part", async () => {
    const unit = await setup();
    const batch = await grammarBatch();
    const answer = example();
    answer.targets[0].distractors = ["a parlé", "as parlé", "parles"];
    answer.transforms[0].accepted_outputs = ["J'ai mangé une pomme.", "J'ai mangé une pomme."];

    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "imported", rejected: 2 });
    expect(await testDb.sentenceTarget.count({ where: { target_id: unit.id } })).toBe(1);
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected.map((item) => item.part)).toEqual(["targets", "transforms"]);
    const fix = fixPrompt(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(fix).toContain("رکورد 1 (بخش targets):");
    expect(fix).toContain("unit، targets، transforms، translations");

    const fixed = example();
    expect(await submitAnswer(batch.id, [fence({ targets: [fixed.targets[0]], transforms: fixed.transforms, issues: [] })], "fix")).toEqual({
      state: "imported",
      rejected: 0,
    });
    expect(await testDb.sentenceTarget.count({ where: { target_id: unit.id } })).toBe(2);
    expect(await testDb.transformItem.count()).toBe(1);
  });

  it("adds the next targets of the same unit from a second answer and keeps what is already there", async () => {
    const unit = await setup();
    const batch = await grammarBatch();
    await submitAnswer(batch.id, [fence(example())], "answer");
    const more = example();
    more.targets.push({
      sentence: {
        text: "Tu as écouté la musique.",
        translation_fa: "به موسیقی گوش دادی.",
        tokens: [
          { surface: "Tu", kind: "word", code: "tu", meaning_fa: "تو" },
          { surface: "as", kind: "word", code: "avoir", meaning_fa: "(فعل کمکی)" },
          { surface: "écouté", kind: "word", code: "écouter", meaning_fa: "گوش دادی" },
          { surface: "la", kind: "word", code: "la", meaning_fa: "(حرف تعریف)" },
          { surface: "musique", kind: "word", code: "musique", meaning_fa: "موسیقی" },
        ],
      },
      marked_text: "Tu {{as écouté}} la musique.",
      blanks: 1,
      accepted: ["as écouté"],
      distractors: ["a écouté", "es écouté", "écoutes"],
      hint: "(écouter)",
      accepted_full: null,
    });
    expect(await submitAnswer(batch.id, [fence(more)], "fix")).toEqual({ state: "imported", rejected: 0 });
    expect(await testDb.sentenceTarget.count({ where: { target_id: unit.id } })).toBe(3);
    expect(await testDb.transformItem.count()).toBe(1);
    expect(await testDb.translateItem.count()).toBe(1);
  });

  it("refuses an answer written for another unit", async () => {
    await setup();
    const batch = await grammarBatch();
    const answer = example();
    answer.unit.unit_code = "fr-a1-autre";
    await submitAnswer(batch.id, [fence(answer)], "answer");
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected).toEqual([expect.objectContaining({ part: "unit", problems: [expect.objectContaining({ key: "unitCodeMismatch" })] })]);
  });
});

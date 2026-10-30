import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { batchReport, createBatch, qaPrompt, submitAnswer } from "@/server/content/batches";
import { phonicsEditor } from "@/server/content/library/edit/phonics";
import { contentStatus } from "@/server/content/status";
import { saveGeneralSettings } from "@/server/settings/general";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const example = (language: string) => JSON.parse(readFileSync(join(process.cwd(), `prompts/v1/examples/P-H.${language}.json`), "utf8"));
const fence = (value: unknown) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

/** Two lessons of the list: a contrast lesson and a liaison lesson. */
async function lessonList() {
  await testDb.appSetting.create({
    data: {
      key: "phonics.lessons.fr",
      value: [
        { label: "u و ou", kind: "contrast" },
        { label: "liaison و enchaînement", kind: "liaison" },
      ],
    },
  });
}

async function lessonBatch() {
  const made = await createBatch({ slug: "phonics", language: "fr", adminId: 1 });
  if (!("id" in made)) throw new Error(made.nothing);
  return testDb.importBatch.findUniqueOrThrow({ where: { id: made.id } });
}

describe("phonics lessons (P-H, PRD §8.1, §14.4)", () => {
  it("makes the teacher's lessons in order and stores the lists of the lesson's kind", async () => {
    await lessonList();
    expect((await contentStatus("fr")).phonicsNext).toEqual({ label: "u و ou", count: 2 });
    const batch = await lessonBatch();
    expect(batch.prompt_text).toContain("موضوع درس: u و ou | نوع درس (kind): contrast");
    expect(batch.prompt_text).not.toContain("⟦");
    // The open batch holds its lesson; the next one is offered.
    expect((await contentStatus("fr")).phonicsNext).toEqual({ label: "liaison و enchaînement", count: 1 });

    const answer = example("fr");
    answer.lesson.liaison_sentences = [{ text: "Les amis arrivent.", liaison_after_word_index: [0] }];
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "imported", rejected: 0 });
    const lesson = await testDb.phonicsLesson.findFirstOrThrow();
    expect(lesson).toEqual(expect.objectContaining({ kind: "contrast", sound_label: "u و ou", order_no: 1, import_batch_id: batch.id }));
    expect(lesson.minimal_pairs).toHaveLength(6);
    expect(lesson.liaison_sentences).toEqual([]);
    expect(qaPrompt(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))).toContain('"lesson"');
  });

  it("refuses a lesson made for another sound", async () => {
    await lessonList();
    const batch = await lessonBatch();
    const answer = example("fr");
    answer.lesson.sound_label = "liaison و enchaînement";
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "wrong_answer" });
    answer.lesson.sound_label = "U و OU ";
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toMatchObject({ state: "imported" });
  });

  it("keeps a renamed lesson matched with the teacher's list, whichever side renames it", async () => {
    await lessonList();
    const batch = await lessonBatch();
    expect(await submitAnswer(batch.id, [fence(example("fr"))], "answer")).toMatchObject({ state: "imported" });
    const lesson = await testDb.phonicsLesson.findFirstOrThrow();

    // Renamed in its form: the list entry follows, and the lesson is not offered again.
    const loaded = (await phonicsEditor.load(lesson.id))!;
    expect(await phonicsEditor.save(lesson.id, { ...loaded.values, sound_label: "u / ou" }, 1)).toMatchObject({ state: "saved" });
    const list = await testDb.appSetting.findUniqueOrThrow({ where: { key: "phonics.lessons.fr" } });
    expect((list.value as { label: string }[]).map((entry) => entry.label)).toEqual(["u / ou", "liaison و enchaînement"]);
    expect((await contentStatus("fr")).phonicsNext).toEqual({ label: "liaison و enchaînement", count: 1 });

    // Renamed in the general settings: the lesson follows. A new entry renames nothing.
    const renamed = [
      { label: "[y] و [u]", kind: "contrast" },
      { label: "liaison و enchaînement", kind: "liaison" },
    ];
    expect(await saveGeneralSettings({ "phonics.lessons.fr": renamed }, 1)).toMatchObject({ state: "saved" });
    expect((await testDb.phonicsLesson.findUniqueOrThrow({ where: { id: lesson.id } })).sound_label).toBe("[y] و [u]");
    expect(await saveGeneralSettings({ "phonics.lessons.fr": [...renamed, { label: "e muet", kind: "rule" }] }, 1)).toMatchObject({ state: "saved" });
    expect((await testDb.phonicsLesson.findUniqueOrThrow({ where: { id: lesson.id } })).sound_label).toBe("[y] و [u]");
    expect((await contentStatus("fr")).phonicsNext).toEqual({ label: "liaison و enchaînement", count: 2 });
  });

  it("rejects a lesson short of pairs or with a wrong spelling equal to the word", async () => {
    await lessonList();
    const batch = await lessonBatch();
    const answer = example("fr");
    answer.lesson.minimal_pairs = answer.lesson.minimal_pairs.slice(0, 3);
    answer.lesson.example_words[0].wrong_spellings = ["rue", "ru"];
    answer.lesson.example_words[1].wrong_spellings = ["tou"];
    expect(await submitAnswer(batch.id, [fence(answer)], "answer")).toEqual({ state: "imported", rejected: 1 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected[0].problems.map((found) => found.key)).toEqual(["wrongSpellingSame", "wrongSpellingsCount", "tooFew"]);
    expect(await testDb.phonicsLesson.count()).toBe(0);

    expect(await submitAnswer(batch.id, [fence(example("fr"))], "fix")).toEqual({ state: "imported", rejected: 0 });
    expect(await testDb.phonicsLesson.count()).toBe(1);
  });

  it("checks a liaison lesson by its sentences", async () => {
    await lessonList();
    await testDb.phonicsLesson.create({ data: { language: "fr", kind: "contrast", sound_label: "u  و ou", tip_fa: "…", graphemes: [] } });
    const batch = await lessonBatch();
    expect(batch.prompt_text).toContain("liaison و enchaînement");
    const sentences = ["Les amis arrivent.", "Nous avons faim.", "Ils ont un chat.", "Vous êtes ici.", "Un petit ami.", "Les enfants jouent.", "Deux heures.", "Mes oncles."];
    const lesson = {
      kind: "liaison",
      sound_label: "liaison و enchaînement",
      graphemes: [],
      tip_fa: "حرف آخر خاموش جلوی کلمه‌ای که با مصوت شروع می‌شود خوانده می‌شود.",
      example_words: [],
      minimal_pairs: [],
      liaison_sentences: sentences.map((text) => ({ text, liaison_after_word_index: [0] })),
    };
    lesson.liaison_sentences[7].liaison_after_word_index = [1];
    expect(await submitAnswer(batch.id, [fence({ lesson, issues: [] })], "answer")).toEqual({ state: "imported", rejected: 1 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected[0].problems).toEqual([{ key: "liaisonIndex", vars: { text: "Mes oncles." } }]);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { removeItems } from "@/server/content/library/remove";
import { buildPack } from "@/server/content/packs/build";
import { loadPack, PACK_VERSION } from "@/server/content/packs/load";
import { resetDb, testDb } from "./db";

/** The content packs (content/<language>/) load through the panel's importers and are published. */
beforeEach(async () => {
  await resetDb();
  await testDb.appSetting.create({ data: { key: "levels.fr", value: ["A1", "A2", "B1", "B2"] } });
  // The fixture is small: a word needs one sentence and a unit five targets to be published.
  for (const [key, value] of [
    ["publish.word_min_targets", 1],
    ["publish.unit_min_targets", 2],
  ] as const) {
    await testDb.engineSetting.upsert({ where: { key }, create: { key, value, default_value: value, description_fa: key }, update: { value } });
  }
});
afterAll(() => testDb.$disconnect());

const pack = () => buildPack("fr", { contentRoot: "tests/fixtures/packs" });

describe("content packs", () => {
  it("the fixture pack builds without errors", () => {
    expect(pack().errors).toEqual([]);
  });

  it("loads words, units, lessons, tables and sentences, and publishes what is ready", async () => {
    const report = await loadPack(pack());
    const level = report.levels[0];
    expect(level.rejected).toEqual([]);
    expect(level.skipped).toEqual([]);
    expect(level.added).toMatchObject({ units: 2, words: 40, tables: 12, sentences: 13, texts: 1, dialogues: 1, "find-the-mistake": 1 });
    expect(report.levels[1]).toMatchObject({ level: "phonics", added: { "phonics lessons": 1 }, rejected: [] });

    const word = await testDb.word.findFirstOrThrow({ where: { language: "fr", code: "voiture" } });
    expect(word.status).toBe("published");
    const unit = await testDb.grammarUnit.findFirstOrThrow({ where: { unit_code: "fr-a1-etre" } });
    expect(unit.status).toBe("published");
    expect(unit.lesson_fa).toMatch(/بودن/);
    const table = await testDb.conjugationTable.findFirstOrThrow({ where: { tense: "présent", word: { code: "être" } } });
    expect(table).toMatchObject({ unit_code: "fr-a1-etre", review_card: true, status: "published" });
    expect(table.forms).toMatchObject({ je: "suis", nous: "sommes" });
    // One sentence written for two words carries both targets.
    const shared = await testDb.sentence.findFirstOrThrow({ where: { text: "La maison est petite." }, include: { targets: true } });
    expect(shared.targets).toHaveLength(2);
    expect(await testDb.formException.count({ where: { word: { code: "être" }, surface: "sont" } })).toBe(1);
    // Texts, dialogues, find the mistake and phonics come in through their importers and are published too.
    const text = await testDb.text.findFirstOrThrow({ where: { code: "fr-a1-t001" }, include: { questions: true } });
    expect(text).toMatchObject({ status: "published", band: 1, kind: "dialogue", word_count: 37 });
    expect(text.questions).toHaveLength(8);
    expect(text.questions.every((question) => question.status === "published")).toBe(true);
    const textSentences = await testDb.sentence.findMany({ where: { id: { in: text.sentence_ids } } });
    expect(textSentences.every((sentence) => sentence.status === "published")).toBe(true);
    expect(await testDb.dialogue.findFirstOrThrow({ where: { code: "fr-a1-d001" } })).toMatchObject({ status: "published" });
    expect(await testDb.errorfixItem.findFirstOrThrow({ where: { language: "fr" } })).toMatchObject({ status: "published", unit_codes: ["fr-a1-etre"] });
    expect(await testDb.phonicsLesson.findFirstOrThrow({ where: { language: "fr" } })).toMatchObject({ status: "published", sound_label: "u و ou", order_no: 1 });
    const batches = await testDb.importBatch.findMany({ where: { prompt_version: PACK_VERSION } });
    expect(batches.every((batch) => batch.state === "reviewed")).toBe(true);
    expect(report.published).toBeGreaterThan(0);
  });

  it("loads an item once: the next start adds nothing, and an item a teacher deleted stays deleted", async () => {
    await loadPack(pack());
    const words = await testDb.word.count();
    const again = await loadPack(pack());
    expect(again.levels.map((item) => item.added)).toEqual([{}, {}]);
    expect(await testDb.text.count()).toBe(1);
    expect(await testDb.word.count()).toBe(words);

    const chien = await testDb.word.findFirstOrThrow({ where: { code: "chien" } });
    const removed = await removeItems("words", "fr", [chien.id], null);
    expect(removed.state).toBe("deleted");
    const third = await loadPack(pack());
    expect(third.levels[0].added).toEqual({});
    expect(await testDb.word.count({ where: { code: "chien" } })).toBe(0);
  });

  it("new items in the files come in at the next start", async () => {
    const first = pack();
    const level = first.levels[0];
    const late = level.sentences.filter((sentence) => sentence.text === "Je vais à la maison.");
    level.sentences = level.sentences.filter((sentence) => !late.includes(sentence));
    await loadPack(first);
    expect(await testDb.sentence.count({ where: { text: "Je vais à la maison." } })).toBe(0);
    const second = await loadPack(pack());
    expect(second.levels[0].added).toEqual({ sentences: 1 });
    const sentence = await testDb.sentence.findFirstOrThrow({ where: { text: "Je vais à la maison." } });
    expect(sentence.status).toBe("published");
  });
});

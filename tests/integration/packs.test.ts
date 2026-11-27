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
    expect(level.added).toMatchObject({ units: 2, words: 40, tables: 12, sentences: 13, dialogues: 1, "phonics lessons": 1 });

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
    const batches = await testDb.importBatch.findMany({ where: { prompt_version: PACK_VERSION } });
    expect(batches.every((batch) => batch.state === "reviewed")).toBe(true);
    expect(report.published).toBeGreaterThan(0);

    // A dialogue's lines and choices are sentences published with it; a phonics lesson takes its place in the list.
    const dialogue = await testDb.dialogue.findFirstOrThrow({ where: { language: "fr", code: "fr-a1-d001" } });
    expect(dialogue.status).toBe("published");
    const turns = dialogue.turns as { sentence_id: number; choices: { sentence_id: number }[]; correct: number }[];
    expect(turns).toHaveLength(5);
    const ids = turns.flatMap((turn) => [turn.sentence_id, ...turn.choices.map((choice) => choice.sentence_id)]);
    expect(await testDb.sentence.count({ where: { id: { in: ids }, status: "published" } })).toBe(20);
    const lesson = await testDb.phonicsLesson.findFirstOrThrow({ where: { language: "fr" } });
    expect(lesson).toMatchObject({ sound_label: "u و ou", kind: "contrast", order_no: 2, status: "published" });
  });

  it("loads an item once: the next start adds nothing, and an item a teacher deleted stays deleted", async () => {
    await loadPack(pack());
    const words = await testDb.word.count();
    const again = await loadPack(pack());
    expect(again.levels[0].added).toEqual({});
    expect(await testDb.word.count()).toBe(words);

    const chien = await testDb.word.findFirstOrThrow({ where: { code: "chien" } });
    const removed = await removeItems("words", "fr", [chien.id], null);
    expect(removed.state).toBe("deleted");
    const third = await loadPack(pack());
    expect(third.levels[0].added).toEqual({});
    expect(await testDb.word.count({ where: { code: "chien" } })).toBe(0);
  });

  it("brings in short translations added to a loaded unit's file, never back one a teacher deleted", async () => {
    await loadPack(pack());
    const unit = await testDb.grammarUnit.findFirstOrThrow({ where: { unit_code: "fr-a1-etre" } });
    const [first] = await testDb.translateItem.findMany({ where: { grammar_unit_id: unit.id } });
    expect((await removeItems("translations", "fr", [first.id], null)).state).toBe("deleted");

    type Translation = { prompt_fa: string; accepted_outputs: string[]; tokens: unknown[] };
    const next = pack();
    const list = (next.levels[0].units.find((item) => item.listItem.unit_code === "fr-a1-etre")!.answer as { translations: Translation[] }).translations;
    list.push({ ...list[0], prompt_fa: "من خیلی بزرگم." });
    const report = await loadPack(next);
    expect(report.levels[0].added).toEqual({ translations: 1 });
    const after = await testDb.translateItem.findMany({ where: { grammar_unit_id: unit.id } });
    expect(after.map((row) => row.prompt_fa)).toEqual(["من خیلی بزرگم."]);
    expect(after[0].status).not.toBe("draft");
    expect((await loadPack(next)).levels[0].added).toEqual({});
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

  it("brings a note added to a loaded word's file onto it once, never over a teacher's edit", async () => {
    await loadPack(pack());
    const note = "پیوند با فارسی: …";
    const next = pack();
    const words = next.levels[0].words;
    const voiture = words.find((item) => item.word.code === "voiture")!;
    const chien = words.find((item) => item.word.code === "chien")!;
    voiture.word = { ...voiture.word, note_fa: note };
    chien.word = { ...chien.word, note_fa: note };
    // A teacher edited chien (any field): its note is left to the teacher.
    const chienRow = await testDb.word.findFirstOrThrow({ where: { code: "chien" } });
    await testDb.adminLog.create({ data: { action: "edit", entity: "word", entity_id: String(chienRow.id), before: { meaning_fa: "سگ" }, after: { meaning_fa: "سگ، توله" } } });

    const report = await loadPack(next);
    expect(report.levels[0].added).toEqual({ "word notes": 1 });
    expect((await testDb.word.findFirstOrThrow({ where: { code: "voiture" } })).note_fa).toBe(note);
    expect((await testDb.word.findFirstOrThrow({ where: { code: "chien" } })).note_fa).toBeNull();
    expect(await testDb.adminLog.count({ where: { entity: "word", entity_id: String((await testDb.word.findFirstOrThrow({ where: { code: "voiture" } })).id) } })).toBe(1);

    // Deleted by a teacher afterwards: the next start does not bring it back.
    await testDb.word.updateMany({ where: { code: "voiture" }, data: { note_fa: null } });
    expect((await loadPack(next)).levels[0].added).toEqual({});
    expect((await testDb.word.findFirstOrThrow({ where: { code: "voiture" } })).note_fa).toBeNull();
  });
});

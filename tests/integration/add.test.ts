import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBatch, submitAnswer } from "@/server/content/batches";
import { customWords } from "@/server/content/kinds/word-list";
import { addSentence, addWord, copyItem } from "@/server/content/library/create";
import { listLog } from "@/server/content/library/history";
import { resetDb, testDb } from "./db";

beforeEach(async () => {
  await resetDb();
  await testDb.appSetting.create({ data: { key: "levels.fr", value: ["A1", "A2", "B1", "B2"] } });
});
afterAll(() => testDb.$disconnect());

const ADMIN = 1;

async function word(code: string, extra: Record<string, unknown> = {}) {
  return testDb.word.create({ data: { language: "fr", code, lemma: code, pos: "noun", gender: "m", level: "A1", meaning_fa: "معنی", ...extra } });
}

describe("adding more, the teacher's way (owner's choice)", () => {
  it("makes a word list from the teacher's own words, with the level they chose, and skips repeats", async () => {
    await testDb.frequencyItem.createMany({ data: [{ language: "fr", rank: 1, lemma: "boulangerie" }, { language: "fr", rank: 2, lemma: "être" }] });
    expect(customWords(" boulangerie\nprendre une décision، Boulangerie\n\n" + "x".repeat(81))).toEqual(["boulangerie", "prendre une décision"]);
    const made = await createBatch({ slug: "word-list", language: "fr", options: { level: "A2", words: ["boulangerie", "prendre une décision"] }, adminId: ADMIN });
    if (!("id" in made)) throw new Error(made.nothing);
    const batch = await testDb.importBatch.findUniqueOrThrow({ where: { id: made.id } });
    expect(batch.prompt_text).toContain("boulangerie\nprendre une décision");
    expect(batch.prompt_text).toContain("سطح A2");
    expect(batch.prompt_text).not.toContain("⟦");
    // The frequency list does not offer «boulangerie» again; «être» stays for its own batch.
    expect(await testDb.frequencyItem.findMany({ where: { used_in_batch_id: batch.id }, select: { lemma: true } })).toEqual([{ lemma: "boulangerie" }]);

    const answer = {
      items: [
        { lemma: "boulangerie", keep: true, pos: "noun", level: "B1", no_card: false, reason: null },
        { lemma: "prendre une décision", keep: true, pos: "phrase", level: "B1", no_card: false, reason: null },
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [JSON.stringify(answer)], "answer")).toEqual({ state: "imported", rejected: 0 });
    const words = await testDb.word.findMany({ orderBy: { intro_order: "asc" } });
    expect(words.map((row) => [row.lemma, row.level, row.frequency_rank])).toEqual([
      ["boulangerie", "A2", 1],
      ["prendre une décision", "A2", null],
    ]);
  });

  it("asks the chatbot for the number of words the teacher chose", async () => {
    await testDb.frequencyItem.createMany({ data: Array.from({ length: 30 }, (_, index) => ({ language: "fr", rank: index + 1, lemma: `mot${index + 1}` })) });
    const made = await createBatch({ slug: "word-list", language: "fr", options: { size: 7 }, adminId: ADMIN });
    if (!("id" in made)) throw new Error(made.nothing);
    expect(await testDb.frequencyItem.count({ where: { used_in_batch_id: made.id } })).toBe(7);
  });

  it("adds a word by hand as a draft at the end of its level, and refuses the same word twice", async () => {
    await word("pain", { intro_order: 4 });
    const added = await addWord("fr", { lemma: " maison ", pos: "noun", level: "A1", gender: "f", meaning_fa: "خانه" }, ADMIN);
    expect(added.state).toBe("added");
    if (added.state !== "added") return;
    expect(await testDb.word.findUniqueOrThrow({ where: { id: added.id } })).toEqual(
      expect.objectContaining({ code: "maison", lemma: "maison", gender: "f", status: "draft", intro_order: 5, meaning_fa: "خانه" }),
    );
    expect(await addWord("fr", { lemma: "maison", pos: "noun", level: "A2", gender: "f" }, ADMIN)).toEqual({ state: "exists", id: added.id });
    expect((await addWord("fr", { lemma: "maison", pos: "noun", level: "C9" }, ADMIN)).state).toBe("invalid");
    expect((await listLog("words", 1)).items[0].lines[0].note).toBe("دستی ساخته شد، بدون چت‌بات.");
  });

  it("adds a sentence by hand with its words matched and one blank on the chosen word", async () => {
    const pain = await word("pain");
    await word("le", { pos: "det", gender: null });
    const added = await addSentence("fr", { text: "Le pain.", translation_fa: "نان.", target: "pain", distractors: ["lait", "vin", "riz"] }, ADMIN);
    expect(added.state).toBe("added");
    if (added.state !== "added") return;
    const rows = await testDb.sentenceWord.findMany({ where: { sentence_id: added.id }, orderBy: { position: "asc" } });
    expect(rows.map((row) => [row.surface, row.word_id])).toEqual([
      ["Le", expect.any(Number)],
      ["pain", pain.id],
    ]);
    expect(await testDb.sentenceTarget.findFirstOrThrow({ where: { sentence_id: added.id } })).toEqual(
      expect.objectContaining({ target_type: "word", target_id: pain.id, marked_text: "Le {{pain}}.", accepted: ["pain"], distractors: ["lait", "vin", "riz"] }),
    );
    expect(await addSentence("fr", { text: "le  pain.", translation_fa: "نان." }, ADMIN)).toEqual({ state: "exists", id: added.id });
    const repeated = await addSentence("fr", { text: "Du pain.", translation_fa: "نان.", target: "pain", distractors: ["pain", "vin", "riz"] }, ADMIN);
    expect(repeated.state).toBe("invalid");
    const absent = await addSentence("fr", { text: "Le lait.", translation_fa: "شیر.", target: "pain", distractors: ["a", "b", "c"] }, ADMIN);
    expect(absent).toEqual({ state: "invalid", errors: [expect.objectContaining({ path: "target", message: expect.stringContaining("pain") })] });
  });

  it("copies a word as a new sense and a unit with its own code, as drafts without audio", async () => {
    const glace = await word("glace", { status: "published", audio_id: 7, intro_order: 1 });
    const copied = await copyItem("words", glace.id, ADMIN);
    expect(copied.state).toBe("copied");
    if (copied.state !== "copied") return;
    expect(await testDb.word.findUniqueOrThrow({ where: { id: copied.id } })).toEqual(
      expect.objectContaining({ code: "glace-2", sense_of: "glace", lemma: "glace", status: "draft", audio_id: null, intro_order: 2 }),
    );
    const unit = await testDb.grammarUnit.create({ data: { language: "fr", unit_code: "fr-a1-x", title_fa: "واحد", level: "A1", build_table: [["a", "b"]], example_sentence_ids: [3] } });
    const copy = await copyItem("units", unit.id, ADMIN);
    if (copy.state !== "copied") throw new Error(copy.state);
    expect(await testDb.grammarUnit.findUniqueOrThrow({ where: { id: copy.id } })).toEqual(
      expect.objectContaining({ unit_code: "fr-a1-x-2", title_fa: "واحد (۲)", build_table: [["a", "b"]], example_sentence_ids: [], status: "draft" }),
    );
    expect(await copyItem("texts", 1, ADMIN)).toEqual({ state: "unsupported" });
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBatch } from "@/server/content/batches";
import { sentenceHealth } from "@/server/content/health/sentences";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const pad = (n: number) => String(n).padStart(2, "0");
let ids: Record<string, number> = {};
let made = 0;

/** 40 French A1 card words w01…w40 in that order, and «le» without a card. */
async function vocabulary() {
  ids = {};
  for (let n = 1; n <= 40; n++) {
    const row = await testDb.word.create({
      data: { language: "fr", code: `w${pad(n)}`, lemma: `w${pad(n)}`, pos: "noun", level: "A1", meaning_fa: `m${n}`, intro_order: n },
    });
    ids[`w${pad(n)}`] = row.id;
  }
  ids.le = (await testDb.word.create({ data: { language: "fr", code: "le", lemma: "le", pos: "det", level: "A1", meaning_fa: "حرف تعریف", no_card: true } })).id;
}

/** A sentence for `target` made of `words` (null = an unresolved candidate). */
async function sentence(target: string, words: (string | null)[], options: { retired?: boolean; suspended?: boolean } = {}) {
  made++;
  const text = words.map((code) => code ?? "orange").join(" ");
  const row = await testDb.sentence.create({
    data: { language: "fr", text, translation_fa: "جمله", text_hash: `h${made}`, suspended: options.suspended ?? false },
  });
  await testDb.sentenceWord.createMany({
    data: words.map((code, position) => ({ sentence_id: row.id, word_id: code ? ids[code] : null, surface: code ?? "orange", spans: [[0, 1]], position })),
  });
  await testDb.sentenceTarget.create({
    data: {
      language: "fr",
      sentence_id: row.id,
      target_type: "word",
      target_id: ids[target],
      marked_text: text,
      accepted: [],
      distractors: [],
      status: options.retired ? "retired" : "draft",
    },
  });
}

describe("«جمله قابل‌استفاده هر کلمه» (PRD §13.11)", () => {
  it("flags words with too few usable sentences, names what blocks them and lists words without sentences apart", async () => {
    await vocabulary();
    await sentence("w35", ["w35", "w01", "le"]);
    await sentence("w35", ["w35", "w36"]);
    await sentence("w35", ["w35", null]);
    await sentence("w35", ["w35", "w02"], { retired: true });
    await sentence("w35", ["w35", "w03"], { suspended: true });
    for (const other of ["w01", "w35", "le"]) await sentence("w36", ["w36", other]);
    // Among the first 30 words every word counts as known (PRD §14.9).
    await sentence("w05", ["w05", "w20"]);

    const { min, levels } = await sentenceHealth("fr");
    expect(min).toBe(3);
    const a1 = levels.find((level) => level.level === "A1")!;
    expect([a1.cardWords, a1.healthy, a1.low.length, a1.none.length]).toEqual([40, 1, 2, 37]);
    expect(a1.low.map((row) => [row.lemma, row.total, row.usable])).toEqual([
      ["w05", 1, 1],
      ["w35", 3, 1],
    ]);
    expect(a1.low[1].blockers.map((blocker) => [blocker.label, blocker.reason, blocker.count])).toEqual([
      ["orange", "unknown", 1],
      ["w36", "later", 1],
    ]);
    expect(a1.none[0]).toMatchObject({ lemma: "w01", total: 0, usable: 0 });
    expect(levels.map((level) => level.level)).toEqual(["A1", "A2", "B1", "B2"]);
  });

  it("follows the order: moving a blocker earlier makes the sentence usable", async () => {
    await vocabulary();
    await sentence("w35", ["w35", "w36"]);
    let row = (await sentenceHealth("fr")).levels[0].low.find((item) => item.lemma === "w35")!;
    expect(row.usable).toBe(0);
    await testDb.word.update({ where: { id: ids.w36 }, data: { intro_order: 34 } });
    row = (await sentenceHealth("fr")).levels[0].low.find((item) => item.lemma === "w35")!;
    expect(row).toMatchObject({ usable: 1, blockers: [] });
  });

  it("opens P-S for exactly the chosen words, with only the words met before the first of them", async () => {
    await vocabulary();
    // w38 already has enough sentences for the normal step 1, but was chosen on the page.
    for (let n = 0; n < 8; n++) await sentence("w38", ["w38", "w01"]);
    const result = await createBatch({ slug: "sentences", language: "fr", options: { wordIds: [ids.w38, ids.w35] }, adminId: 1 });
    expect("id" in result).toBe(true);
    const batch = await testDb.importBatch.findUniqueOrThrow({ where: { id: "id" in result ? result.id : 0 } });
    expect(batch.params).toMatchObject({ level: "A1", word_ids: [ids.w35, ids.w38] });
    expect(batch.prompt_text).toContain("w35 | noun | m35\nw38 | noun | m38");
    expect(batch.prompt_text).toContain("w34 | noun");
    expect(batch.prompt_text).toContain("le | det");
    for (const later of ["w36", "w37", "w39"]) expect(batch.prompt_text).not.toContain(`${later} | noun`);

    // The normal step 1 lets a batch use every word up to its last target.
    const normal = await createBatch({ slug: "sentences", language: "fr", options: {}, adminId: 1 });
    const first = await testDb.importBatch.findUniqueOrThrow({ where: { id: "id" in normal ? normal.id : 0 } });
    expect(first.params).toMatchObject({ word_ids: Array.from({ length: 10 }, (_, index) => ids[`w${pad(index + 1)}`]) });
  });
});

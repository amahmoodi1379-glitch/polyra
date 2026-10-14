import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/csv";
import { allJson, exportCounts, exportItems, itemsCsv, itemsJson, wordCsvColumns } from "@/server/content/transfer/export";
import { importWordsCsv } from "@/server/content/transfer/words-csv";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const ADMIN = 1;
const header = [...wordCsvColumns];

async function concept(name_fa: string) {
  return testDb.concept.upsert({ where: { language_name_fa: { language: "fr", name_fa } }, create: { language: "fr", name_fa }, update: {} });
}

async function word(code: string, extra: Record<string, unknown> = {}) {
  const { id: concept_id } = await concept(`مفهوم ${code}`);
  return testDb.word.create({
    data: { language: "fr", code, lemma: code, pos: "noun", gender: "m", number: "sg", level: "A1", meaning_fa: `معنی ${code}`, concept_id, ...extra },
  });
}

/** A word file as the panel exports it, with the given rows (column name to cell). */
const file = (rows: Record<string, string>[], columns: string[] = header) => toCsv([columns, ...rows.map((row) => columns.map((column) => row[column] ?? ""))]);

const row = (code: string, extra: Record<string, string> = {}) => ({
  code,
  lemma: code,
  pos: "noun",
  gender: "m",
  number: "sg",
  meaning_fa: `معنی ${code}`,
  level: "A1",
  register: "standard",
  concept_fa: `مفهوم ${code}`,
  no_card: "false",
  ...extra,
});

const run = (text: string, dryRun = false) => importWordsCsv({ language: "fr", text, adminId: ADMIN, dryRun });
const orderOf = async (level = "A1") =>
  (await testDb.word.findMany({ where: { language: "fr", level }, orderBy: { intro_order: "asc" }, select: { code: true } })).map((item) => item.code);

describe("export (PRD §13.2)", () => {
  it("writes the word list with exactly the columns of §14.7, in level and lesson order", async () => {
    await word("chat", { intro_order: 2, note_fa: 'یادداشت با "نقل‌قول", ویرگول' });
    await word("chien", { intro_order: 1, homophones: ["chiens", "chienne"] });
    await word("maison", { level: "A2", intro_order: 1, status: "retired" });
    await testDb.word.create({ data: { language: "de", code: "Hund", lemma: "Hund", pos: "noun", gender: "m", level: "A1" } });

    const items = await exportItems("words", "fr");
    expect(items.map((item) => item.code)).toEqual(["chien", "chat", "maison"]);
    const table = parseCsv(itemsCsv("words", items));
    expect(table[0]).toEqual(header);
    expect(table[1][header.indexOf("homophones")]).toBe("chiens|chienne");
    expect(table[1][header.indexOf("concept_fa")]).toBe("مفهوم chien");
    expect(table[2][header.indexOf("note_fa")]).toBe('یادداشت با "نقل‌قول", ویرگول');
    expect(table[3][header.indexOf("level")]).toBe("A2");
    expect((await exportCounts("fr")).words).toBe(3);
  });

  it("keeps a sentence's word mapping and targets in JSON, and leaves them out of CSV", async () => {
    const chat = await word("chat");
    const sentence = await testDb.sentence.create({
      data: {
        language: "fr",
        text: "Le chat dort.",
        translation_fa: "گربه می‌خوابد.",
        level: "A1",
        text_hash: "h1",
        words: { create: [{ word_id: chat.id, surface: "chat", spans: [[3, 7]], position: 1 }] },
        targets: { create: [{ language: "fr", target_type: "word", target_id: chat.id, marked_text: "Le [chat] dort.", accepted: ["chat"], distractors: ["chien"] }] },
      },
    });

    const items = await exportItems("sentences", "fr");
    const json = JSON.parse(itemsJson("sentences", "fr", items, new Date("2026-10-14T08:00:00Z")));
    expect(json).toMatchObject({ language: "fr", type: "sentences", count: 1, exported_at: "2026-10-14T08:00:00.000Z" });
    expect(json.items[0].words[0]).toMatchObject({ surface: "chat", word_code: "chat" });
    expect(json.items[0].targets[0]).toMatchObject({ marked_text: "Le [chat] dort." });

    const table = parseCsv(itemsCsv("sentences", items));
    expect(table[0]).toContain("text");
    expect(table[0]).not.toContain("words");
    expect(table[0]).not.toContain("targets");
    expect(table[1][table[0].indexOf("id")]).toBe(String(sentence.id));

    const all = JSON.parse(await allJson("fr"));
    expect(Object.keys(all.types)).toHaveLength(11);
    expect(all.types.words).toHaveLength(1);
  });
});

describe("word file import (PRD §14.7)", () => {
  it("checks a file without saving anything, then imports it", async () => {
    await word("chat", { intro_order: 1 });
    const text = file([row("chat"), row("chien")]);

    const checked = await run(text, true);
    expect(checked).toMatchObject({ state: "checked", added: 1, updated: 0, unchanged: 1, rejected: [] });
    expect(await testDb.word.count()).toBe(1);
    expect(await testDb.adminLog.count()).toBe(0);

    const imported = await run(text);
    expect(imported).toMatchObject({ state: "imported", added: 1, unchanged: 1, reordered: ["A1"] });
    const chien = await testDb.word.findFirstOrThrow({ where: { code: "chien" }, include: { concept: true } });
    expect(chien).toMatchObject({ status: "draft", meaning_fa: "معنی chien", mastery: "produce", intro_order: 2 });
    expect(chien.concept?.name_fa).toBe("مفهوم chien");
    const logs = await testDb.adminLog.findMany({ orderBy: { id: "asc" } });
    expect(logs.map((log) => log.action)).toEqual(["import", "order"]);
    expect(logs[0]).toMatchObject({ entity: "word", entity_id: String(chien.id), before: null });
  });

  it("updates only what changed on a draft, and keeps the columns the file leaves out", async () => {
    const chat = await word("chat", { note_fa: "یادداشت", homophones: ["chats"] });
    const columns = ["code", "lemma", "pos", "gender", "number", "meaning_fa", "level", "concept_fa"];
    const report = await run(file([row("chat", { meaning_fa: "گربه" })], columns));
    expect(report).toMatchObject({ state: "imported", updated: 1 });

    const after = await testDb.word.findUniqueOrThrow({ where: { id: chat.id } });
    expect(after).toMatchObject({ meaning_fa: "گربه", note_fa: "یادداشت", homophones: ["chats"] });
    const log = await testDb.adminLog.findFirstOrThrow({ where: { action: "import" } });
    expect(log.before).toEqual({ meaning_fa: "معنی chat" });
    expect(log.after).toEqual({ meaning_fa: "گربه" });
  });

  it("empties a cell left blank, but never a meaning", async () => {
    await word("chat", { note_fa: "یادداشت" });
    await word("chien");
    const report = await run(file([row("chat", { note_fa: "" }), row("chien", { meaning_fa: "" })]));
    expect(report).toMatchObject({ updated: 1 });
    expect(report.state === "imported" && report.rejected.map((item) => [item.row, item.label])).toEqual([[3, "chien"]]);
    expect(report.state === "imported" && report.rejected[0].problems[0]).toContain("معنی از این‌جا پاک نمی‌شود");
    expect((await testDb.word.findFirstOrThrow({ where: { code: "chat" } })).note_fa).toBeNull();
    expect((await testDb.word.findFirstOrThrow({ where: { code: "chien" } })).meaning_fa).toBe("معنی chien");
  });

  it("refuses approved words, repeated codes and bad values, and imports the rest", async () => {
    await word("chat", { status: "approved" });
    const report = await run(
      file([
        row("chat", { meaning_fa: "گربه" }),
        row("chien"),
        row("chien", { meaning_fa: "سگ" }),
        row("lune", { gender: "x" }),
        row("ciel", { level: "C1" }),
        row("mer", { no_card: "شاید" }),
      ]),
    );
    expect(report.state).toBe("imported");
    if (report.state !== "imported") return;
    expect(report.added).toBe(1);
    expect(report.rejected.map((item) => item.label)).toEqual(["chat", "chien", "lune", "ciel", "mer"]);
    expect(report.rejected[0].problems[0]).toContain("قبلاً تأیید یا منتشر شده");
    expect(report.rejected[1].problems[0]).toContain("دو بار آمده");
    expect((await testDb.word.findFirstOrThrow({ where: { code: "chat" } })).meaning_fa).toBe("معنی chat");
    expect((await testDb.word.findFirstOrThrow({ where: { code: "chien" } })).meaning_fa).toBe("معنی chien");
  });

  it("takes a row without meaning as a list entry, and marks a same-lemma word as a possible duplicate", async () => {
    const livre = await word("livre");
    const report = await run(
      file([
        { code: "table", lemma: "table", pos: "noun", gender: "f", level: "A1", no_card: "0" },
        { code: "livre_2", lemma: "livre", pos: "noun", gender: "f", number: "sg", level: "A1", meaning_fa: "پوند", concept_fa: "پوند" },
        { code: "Livre", lemma: "livre", pos: "noun", gender: "m", level: "A1" },
      ]),
    );
    expect(report).toMatchObject({ state: "imported", added: 3, duplicates: 1, rejected: [] });
    expect(await testDb.word.findFirstOrThrow({ where: { code: "table" } })).toMatchObject({ meaning_fa: null, concept_id: null, status: "draft" });
    expect((await testDb.word.findFirstOrThrow({ where: { code: "livre_2" } })).dup_of_id).toBeNull();
    expect((await testDb.word.findFirstOrThrow({ where: { code: "Livre" } })).dup_of_id).toBe(livre.id);
  });

  it("follows the file order: a whole level exported, reordered and imported comes back in file order", async () => {
    for (const [index, code] of ["un", "deux", "trois", "quatre"].entries()) await word(code, { intro_order: index + 1 });
    const exported = parseCsv(itemsCsv("words", await exportItems("words", "fr")));
    const [columns, ...rows] = exported;
    const reordered = [rows[3], rows[1], rows[0], rows[2]];
    const report = await run(toCsv([columns, ...reordered]));
    expect(report).toMatchObject({ state: "imported", unchanged: 4, reordered: ["A1"] });
    expect(await orderOf()).toEqual(["quatre", "deux", "un", "trois"]);
    const log = await testDb.adminLog.findFirstOrThrow({ where: { action: "order" } });
    expect(log.entity_id).toBe("fr:A1");
  });

  it("refuses a file without the needed columns, an empty one and a huge one", async () => {
    expect(await run(file([row("chat")], ["code", "lemma", "meaning_fa"]))).toEqual({ state: "invalid", reason: "columns", missing: ["pos", "level"] });
    expect(await run(toCsv([header]))).toEqual({ state: "invalid", reason: "empty" });
    expect(await run("x".repeat(3_000_001))).toEqual({ state: "invalid", reason: "tooBig" });
  });

  it("reports columns it does not know and reads a spreadsheet saved with semicolons", async () => {
    const text = ["code;lemma;pos;gender;level;source", "chat;chat;noun;m;A1;lexique"].join("\n");
    const report = await run(text);
    expect(report).toMatchObject({ state: "imported", added: 1, ignored: ["source"] });
  });
});

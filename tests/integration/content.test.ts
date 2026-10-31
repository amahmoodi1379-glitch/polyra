import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  batchFindings,
  batchReport,
  cancelBatch,
  createBatch,
  fixPrompt,
  qaPrompt,
  submitAnswer,
  submitQa,
} from "@/server/content/batches";
import { unitEditor } from "@/server/content/library/edit/units";
import { listLog } from "@/server/content/library/history";
import { wordEditor } from "@/server/content/library/edit/words";
import { describeProblem } from "@/server/content/problems";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const json = (value: unknown) => JSON.stringify(value, null, 2);

async function batchFor(slug: "word-list" | "units" | "words" | "sentences", language: "fr" | "de" = "fr", level?: string) {
  const made = await createBatch({ slug, language, options: { level }, adminId: 1 });
  if (!("id" in made)) throw new Error(`expected a batch: ${made.nothing}`);
  return testDb.importBatch.findUniqueOrThrow({ where: { id: made.id } });
}

async function frequency(language: string, lemmas: string[]) {
  await testDb.frequencyItem.createMany({ data: lemmas.map((lemma, index) => ({ language, rank: index + 1, lemma })) });
}

/** A full P-W record with sensible defaults. */
function wordRecord(fields: Record<string, unknown>) {
  return {
    pos: "noun",
    gender: "f",
    number: "sg",
    plural: null,
    level: "A1",
    register: "standard",
    no_card: false,
    homophones: [],
    note_fa: null,
    mastery: "produce",
    sense_of: null,
    parts: null,
    family: null,
    collocations: [],
    ...fields,
  };
}

describe("word list (P-C, PRD §14.5 and §13.9)", () => {
  it("turns kept lemmas into draft words in frequency order and explains rejected rows", async () => {
    await frequency("fr", ["être", "voiture", "suis", "maison", "au"]);
    const batch = await batchFor("word-list");
    expect(batch.prompt_text).toContain("voiture\nsuis");
    expect(batch.prompt_text).toContain("DELF/DALF");
    expect(batch.prompt_text).not.toContain("⟦");
    expect(await testDb.frequencyItem.count({ where: { used_in_batch_id: batch.id } })).toBe(5);

    const answer = {
      items: [
        { lemma: "être", keep: true, pos: "verb", level: "A1", no_card: false, reason: null },
        { lemma: "voiture", keep: true, pos: "noun", level: "A1", no_card: false, reason: null },
        { lemma: "suis", keep: false, pos: null, level: "A0", no_card: false, reason: "شکل صرف‌شده" },
        { lemma: "maison", keep: true, pos: "nom", level: "A1", no_card: false, reason: null },
        { lemma: "au", keep: true, pos: "prep", level: "A1", no_card: true, reason: null },
      ],
      issues: [],
    };
    const result = await submitAnswer(batch.id, [`Here you go!\n\`\`\`json\n${json(answer)}\n\`\`\``], "answer");
    expect(result).toEqual({ state: "imported", rejected: 1 });

    const words = await testDb.word.findMany({ where: { language: "fr" }, orderBy: { intro_order: "asc" } });
    expect(words.map((word) => [word.code, word.intro_order, word.frequency_rank, word.meaning_fa])).toEqual([
      ["être", 1, 1, null],
      ["voiture", 2, 2, null],
      ["au", 3, 5, null],
    ]);
    expect(words[2].no_card).toBe(true);

    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report).toMatchObject({ added: 3, dropped: 1, rounds: 1 });
    expect(report.rejected[0].label).toBe("maison");
    expect(describeProblem(report.rejected[0].problems[0])).toBe("مقدار «nom» برای «نوع کلمه» مجاز نیست.");

    // The fix prompt carries only the rejected row, with the reason in the chatbot's terms.
    const fix = fixPrompt(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(fix).toContain('"lemma": "maison"');
    expect(fix).toContain("مقدار «nom» برای «pos» مجاز نیست.");
    expect(fix).not.toContain("voiture");

    const fixed = { items: [{ lemma: "maison", keep: true, pos: "noun", level: "A1", no_card: false, reason: null }] };
    expect(await submitAnswer(batch.id, [json(fixed)], "fix")).toEqual({ state: "imported", rejected: 0 });
    const after = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(after).toMatchObject({ added: 4, rounds: 2, rejected: [] });
    expect(await testDb.word.findFirst({ where: { code: "maison" } })).toMatchObject({ intro_order: 4, frequency_rank: 4 });
  });

  it("refuses a level outside the language's list of levels", async () => {
    await frequency("fr", ["voiture", "néanmoins"]);
    const batch = await batchFor("word-list");
    const answer = {
      items: [
        { lemma: "voiture", keep: true, pos: "noun", level: "A1", no_card: false, reason: null },
        { lemma: "néanmoins", keep: true, pos: "adv", level: "C1", no_card: false, reason: null },
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [json(answer)], "answer")).toEqual({ state: "imported", rejected: 1 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(describeProblem(report.rejected[0].problems[0])).toBe("سطح «C1» در فهرست سطح‌های این زبان (A1، A2، B1، B2) نیست.");
  });

  it("keeps a cut answer and imports it once the continuation arrives", async () => {
    await frequency("fr", ["voiture", "maison"]);
    const batch = await batchFor("word-list");
    const answer = json({
      items: [
        { lemma: "voiture", keep: true, pos: "noun", level: "A1", no_card: false, reason: null },
        { lemma: "maison", keep: true, pos: "noun", level: "A1", no_card: false, reason: null },
      ],
      issues: [],
    });
    const cutAt = answer.indexOf("maison") + 3;
    expect(await submitAnswer(batch.id, [answer.slice(0, cutAt)], "answer")).toEqual({ state: "cut" });
    expect((await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).state).toBe("pasted");

    const result = await submitAnswer(batch.id, [answer.slice(0, cutAt), answer.slice(cutAt)], "answer");
    expect(result).toEqual({ state: "imported", rejected: 0 });
    expect(await testDb.word.count()).toBe(2);
  });
});

describe("an answer for another batch, or a batch that moved on", () => {
  const voiture = { lemma: "voiture", keep: true, pos: "noun", level: "A1", no_card: false, reason: null };

  it("refuses rows of another part of the frequency list, and a whole answer pasted a second time", async () => {
    await frequency("fr", ["voiture", "maison"]);
    const batch = await batchFor("word-list");
    const other = { items: [{ ...voiture, lemma: "chien" }, { ...voiture, lemma: "chat" }], issues: [] };
    expect(await submitAnswer(batch.id, [json(other)], "answer")).toEqual({ state: "wrong_answer" });
    expect(await testDb.word.count()).toBe(0);

    // The same answer sent from two tabs at once is imported once.
    const answer = json({ items: [{ ...voiture, lemma: "Voiture" }], issues: [] });
    const results = await Promise.all([submitAnswer(batch.id, [answer], "answer"), submitAnswer(batch.id, [answer], "answer")]);
    expect(results.map((result) => result.state).sort()).toEqual(["imported", "stale"]);
    expect(await submitAnswer(batch.id, [answer], "answer")).toEqual({ state: "stale" });
    expect(await testDb.word.count()).toBe(1);
  });

  it("refuses a fix before anything was imported, and anything for a batch thrown away", async () => {
    await frequency("fr", ["voiture"]);
    const batch = await batchFor("word-list");
    const answer = json({ items: [voiture], issues: [] });
    expect(await submitAnswer(batch.id, [answer], "fix")).toEqual({ state: "stale" });
    expect(await submitQa(batch.id, ['{"findings": []}'])).toEqual({ state: "stale" });
    await testDb.frequencyItem.updateMany({ data: { used_in_batch_id: null } });
    await testDb.importBatch.delete({ where: { id: batch.id } });
    expect(await submitAnswer(batch.id, [answer], "answer")).toEqual({ state: "stale" });
  });

  it("does not ask a second batch for the words an open batch holds, until it is thrown away", async () => {
    await testDb.word.create({ data: { language: "fr", code: "voiture", lemma: "voiture", pos: "noun", level: "A1", intro_order: 1 } });
    const first = await batchFor("words");
    expect(await createBatch({ slug: "words", language: "fr", adminId: 1 })).toHaveProperty("nothing");
    expect(await cancelBatch(first.id)).toBe(true);
    expect((await batchFor("words")).params).toMatchObject({ word_ids: first.params && (first.params as { word_ids: number[] }).word_ids });
  });

  it("refuses word records and sentences made for other words", async () => {
    await testDb.word.create({ data: { language: "fr", code: "voiture", lemma: "voiture", pos: "noun", level: "A1", intro_order: 1 } });
    const words = await batchFor("words");
    const chien = wordRecord({ code: "chien", lemma: "chien", gender: "m", meaning_fa: "سگ", concept_fa: "سگ" });
    expect(await submitAnswer(words.id, [json({ words: [chien], issues: [] })], "answer")).toEqual({ state: "wrong_answer" });
    // The chatbot may change a code; the lemma still names the word.
    const renamed = wordRecord({ code: "voiture-f", lemma: "voiture", meaning_fa: "ماشین", concept_fa: "ماشین" });
    expect(await submitAnswer(words.id, [json({ words: [renamed], issues: [] })], "answer")).toEqual({ state: "imported", rejected: 0 });

    await testDb.word.updateMany({ where: { code: "voiture-f" }, data: { status: "approved" } });
    const sentences = await batchFor("sentences");
    const sentence = {
      text: "Le chien mange.",
      translation_fa: "سگ می‌خورد.",
      tokens: [{ surface: "Le", code: "le" }, { surface: "chien", code: "chien" }, { surface: "mange", code: "manger" }],
      targets: [{ type: "word", target: "chien", marked_text: "Le {{chien}} mange.", blanks: 1, accepted: ["chien"], distractors: ["chat", "lit", "pain"] }],
    };
    expect(await submitAnswer(sentences.id, [json({ sentences: [sentence], issues: [] })], "answer")).toEqual({ state: "wrong_answer" });
    expect(await testDb.sentence.count()).toBe(0);
  });
});

describe("grammar unit list (P-U)", () => {
  it("makes draft units in teaching order and refuses codes from another level", async () => {
    const batch = await batchFor("units", "de");
    expect(batch.prompt_text).toContain("de-a1-");
    expect(batch.prompt_text).toContain("Goethe");
    const answer = {
      units: [
        { unit_code: "de-a1-praesens-regelmaessig", title_fa: "زمان حال", level: "A1", scope_fa: "فقط فعل‌های باقاعده" },
        { unit_code: "de-a2-perfekt", title_fa: "گذشته", level: "A1", scope_fa: "Perfekt با haben" },
        { unit_code: "de-a1-artikel", title_fa: "حرف تعریف", level: "A1", scope_fa: "der، die، das", can_do_fa: null },
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [json(answer)], "answer")).toEqual({ state: "imported", rejected: 1 });
    const units = await testDb.grammarUnit.findMany({ orderBy: { order_no: "asc" } });
    expect(units.map((unit) => [unit.unit_code, unit.order_no, unit.status])).toEqual([
      ["de-a1-praesens-regelmaessig", 1, "draft"],
      ["de-a1-artikel", 2, "draft"],
    ]);
  });
});

describe("a new answer for items the admin changed by hand", () => {
  it("keeps a unit title edited by hand and writes the rest of the unit", async () => {
    const batch = await batchFor("units", "de");
    const answer = {
      units: [
        { unit_code: "de-a1-artikel", title_fa: "حرف تعریف", level: "A1", scope_fa: "der، die، das" },
        { unit_code: "de-a2-perfekt", title_fa: "گذشته", level: "A1", scope_fa: "Perfekt" },
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [json(answer)], "answer", 1)).toEqual({ state: "imported", rejected: 1 });
    const unit = await testDb.grammarUnit.findFirstOrThrow({ where: { unit_code: "de-a1-artikel" } });
    const form = (await unitEditor.load(unit.id))!;
    expect(await unitEditor.save(unit.id, { ...form.values, title_fa: "حرف‌های تعریف" }, 1)).toMatchObject({ state: "saved" });

    const fixed = {
      units: [
        { unit_code: "de-a1-artikel", title_fa: "آرتیکل", level: "A1", scope_fa: "der، die، das و ein" },
        { unit_code: "de-a1-perfekt", title_fa: "گذشته", level: "A1", scope_fa: "Perfekt" },
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [json(fixed)], "fix", 1)).toEqual({ state: "imported", rejected: 0 });
    expect(await testDb.grammarUnit.findUniqueOrThrow({ where: { id: unit.id } })).toMatchObject({ title_fa: "حرف‌های تعریف", scope_fa: "der، die، das و ein" });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.warnings.map((flag) => [flag.label, flag.problem])).toEqual([["آرتیکل", { key: "handEditKept", vars: { fields: "title_fa" } }]]);

    // The change log has each paste under «ساخت محتوا», and what the fix changed on the unit.
    const pastes = await listLog("batches", 1);
    expect(pastes.items.map((item) => [item.title?.text, item.lines[0].label, item.lines[0].note, item.href, item.revert])).toEqual([
      [`فهرست واحدهای دستوری، دسته ${batch.id.toLocaleString("fa-IR")}`, "دور ۲", "۱ تازه، ۱ به‌روز", `/admin/batches/${batch.id}`, "no"],
      [`فهرست واحدهای دستوری، دسته ${batch.id.toLocaleString("fa-IR")}`, "دور ۱", "۱ تازه، ۱ رد شد", `/admin/batches/${batch.id}`, "no"],
    ]);
    const unitLog = await listLog("units", 1);
    expect(unitLog.items[0]).toMatchObject({ actionLabel: "ورود جواب چت‌بات", revert: "ready" });
    expect(unitLog.items[0].lines.map((line) => line.label)).toEqual(["محدوده"]);
  });
});

describe("word records (P-W)", () => {
  async function skeletons(language: "fr" | "de", list: [string, string, boolean?][]) {
    for (const [index, [lemma, pos, noCard]] of list.entries()) {
      await testDb.word.create({
        data: { language, code: lemma, lemma, pos: pos as "noun", level: "A1", intro_order: index + 1, no_card: noCard ?? false },
      });
    }
  }

  it("fills the drafts, adds a colloquial twin right after its word, and links both to one concept", async () => {
    await skeletons("fr", [
      ["voiture", "noun"],
      ["manger", "verb"],
    ]);
    const batch = await batchFor("words");
    expect(batch.prompt_text).toContain("voiture | noun | no_card=false\nmanger | verb | no_card=false");

    const answer = {
      words: [
        wordRecord({ code: "voiture", lemma: "voiture", meaning_fa: "ماشین", concept_fa: "ماشین" }),
        wordRecord({ code: "bagnole", lemma: "bagnole", meaning_fa: "ماشین (محاوره‌ای)", concept_fa: "ماشین", register: "familier" }),
        wordRecord({ code: "manger", lemma: "manger", pos: "verb", gender: "m", meaning_fa: "خوردن", concept_fa: "خوردن" }),
      ],
      issues: ["هیچ"],
    };
    expect(await submitAnswer(batch.id, [json(answer)], "answer")).toEqual({ state: "imported", rejected: 0 });

    const words = await testDb.word.findMany({ orderBy: { intro_order: "asc" }, include: { concept: true } });
    expect(words.map((word) => [word.code, word.intro_order, word.meaning_fa])).toEqual([
      ["voiture", 1, "ماشین"],
      ["bagnole", 2, "ماشین (محاوره‌ای)"],
      ["manger", 3, "خوردن"],
    ]);
    expect(words[0].concept_id).toBe(words[1].concept_id);
    // Gender belongs to nouns only.
    expect(words[2].gender).toBeNull();
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report).toMatchObject({ added: 1, updated: 2, issues: ["هیچ"] });
  });

  it("applies the language rules: German plural, gender values, low-level mastery, lone colloquial words", async () => {
    await skeletons("de", [
      ["Tisch", "noun"],
      ["Haus", "noun"],
      ["gehen", "verb"],
    ]);
    const batch = await batchFor("words", "de");
    const answer = {
      words: [
        wordRecord({ code: "Tisch", lemma: "Tisch", gender: "der", plural: null, meaning_fa: "میز", concept_fa: "میز" }),
        wordRecord({ code: "Haus", lemma: "Haus", gender: "m", plural: "Häuser", meaning_fa: "خانه", concept_fa: "خانه" }),
        wordRecord({ code: "gehen", lemma: "gehen", pos: "verb", meaning_fa: "رفتن", concept_fa: "رفتن", mastery: "recognize" }),
        wordRecord({ code: "Bude", lemma: "Bude", gender: "die", plural: "Buden", meaning_fa: "اتاق", concept_fa: "اتاق", register: "familier" }),
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [json(answer)], "answer")).toEqual({ state: "imported", rejected: 4 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected.map((item) => [item.label, item.problems.map((problem) => problem.key)])).toEqual([
      ["Tisch", ["germanPlural"]],
      ["Haus", ["genderForLanguage"]],
      ["gehen", ["masteryLowLevel"]],
      ["Bude", ["colloquialWithoutStandard"]],
    ]);
    // They came back refused, so none is reported missing.
    expect(report.warnings.map((flag) => flag.problem.key)).toEqual([]);
    expect(await testDb.word.count({ where: { meaning_fa: { not: null } } })).toBe(0);
  });

  it("fixes refused words without calling the others missing, and keeps a refused word the fix left out", async () => {
    await skeletons("fr", [
      ["voiture", "noun"],
      ["manger", "verb"],
      ["pomme", "noun"],
    ]);
    const batch = await batchFor("words");
    const answer = {
      words: [
        wordRecord({ code: "voiture", lemma: "voiture", meaning_fa: "ماشین", concept_fa: "ماشین" }),
        wordRecord({ code: "manger", lemma: "manger", pos: "verbe", meaning_fa: "خوردن", concept_fa: "خوردن" }),
        wordRecord({ code: "pomme", lemma: "pomme", gender: "x", meaning_fa: "سیب", concept_fa: "سیب" }),
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [json(answer)], "answer")).toEqual({ state: "imported", rejected: 2 });
    const fixed = { words: [wordRecord({ code: "manger", lemma: "manger", pos: "verb", gender: null, meaning_fa: "خوردن", concept_fa: "خوردن" })], issues: [] };
    expect(await submitAnswer(batch.id, [json(fixed)], "fix")).toEqual({ state: "imported", rejected: 1 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected.map((item) => item.label)).toEqual(["pomme"]);
    // Refused words are listed as refused, not as missing; voiture was filled in the first round.
    expect(report.warnings.filter((flag) => flag.problem.key === "notReturned")).toEqual([]);
  });

  it("keeps what the admin changed by hand when a fix answer brings the word again", async () => {
    await skeletons("fr", [
      ["voiture", "noun"],
      ["manger", "verb"],
    ]);
    const batch = await batchFor("words");
    const answer = {
      words: [
        wordRecord({ code: "voiture", lemma: "voiture", meaning_fa: "ماشین", concept_fa: "ماشین" }),
        wordRecord({ code: "manger", lemma: "manger", pos: "verbe", meaning_fa: "خوردن", concept_fa: "خوردن" }),
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [json(answer)], "answer", 1)).toEqual({ state: "imported", rejected: 1 });
    const voiture = await testDb.word.findFirstOrThrow({ where: { code: "voiture" } });
    const form = (await wordEditor.load(voiture.id))!;
    expect(await wordEditor.save(voiture.id, { ...form.values, meaning_fa: "خودرو" }, 1)).toMatchObject({ state: "saved" });

    const again = {
      words: [
        wordRecord({ code: "voiture", lemma: "voiture", meaning_fa: "اتومبیل", concept_fa: "ماشین", note_fa: "اسم مؤنث" }),
        wordRecord({ code: "manger", lemma: "manger", pos: "verb", gender: null, meaning_fa: "خوردن", concept_fa: "خوردن" }),
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [json(again)], "fix", 1)).toEqual({ state: "imported", rejected: 0 });
    expect(await testDb.word.findUniqueOrThrow({ where: { id: voiture.id } })).toMatchObject({ meaning_fa: "خودرو", note_fa: "اسم مؤنث" });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    const kept = report.warnings.filter((flag) => flag.problem.key === "handEditKept");
    expect(kept.map((flag) => [flag.label, flag.problem.vars])).toEqual([["voiture", { fields: "meaning_fa" }]]);
    expect(describeProblem(kept[0].problem)).toContain("برای معنی فارسی چیز دیگری داشت");
    // The fix wrote the note, so the change log has it with the admin who pasted it.
    const logged = await testDb.adminLog.findMany({ where: { entity: "word", entity_id: String(voiture.id) }, orderBy: { id: "asc" } });
    expect(logged.map((row) => row.action)).toEqual(["batch", "edit", "batch"]);
    expect(logged[2]).toMatchObject({
      admin_id: 1,
      before: { note_fa: null },
      after: { note_fa: "اسم مؤنث" },
    });
  });

  it("does not take a noun and a verb, or two genders, spelled alike for the same word", async () => {
    await testDb.word.create({ data: { language: "de", code: "Essen", lemma: "Essen", pos: "noun", gender: "das", level: "A1", meaning_fa: "غذا" } });
    await testDb.word.create({ data: { language: "de", code: "See", lemma: "See", pos: "noun", gender: "der", level: "A1", meaning_fa: "دریاچه" } });
    await skeletons("de", [["Tür", "noun"]]);
    const batch = await batchFor("words", "de");
    const answer = {
      words: [
        wordRecord({ code: "Tür", lemma: "Tür", gender: "die", plural: "Türen", meaning_fa: "در", concept_fa: "در" }),
        wordRecord({ code: "essen", lemma: "essen", pos: "verb", gender: null, plural: null, meaning_fa: "خوردن", concept_fa: "خوردن" }),
        wordRecord({ code: "see", lemma: "See", gender: "die", plural: "Seen", meaning_fa: "دریا", concept_fa: "دریا" }),
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [json(answer)], "answer")).toEqual({ state: "imported", rejected: 0 });
    const words = await testDb.word.findMany({ where: { code: { in: ["essen", "see"] } }, orderBy: { code: "asc" } });
    expect(words.map((word) => [word.code, word.dup_of_id])).toEqual([
      ["essen", null],
      ["see", null],
    ]);
  });

  it("refuses to overwrite an approved word and marks a repeated lemma for the admin", async () => {
    await testDb.word.create({
      data: { language: "fr", code: "glace-1", lemma: "glace", pos: "noun", level: "A1", meaning_fa: "بستنی", status: "approved" },
    });
    await testDb.word.create({
      data: { language: "fr", code: "chat", lemma: "chat", pos: "noun", level: "A1", meaning_fa: "گربه", status: "published" },
    });
    await skeletons("fr", [["pomme", "noun"]]);
    const batch = await batchFor("words");
    const answer = {
      words: [
        wordRecord({ code: "pomme", lemma: "pomme", meaning_fa: "سیب", concept_fa: "سیب" }),
        wordRecord({ code: "chat", lemma: "chat", gender: "m", meaning_fa: "گربه", concept_fa: "گربه" }),
        wordRecord({ code: "glace", lemma: "glace", meaning_fa: "آینه", concept_fa: "آینه", level: "A2" }),
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [json(answer)], "answer")).toEqual({ state: "imported", rejected: 1 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected[0]).toMatchObject({ label: "chat", problems: [{ key: "locked" }] });
    expect(report.duplicates).toBe(1);
    const glace = await testDb.word.findFirstOrThrow({ where: { code: "glace" } });
    const base = await testDb.word.findFirstOrThrow({ where: { code: "glace-1" } });
    expect(glace.dup_of_id).toBe(base.id);
  });
});

describe("vocabulary sentences (P-S) and the QA round", () => {
  async function vocabulary() {
    const rows: [string, string, string, boolean][] = [
      ["je", "pron", "من", true],
      ["un", "det", "یک", true],
      ["vouloir", "verb", "خواستن", false],
      ["manger", "verb", "خوردن", false],
      ["pomme", "noun", "سیب", false],
    ];
    for (const [index, [code, pos, meaning, noCard]] of rows.entries()) {
      await testDb.word.create({
        data: { language: "fr", code, lemma: code, pos: pos as "noun", level: "A1", meaning_fa: meaning, no_card: noCard, intro_order: index + 1 },
      });
    }
  }

  const tokens = [
    { surface: "Je", code: "je", meaning_fa: "من" },
    { surface: "veux", code: "vouloir", meaning_fa: "می‌خواهم" },
    { surface: "manger", code: "manger", meaning_fa: "خوردن" },
    { surface: "une", code: "un", meaning_fa: "یک" },
    { surface: "pomme", code: "pomme", meaning_fa: "سیب" },
  ];
  const target = (word: string, marked: string, accepted: string, distractors: string[]) => ({
    type: "word",
    target: word,
    marked_text: marked,
    blanks: 1,
    accepted: [accepted],
    distractors,
    hint: null,
    accepted_full: null,
  });

  it("rejects a word target whose blank is on another word, and takes a blank that holds the word with its article", async () => {
    await vocabulary();
    const batch = await batchFor("sentences");
    const sentence = (targets: unknown[]) => ({ text: "Je veux manger une pomme.", translation_fa: "می‌خواهم یک سیب بخورم.", tokens, targets });
    const answer = {
      sentences: [
        sentence([target("manger", "Je veux manger une {{pomme}}.", "pomme", ["table", "voiture", "chaise"])]),
        sentence([target("pomme", "Je veux manger {{une pomme}}.", "une pomme", ["une table", "une chaise", "un lit"])]),
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [json(answer)], "answer")).toEqual({ state: "imported", rejected: 1 });
    const report = batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(report.rejected[0].problems).toEqual([{ key: "blankNotTarget", vars: { code: "manger", field: "targets[0].marked_text" } }]);
  });

  it("maps words, flags candidates, rejects broken targets, and attaches QA findings to sentences", async () => {
    await vocabulary();
    const batch = await batchFor("sentences");
    expect(batch.prompt_text).toContain("vouloir | verb | خواستن");
    expect(batch.prompt_text).toContain("je | pron | من");

    const answer = {
      sentences: [
        {
          text: "Je veux manger une pomme.",
          tts_text: null,
          translation_fa: "می‌خواهم یک سیب بخورم.",
          tokens,
          targets: [
            target("manger", "Je veux {{manger}} une pomme.", "manger", ["boire", "dormir", "parler"]),
            target("pomme", "Je veux manger une {{pomme}}.", "pomme", ["table", "voiture", "chaise"]),
          ],
        },
        {
          text: "Je veux une orange.",
          translation_fa: "یک پرتقال می‌خواهم.",
          tokens: [tokens[0], tokens[1], tokens[3], { surface: "orange", code: "orange", meaning_fa: "پرتقال" }],
          targets: [target("vouloir", "Je {{veux}} une orange.", "veux", ["mange", "dors", "parle"])],
        },
        {
          text: "Je veux manger.",
          translation_fa: "می‌خواهم بخورم.",
          tokens: [tokens[0], tokens[2]],
          targets: [target("manger", "Je veux {{manger}}.", "manger", ["boire", "boire", "manger"])],
        },
      ],
      issues: [],
    };
    expect(await submitAnswer(batch.id, [json(answer)], "answer")).toEqual({ state: "imported", rejected: 1 });

    const stored = await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    const report = batchReport(stored)!;
    // "veux" is not plausible for vouloir until its conjugation table exists (PRD §14.1 rule 5).
    expect(report).toMatchObject({ added: 2, candidates: 1, suspects: 2 });
    expect(report.rejected[0].problems.map((problem) => problem.key)).toEqual([
      "tokenUncovered",
      "distractorsRepeat",
      "distractorAccepted",
    ]);
    expect(report.warnings.map((flag) => flag.problem.key)).toEqual(["outOfList"]);

    const first = await testDb.sentence.findFirstOrThrow({ where: { text: "Je veux manger une pomme." }, include: { words: true, targets: true } });
    expect(first.level).toBe("A1");
    expect(first.words.map((row) => [row.position, row.surface, row.word_id !== null])).toEqual([
      [0, "Je", true],
      [1, "veux", true],
      [2, "manger", true],
      [3, "une", true],
      [4, "pomme", true],
    ]);
    expect(first.targets).toHaveLength(2);
    const second = await testDb.sentence.findFirstOrThrow({ where: { text: "Je veux une orange." }, include: { words: true } });
    expect(second.words[3]).toMatchObject({ word_id: null, candidate_reason: "missing", code_given: "orange" });

    // Importing the same sentence again adds only the new target.
    const again = {
      sentences: [
        {
          ...answer.sentences[0],
          targets: [answer.sentences[0].targets[0], target("vouloir", "Je {{veux}} manger une pomme.", "veux", ["mange", "dors", "parle"])],
        },
      ],
    };
    expect(await submitAnswer(batch.id, [json(again)], "fix")).toEqual({ state: "imported", rejected: 0 });
    expect(await testDb.sentence.count()).toBe(2);
    expect(await testDb.sentenceTarget.count({ where: { sentence_id: first.id } })).toBe(3);

    const qa = qaPrompt(await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } }))!;
    expect(qa).toContain('"text": "Je veux manger une pomme."');
    expect(qa).toContain("فرانسوی");
    const findings = {
      findings: [
        { path: "sentences[1].translation_fa", severity: "HIGH", problem: "ترجمه دقیق نیست", suggestion: "..." },
        { path: "nonsense", severity: "low", problem: "?", suggestion: null },
        { path: "sentences[0].text", severity: "critical", problem: "جمله طبیعی نیست" },
        { path: "sentences[0].tokens", severity: "شاید", problem: "یک نگاشت مشکوک است" },
        { path: "sentences[0]", severity: "low", note: "بدون متن مشکل" },
      ],
    };
    expect(await submitQa(batch.id, [json(findings)], 1)).toEqual({ state: "imported", rejected: 0 });
    const done = await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(done.state).toBe("qa_done");
    expect(batchFindings(done)).toEqual([
      expect.objectContaining({ severity: "high", label: "Je veux une orange.", entity: { type: "sentence", id: second.id } }),
      expect.objectContaining({ severity: "low", entity: null }),
      // Other words for a severity are read as the prompt's three; an unknown one is not made "low".
      expect.objectContaining({ severity: "high", entity: { type: "sentence", id: first.id } }),
      expect.objectContaining({ severity: "medium", entity: { type: "sentence", id: first.id } }),
      // A finding that cannot be read is kept as written.
      expect.objectContaining({ severity: "medium", entity: null, problem: expect.stringContaining("بدون متن مشکل") }),
    ]);
    const logged = await testDb.adminLog.findMany({ where: { entity: "import_batch", entity_id: String(batch.id) }, orderBy: { id: "asc" } });
    expect(logged.map((row) => [row.action, row.after])).toEqual([
      ["batch", expect.objectContaining({ kind: "P_S", round: 1, added: 2, rejected: 1 })],
      ["batch", expect.objectContaining({ round: 2, skipped: 1 })],
      // Both sentences go to «بازبینی»: A1 is reviewed in full, and a finding the panel could not place leaves no sample.
      ["qa", { kind: "P_S", language: "fr", findings: 5, high: 2, review: 2, unseen: 0 }],
    ]);
    expect(await testDb.sentence.count({ where: { status: "needs_review" } })).toBe(2);
  });

  it("picks the next words that need sentences, lowest level and earliest order first", async () => {
    await vocabulary();
    const batch = await batchFor("sentences");
    const params = batch.params as { word_ids: number[] };
    const codes = await testDb.word.findMany({ where: { id: { in: params.word_ids } }, select: { code: true } });
    expect(codes.map((word) => word.code).sort()).toEqual(["manger", "pomme", "vouloir"]);
  });

  it("asks for no more sentences than one quality check reads", async () => {
    await vocabulary();
    // 8 sentences a word and a check of at most 20 sentences: two words a batch.
    await testDb.appSetting.create({ data: { key: "batch.sizes", value: { "P-S": 10, "P-QA": 20 } } });
    const batch = await batchFor("sentences");
    expect((batch.params as { word_ids: number[] }).word_ids).toHaveLength(2);
  });
});

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  batchFindings,
  batchReport,
  createBatch,
  fixPrompt,
  qaPrompt,
  submitAnswer,
  submitQa,
} from "@/server/content/batches";
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
    expect(report.warnings.map((flag) => flag.problem.key)).toEqual(["notReturned", "notReturned", "notReturned"]);
    expect(await testDb.word.count({ where: { meaning_fa: { not: null } } })).toBe(0);
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
      ],
    };
    expect(await submitQa(batch.id, [json(findings)])).toEqual({ state: "imported", rejected: 0 });
    const done = await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(done.state).toBe("qa_done");
    expect(batchFindings(done)).toEqual([
      expect.objectContaining({ severity: "high", label: "Je veux une orange.", entity: { type: "sentence", id: second.id } }),
      expect.objectContaining({ severity: "low", entity: null }),
    ]);
  });

  it("picks the next words that need sentences, lowest level and earliest order first", async () => {
    await vocabulary();
    const batch = await batchFor("sentences");
    const params = batch.params as { word_ids: number[] };
    const codes = await testDb.word.findMany({ where: { id: { in: params.word_ids } }, select: { code: true } });
    expect(codes.map((word) => word.code).sort()).toEqual(["manger", "pomme", "vouloir"]);
  });
});

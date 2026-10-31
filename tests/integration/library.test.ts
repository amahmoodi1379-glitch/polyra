import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { batchReport, createBatch, submitAnswer } from "@/server/content/batches";
import { deleteItem } from "@/server/content/library/delete";
import { tableEditor } from "@/server/content/library/edit/tables";
import { textEditor } from "@/server/content/library/edit/texts";
import { unitEditor } from "@/server/content/library/edit/units";
import { wordEditor } from "@/server/content/library/edit/words";
import { listLog } from "@/server/content/library/history";
import { revertChange } from "@/server/content/library/revert";
import { changeStatus } from "@/server/content/library/status";
import { orderState, saveOrder } from "@/server/content/order";
import { overrideForNewText } from "@/server/content/text-difficulty";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const ADMIN = 1;

async function word(code: string, extra: Record<string, unknown> = {}) {
  return testDb.word.create({
    data: { language: "fr", code, lemma: code, pos: "noun", gender: "m", level: "A1", meaning_fa: "معنی", ...extra },
  });
}

const lastLog = () => testDb.adminLog.findFirstOrThrow({ orderBy: { id: "desc" } });

/** The French P-T example imported as a draft text with its eight questions (as in texts.test.ts). */
async function importedText() {
  const codes = [
    "bonjour",
    "madame",
    "je",
    "vouloir",
    "un",
    "café",
    "s'il vous plaît",
    "petit",
    "non",
    "grand",
    "avec",
    "du",
    "lait",
    "d'accord",
    "ce",
    "être",
    "euro",
    "voilà",
    "merci",
    "au revoir",
    "bon",
    "journée",
  ];
  await testDb.word.createMany({
    data: Array.from({ length: 45 }, (_, index) => {
      const code = index < codes.length ? codes[index] : `a1-mot-${index}`;
      return { language: "fr", code, lemma: code, pos: "noun" as const, level: "A1", meaning_fa: "معنی", intro_order: index + 1 };
    }),
  });
  await testDb.grammarUnit.create({ data: { language: "fr", unit_code: "fr-a1-present", title_fa: "زمان حال", level: "A1", order_no: 1 } });
  const made = await createBatch({ slug: "texts", language: "fr", adminId: ADMIN, options: {} });
  if (!("id" in made)) throw new Error(made.nothing);
  const example = JSON.parse(readFileSync(join(process.cwd(), "prompts/v1/examples/P-T.fr.json"), "utf8"));
  const result = await submitAnswer(made.id, [`\`\`\`json\n${JSON.stringify(example)}\n\`\`\``], "answer");
  if (result.state !== "imported") throw new Error(JSON.stringify(await batchReport(await testDb.importBatch.findUniqueOrThrow({ where: { id: made.id } }))));
  return testDb.text.findFirstOrThrow({ include: { questions: { orderBy: [{ track: "asc" }, { set: "asc" }, { order_no: "asc" }] } } });
}

describe("status changes in the library (PRD §13.2, §13.7)", () => {
  it("sends drafts to review, refuses a word list skeleton and a published item, and logs each change", async () => {
    const draft = await word("pain");
    const skeleton = await word("eau", { meaning_fa: null });
    const published = await word("lait", { status: "published" });

    const result = await changeStatus("words", "fr", [draft.id, skeleton.id, published.id], "review", ADMIN);
    expect(result).toEqual({
      changed: 1,
      unchanged: 0,
      refused: [
        { id: skeleton.id, reason: "skeleton" },
        { id: published.id, reason: "published" },
      ],
    });
    expect((await testDb.word.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("needs_review");
    expect(await lastLog()).toEqual(
      expect.objectContaining({ action: "status", entity: "word", entity_id: String(draft.id), before: { status: "draft" }, after: { status: "needs_review" } }),
    );
    expect(await changeStatus("words", "fr", [published.id], "suspend", ADMIN)).toEqual({ changed: 1, unchanged: 0, refused: [] });
    expect((await testDb.word.findUniqueOrThrow({ where: { id: published.id } })).suspended).toBe(true);
  });

  it("retires a text with its questions, and «برگردان» brings both back", async () => {
    const text = await importedText();
    expect(await changeStatus("texts", "fr", [text.id], "retire", ADMIN)).toEqual({ changed: 1, unchanged: 0, refused: [] });
    expect(await testDb.question.count({ where: { text_id: text.id, status: "retired" } })).toBe(8);

    const retired = await lastLog();
    expect(await revertChange(retired.id, ADMIN)).toEqual({ state: "reverted", notes: [] });
    expect((await testDb.text.findUniqueOrThrow({ where: { id: text.id } })).status).toBe("draft");
    expect(await testDb.question.count({ where: { text_id: text.id, status: "draft" } })).toBe(8);
    expect(await lastLog()).toEqual(expect.objectContaining({ action: "revert", entity: "text", before: retired.after, after: retired.before }));
  });
});

describe("deleting a draft (PRD §13.7)", () => {
  it("deletes only an unused draft, logs what it was, and cannot be put back", async () => {
    const pain = await word("pain");
    const approved = await word("eau", { status: "approved" });
    const part = await word("bon");
    await word("bon appétit", { pos: "phrase", parts: ["bon"] });

    expect(await deleteItem("words", approved.id, ADMIN)).toEqual({ state: "notDraft" });
    expect(await deleteItem("words", part.id, ADMIN)).toEqual({ state: "inUse" });
    expect(await deleteItem("words", pain.id, ADMIN)).toEqual({ state: "deleted" });
    expect(await testDb.word.findUnique({ where: { id: pain.id } })).toBeNull();

    const row = await lastLog();
    expect(row).toEqual(expect.objectContaining({ action: "delete", entity: "word", entity_id: String(pain.id), after: null }));
    expect(row.before).toEqual(expect.objectContaining({ code: "pain", meaning_fa: "معنی" }));
    expect(await revertChange(row.id, ADMIN)).toEqual({ state: "blocked", reason: "final" });
  });

  it("keeps a draft word that a short translation or a find-the-mistake text names in its word rows", async () => {
    const chat = await word("chat");
    const chien = await word("chien");
    const unit = await testDb.grammarUnit.create({ data: { language: "fr", unit_code: "fr-a1-x", title_fa: "واحد", level: "A1" } });
    await testDb.translateItem.create({
      data: { language: "fr", grammar_unit_id: unit.id, prompt_fa: "گربه.", accepted_outputs: ["Le chat."], tokens: [{ surface: "chat", kind: "word", word_id: chat.id }] },
    });
    await testDb.errorfixItem.create({
      data: { language: "fr", level: "A1", marked_text: "Le {{chiens}}.", translation_fa: "سگ.", errors: [], tokens: [{ surface: "chien", kind: "word", word_id: chien.id }] },
    });
    expect(await deleteItem("words", chat.id, ADMIN)).toEqual({ state: "inUse" });
    expect(await deleteItem("words", chien.id, ADMIN)).toEqual({ state: "inUse" });
  });
});

describe("editing and «برگردان» (PRD §13.2)", () => {
  it("puts back an edit, refuses an older one, and can put back the revert itself", async () => {
    const pain = await word("pain", { concept_id: null });
    const loaded = (await wordEditor.load(pain.id))!;
    const saved = await wordEditor.save(pain.id, { ...loaded.values, meaning_fa: "نان", concept_fa: "نان", note_fa: "نان فرانسوی" }, ADMIN);
    expect(saved).toEqual(expect.objectContaining({ state: "saved" }));
    const edit = await lastLog();
    expect(edit.before).toEqual(expect.objectContaining({ meaning_fa: "معنی", note_fa: null }));
    expect(edit.after).toEqual(expect.objectContaining({ meaning_fa: "نان", note_fa: "نان فرانسوی" }));

    expect(await revertChange(edit.id, ADMIN)).toEqual({ state: "reverted", notes: [] });
    expect(await testDb.word.findUniqueOrThrow({ where: { id: pain.id } })).toEqual(expect.objectContaining({ meaning_fa: "معنی", note_fa: null }));
    const revert = await lastLog();
    expect(revert).toEqual(expect.objectContaining({ action: "revert", before: edit.after, after: edit.before }));

    // The edit is no longer the word's latest change.
    expect(await revertChange(edit.id, ADMIN)).toEqual({ state: "blocked", reason: "later" });
    const page = await listLog(null, 1);
    expect(page.items.map((item) => [item.id, item.revert])).toEqual([
      [revert.id, "ready"],
      [edit.id, "later"],
    ]);

    // Reverting the revert applies the edit again.
    expect(await revertChange(revert.id, ADMIN)).toEqual({ state: "reverted", notes: [] });
    expect((await testDb.word.findUniqueOrThrow({ where: { id: pain.id } })).meaning_fa).toBe("نان");
  });

  it("saves an edit with the Persian ی and ک and without invisible marks", async () => {
    const pain = await word("pain", { concept_id: null });
    const loaded = (await wordEditor.load(pain.id))!;
    await wordEditor.save(pain.id, { ...loaded.values, meaning_fa: "\u200Fنان كوچك", concept_fa: "نان", note_fa: "يك\u00A0نان" }, ADMIN);
    expect(await testDb.word.findUniqueOrThrow({ where: { id: pain.id } })).toEqual(expect.objectContaining({ meaning_fa: "نان کوچک", note_fa: "یک نان" }));
  });

  it("moves a sentence to the level of its highest word when a word changes level, and back on «برگردان»", async () => {
    const pain = await word("pain", { concept_id: null });
    const sentence = await testDb.sentence.create({
      data: {
        language: "fr",
        text: "Le pain.",
        translation_fa: "نان.",
        text_hash: "le-pain",
        level: "A1",
        words: { create: [{ position: 0, kind: "word", word_id: pain.id, surface: "pain", spans: [[3, 7]] }] },
      },
    });
    const loaded = (await wordEditor.load(pain.id))!;
    await wordEditor.save(pain.id, { ...loaded.values, concept_fa: "نان", level: "A2" }, ADMIN);
    expect((await testDb.sentence.findUniqueOrThrow({ where: { id: sentence.id } })).level).toBe("A2");
    expect(await revertChange((await lastLog()).id, ADMIN)).toMatchObject({ state: "reverted" });
    expect((await testDb.sentence.findUniqueOrThrow({ where: { id: sentence.id } })).level).toBe("A1");
  });

  it("refuses when the item changed without a log row, and writes JSON back as it was", async () => {
    const etre = await word("être", { pos: "verb", gender: null });
    await testDb.grammarUnit.create({ data: { language: "fr", unit_code: "fr-a1-etre", title_fa: "فعل être", level: "A1", order_no: 1 } });
    const table = await testDb.conjugationTable.create({
      data: {
        language: "fr",
        word_id: etre.id,
        tense: "present",
        unit_code: "fr-a1-etre",
        forms: { je: "suis", tu: "es", il_elle_on: "est", nous: "sommes", vous: "êtes", ils_elles: "sont" },
      },
    });
    const loaded = (await tableEditor.load(table.id))!;
    const forms = { ...loaded.values.forms, il_elle_on: "estx" };
    expect(await tableEditor.save(table.id, { ...loaded.values, forms }, ADMIN)).toEqual(expect.objectContaining({ state: "saved" }));
    const edit = await lastLog();
    expect(edit.after).toEqual({ forms: expect.objectContaining({ il_elle_on: "estx" }) });

    await testDb.conjugationTable.update({ where: { id: table.id }, data: { forms: { ...forms, il_elle_on: "est2" } } });
    expect(await revertChange(edit.id, ADMIN)).toEqual({ state: "blocked", reason: "changed" });
    await testDb.conjugationTable.update({ where: { id: table.id }, data: { forms } });
    expect(await revertChange(edit.id, ADMIN)).toEqual({ state: "reverted", notes: [] });
    expect(((await testDb.conjugationTable.findUniqueOrThrow({ where: { id: table.id } })).forms as Record<string, string>).il_elle_on).toBe("est");
  });

  it("brings a text's questions back and removes an added one; a published text stays up with its file", async () => {
    const text = await importedText();
    const loaded = (await textEditor.load(text.id))!;
    const sets = structuredClone(loaded.values.question_sets);
    const first = sets.reading.A[0];
    sets.reading.A[0] = { ...first, prompt: "خانم چه می‌خواهد؟" } as typeof first;
    sets.reading.A.push({ ...first, id: null });
    expect((await textEditor.save(text.id, { ...loaded.values, question_sets: sets }, ADMIN)).state).toBe("saved");
    expect(await testDb.question.count({ where: { text_id: text.id } })).toBe(9);

    expect(await revertChange((await lastLog()).id, ADMIN)).toEqual({ state: "reverted", notes: [] });
    const questions = await testDb.question.findMany({ where: { text_id: text.id }, orderBy: { id: "asc" } });
    expect(questions).toHaveLength(8);
    expect((questions.find((question) => question.id === text.questions[0].id)!.payload as { prompt: string }).prompt).toBe("خانم چه قهوه‌ای می‌خواهد؟");

    // Published with a file: changing a question neither takes the text down nor makes its file stale.
    const file = await testDb.audioAsset.create({ data: { kind: "text", url: "test://text.mp3", source: "human", duration_ms: 9000 } });
    await testDb.text.update({ where: { id: text.id }, data: { status: "published", human_audio_id: file.id, human_sentence_offsets_ms: [0, 4000] } });
    const again = (await textEditor.load(text.id))!;
    const changed = structuredClone(again.values.question_sets);
    changed.reading.A[0] = { ...changed.reading.A[0], prompt: "خانم چه می‌خواهد؟" } as (typeof changed.reading.A)[0];
    expect((await textEditor.save(text.id, { ...again.values, question_sets: changed }, ADMIN)).state).toBe("saved");
    expect((await testDb.text.findUniqueOrThrow({ where: { id: text.id } })).suspended).toBe(false);
    expect(await revertChange((await lastLog()).id, ADMIN)).toEqual({ state: "reverted", notes: [] });
    expect((await testDb.text.findUniqueOrThrow({ where: { id: text.id } })).suspended).toBe(false);
    expect((await testDb.audioAsset.findUniqueOrThrow({ where: { id: file.id } })).stale).toBe(false);
  });
});

describe("fields the import fills and the form can change (PRD §5.1, §6, §7.1)", () => {
  const errorPaths = (result: { state: string; errors?: { path: string }[] }) => (result.state === "invalid" ? result.errors!.map((error) => error.path) : result.state);

  it("makes a word a new sense of one with the same lemma, after it in the order; refuses a loop or a lemma apart", async () => {
    await word("bon", { intro_order: 1 });
    const sense = await word("glace-2", { lemma: "glace", meaning_fa: "آینه", level: "A1", intro_order: 2 });
    const base = await word("glace", { gender: "f", meaning_fa: "بستنی", intro_order: 3 });
    const loaded = (await wordEditor.load(sense.id))!;
    expect(loaded.context.senses).toEqual([{ code: "glace", meaning_fa: "بستنی", level: "A1" }]);
    const values = { ...loaded.values, concept_fa: "آینه" };

    expect(errorPaths(await wordEditor.save(sense.id, { ...values, sense_of: "bon" }, ADMIN))).toEqual(["sense_of"]);
    expect((await wordEditor.save(sense.id, { ...values, sense_of: "glace" }, ADMIN)).state).toBe("saved");
    const order = async () => (await testDb.word.findMany({ orderBy: { intro_order: "asc" }, select: { code: true } })).map((row) => row.code);
    expect(await order()).toEqual(["bon", "glace", "glace-2"]);

    // The base cannot become a sense of its own sense, nor take a lemma its sense does not have.
    const baseValues = { ...(await wordEditor.load(base.id))!.values, concept_fa: "بستنی" };
    expect(errorPaths(await wordEditor.save(base.id, { ...baseValues, sense_of: "glace-2" }, ADMIN))).toEqual(["sense_of"]);
    expect(errorPaths(await wordEditor.save(base.id, { ...baseValues, lemma: "glacé" }, ADMIN))).toEqual(["lemma"]);

    expect(await revertChange((await lastLog()).id, ADMIN)).toMatchObject({ state: "reverted" });
    expect((await testDb.word.findUniqueOrThrow({ where: { id: sense.id } })).sense_of).toBeNull();
  });

  it("puts a unit's examples in order, takes one out and adds one of its own practice sentences only", async () => {
    const unit = await testDb.grammarUnit.create({ data: { language: "fr", unit_code: "fr-a1-etre", title_fa: "فعل être", level: "A1" } });
    const ids: number[] = [];
    for (const text of ["Je suis là.", "Tu es là.", "Il est là.", "Nous sommes là.", "Vous êtes là.", "Ils sont là.", "Elles sont là."]) {
      ids.push((await testDb.sentence.create({ data: { language: "fr", text, translation_fa: "این‌جا.", text_hash: text, level: "A1" } })).id);
    }
    const [s1, s2, s3, s4, s5, s6, other] = ids;
    await testDb.grammarUnit.update({ where: { id: unit.id }, data: { example_sentence_ids: [s1, s2, s3] } });
    for (const sentenceId of [s4, s5, s6]) {
      await testDb.sentenceTarget.create({
        data: { language: "fr", sentence_id: sentenceId, target_type: "grammar", target_id: unit.id, marked_text: "x", accepted: [], distractors: [] },
      });
    }
    const loaded = (await unitEditor.load(unit.id))!;
    expect(loaded.values.example_sentence_ids).toEqual([s1, s2, s3]);
    expect(loaded.context.practice).toEqual([s4, s5, s6]);

    expect((await unitEditor.save(unit.id, { ...loaded.values, example_sentence_ids: [s3, s1, s4] }, ADMIN)).state).toBe("saved");
    expect((await testDb.grammarUnit.findUniqueOrThrow({ where: { id: unit.id } })).example_sentence_ids).toEqual([s3, s1, s4]);
    // The sentence taken out stays in the bank, so «برگردان» can bring it back.
    expect(await testDb.sentence.count({ where: { id: s2 } })).toBe(1);
    expect(errorPaths(await unitEditor.save(unit.id, { ...loaded.values, example_sentence_ids: [s3, s1, other] }, ADMIN))).toEqual(["example_sentence_ids"]);
    expect(errorPaths(await unitEditor.save(unit.id, { ...loaded.values, example_sentence_ids: [s3, s1, s4, s5, s6] }, ADMIN))).toEqual(["example_sentence_ids"]);

    // A published unit keeps at least three.
    await testDb.grammarUnit.update({ where: { id: unit.id }, data: { status: "published" } });
    expect(errorPaths(await unitEditor.save(unit.id, { ...loaded.values, example_sentence_ids: [s3, s1] }, ADMIN))).toEqual(["example_sentence_ids"]);

    await testDb.grammarUnit.update({ where: { id: unit.id }, data: { status: "draft" } });
    expect(await revertChange((await lastLog()).id, ADMIN)).toMatchObject({ state: "reverted" });
    expect((await testDb.grammarUnit.findUniqueOrThrow({ where: { id: unit.id } })).example_sentence_ids).toEqual([s1, s2, s3]);
  });

  it("moves a text to another level of its band only, and puts it back", async () => {
    const text = await importedText();
    const loaded = (await textEditor.load(text.id))!;
    expect(loaded.context.levels).toEqual(["A1", "A2"]);
    expect(errorPaths(await textEditor.save(text.id, { ...loaded.values, level: "B1" }, ADMIN))).toEqual(["level"]);
    expect((await textEditor.save(text.id, { ...loaded.values, level: "A2" }, ADMIN)).state).toBe("saved");
    expect(await testDb.text.findUniqueOrThrow({ where: { id: text.id } })).toMatchObject({ level: "A2", code: text.code, order_override: null });
    expect(await revertChange((await lastLog()).id, ADMIN)).toMatchObject({ state: "reverted" });
    expect((await testDb.text.findUniqueOrThrow({ where: { id: text.id } })).level).toBe("A1");
  });
});

describe("order (PRD §13.2 «ترتیب», §5.8)", () => {
  it("saves a word order with phrases after their parts, refuses a stale or broken one, and puts it back", async () => {
    const bon = await word("bon", { intro_order: 1 });
    const jour = await word("jour", { intro_order: 2 });
    const phrase = await word("bonjour", { pos: "phrase", gender: null, parts: ["bon", "jour"], intro_order: 3 });
    const pain = await word("pain", { intro_order: 4 });
    const eau = await word("eau", { intro_order: 5 });
    const base = [bon.id, jour.id, phrase.id, pain.id, eau.id];
    expect((await orderState(testDb, "words", "fr", "A1")).order).toEqual(base);

    expect(await saveOrder("words", "fr", "A1", [jour.id, bon.id, phrase.id, pain.id, eau.id], { order: base }, ADMIN)).toEqual({ state: "stale" });
    expect(await saveOrder("words", "fr", "A1", base, { order: [bon.id, jour.id, pain.id] }, ADMIN)).toEqual({ state: "invalid" });
    expect(await saveOrder("words", "fr", "A1", base, { order: base }, ADMIN)).toEqual({ state: "saved", changed: false });
    // A phrase dragged before its parts goes back after them: nothing to save.
    expect(await saveOrder("words", "fr", "A1", base, { order: [phrase.id, bon.id, jour.id, pain.id, eau.id] }, ADMIN)).toEqual({ state: "saved", changed: false });

    // «jour» goes to the end and the phrase follows it there.
    expect(await saveOrder("words", "fr", "A1", base, { order: [bon.id, phrase.id, pain.id, eau.id, jour.id] }, ADMIN)).toEqual({ state: "saved", changed: true });
    const after = [bon.id, pain.id, eau.id, jour.id, phrase.id];
    expect((await orderState(testDb, "words", "fr", "A1")).order).toEqual(after);
    expect((await testDb.word.findMany({ orderBy: { intro_order: "asc" }, select: { code: true, intro_order: true } })).map((row) => `${row.intro_order} ${row.code}`)).toEqual([
      "1 bon",
      "2 pain",
      "3 eau",
      "4 jour",
      "5 bonjour",
    ]);
    const row = await lastLog();
    expect(row).toEqual(expect.objectContaining({ action: "order", entity: "word", entity_id: "fr:A1", before: { order: base }, after: { order: after } }));

    expect(await revertChange(row.id, ADMIN)).toEqual({ state: "reverted", notes: [] });
    expect((await orderState(testDb, "words", "fr", "A1")).order).toEqual(base);
  });

  it("arranges texts by hand, adds new texts at the end, and goes back to difficulty order", async () => {
    const make = (code: string, difficulty_score: number) =>
      testDb.text.create({ data: { language: "fr", code, level: "A1", band: 1, kind: "dialogue", title: code, difficulty_score } });
    const easy = await make("t1", 0.2);
    const hard = await make("t2", 0.8);
    expect(await orderState(testDb, "texts", "fr", "A1")).toEqual({ order: [easy.id, hard.id], manual: false });
    expect(await overrideForNewText(testDb, "fr", "A1")).toBeNull();

    expect(await saveOrder("texts", "fr", "A1", [easy.id, hard.id], { order: [hard.id, easy.id] }, ADMIN)).toEqual({ state: "saved", changed: true });
    expect(await orderState(testDb, "texts", "fr", "A1")).toEqual({ order: [hard.id, easy.id], manual: true });
    expect(await overrideForNewText(testDb, "fr", "A1")).toBe(3);

    expect(await saveOrder("texts", "fr", "A1", [hard.id, easy.id], { order: [hard.id, easy.id], manual: false }, ADMIN)).toEqual({ state: "saved", changed: true });
    expect(await orderState(testDb, "texts", "fr", "A1")).toEqual({ order: [easy.id, hard.id], manual: false });
    expect(await testDb.text.count({ where: { order_override: { not: null } } })).toBe(0);
  });
});

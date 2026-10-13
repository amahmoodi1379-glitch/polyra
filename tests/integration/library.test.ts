import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { batchReport, createBatch, submitAnswer } from "@/server/content/batches";
import { deleteItem } from "@/server/content/library/delete";
import { tableEditor } from "@/server/content/library/edit/tables";
import { textEditor } from "@/server/content/library/edit/texts";
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
  it("approves drafts, refuses a word list skeleton and a published item, and logs each change", async () => {
    const draft = await word("pain");
    const skeleton = await word("eau", { meaning_fa: null });
    const published = await word("lait", { status: "published" });

    const result = await changeStatus("words", "fr", [draft.id, skeleton.id, published.id], "approve", ADMIN);
    expect(result).toEqual({
      changed: 1,
      unchanged: 0,
      refused: [
        { id: skeleton.id, reason: "skeleton" },
        { id: published.id, reason: "published" },
      ],
    });
    expect((await testDb.word.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe("approved");
    expect(await lastLog()).toEqual(
      expect.objectContaining({ action: "status", entity: "word", entity_id: String(draft.id), before: { status: "draft" }, after: { status: "approved" } }),
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

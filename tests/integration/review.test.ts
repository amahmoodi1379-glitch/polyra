import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { decideReview } from "@/server/content/review/decide";
import { findingMark, findingsOf } from "@/server/content/review/findings";
import { reviewQueue } from "@/server/content/review/list";
import { previewItem } from "@/server/content/review/preview";
import { sendToReview } from "@/server/content/review/queue";
import type { AcceptedRecord, EntityRef, ImportReport } from "@/server/content/report";
import { emptyRound } from "@/server/content/report";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(async () => {
  await testDb.$disconnect();
  await db.$disconnect();
});

const ADMIN = 1;

async function word(code: string, extra: Record<string, unknown> = {}) {
  return testDb.word.create({ data: { language: "fr", code, lemma: code, pos: "noun", gender: "m", level: "A1", meaning_fa: `معنی ${code}`, ...extra } });
}

/** A sentence made of these words; with `target`, it practises the first one (or a unit). */
async function sentence(text: string, wordIds: number[], extra: Record<string, unknown> = {}, target: { type: "word" | "grammar"; id: number } | null = null) {
  const row = await testDb.sentence.create({
    data: {
      language: "fr",
      text,
      translation_fa: `ترجمه ${text}`,
      text_hash: text,
      level: "A1",
      words: { create: wordIds.map((word_id, position) => ({ word_id, surface: text.split(" ")[position] ?? "x", spans: [], position })) },
      ...extra,
    },
  });
  const aim = target ?? (wordIds[0] ? { type: "word" as const, id: wordIds[0] } : null);
  if (aim) {
    const first = text.split(" ")[0];
    await testDb.sentenceTarget.create({
      data: {
        language: "fr",
        sentence_id: row.id,
        target_type: aim.type,
        target_id: aim.id,
        marked_text: text.replace(first, `{{${first}}}`),
        accepted: [first],
        distractors: ["un", "une", "des"],
      },
    });
  }
  return row;
}

async function batchOf(entities: EntityRef[], extra: Partial<ImportReport> = {}) {
  const report: ImportReport = {
    ...emptyRound(),
    accepted: entities.map((entity): AcceptedRecord => ({ label: `${entity.type} ${entity.id}`, entity, record: {} })),
    rounds: 1,
    issues: [],
    ...extra,
  };
  const row = await testDb.importBatch.create({
    data: { language: "fr", prompt_kind: "P_S", prompt_version: "v1", prompt_text: "", state: "imported", report: report as unknown as Prisma.InputJsonValue },
  });
  return { id: row.id, language: "fr", report };
}

const statusOf = async (id: number) => (await testDb.sentence.findUniqueOrThrow({ where: { id } })).status;

describe("sending a batch to review (PRD §13.4, §13.9)", () => {
  it("reviews every word and grammar sentence, and from B1 the flagged vocabulary sentences and a fifth of the rest", async () => {
    const pomme = await word("pomme");
    const skeleton = await word("eau", { meaning_fa: null });
    const unit = await testDb.grammarUnit.create({ data: { language: "fr", unit_code: "fr-b1-subj", title_fa: "حالت التزامی", level: "B1", lesson_fa: "درس" } });
    const low = [await sentence("pomme rouge.", [pomme.id]), await sentence("pomme verte.", [pomme.id])];
    const high: { id: number }[] = [];
    for (let i = 0; i < 10; i++) high.push(await sentence(`pomme ${i}.`, [pomme.id], { level: "B1" }));
    const grammar = await sentence("pomme subj.", [pomme.id], { level: "B1" }, { type: "grammar", id: unit.id });
    const open = await sentence("pomme orange.", [pomme.id], { level: "B1" });
    await testDb.sentenceWord.create({ data: { sentence_id: open.id, word_id: null, surface: "orange", spans: [], position: 1, candidate_reason: "missing" } });
    const all: EntityRef[] = [pomme, skeleton].map((row) => ({ type: "word", id: row.id }));
    all.push(...[...low, ...high, grammar, open].map((row) => ({ type: "sentence" as const, id: row.id })));
    // One QA finding and one import warning point at two of the B1 sentences.
    const batch = await batchOf(all, { warnings: [{ label: "x", problem: { key: "tooLong" }, entity: { type: "sentence", id: high[1].id } }] });

    const sent = await db.$transaction((tx) => sendToReview(tx, batch, [{ type: "sentence", id: high[0].id }], ADMIN));

    // 1 word, 2 A1, the grammar one, the open one, 2 flagged and ceil(20% of the other 8) = 2.
    expect(sent).toEqual({ review: 9, unseen: 6 });
    expect((await testDb.word.findUniqueOrThrow({ where: { id: pomme.id } })).status).toBe("needs_review");
    expect((await testDb.word.findUniqueOrThrow({ where: { id: skeleton.id } })).status).toBe("draft");
    for (const row of [...low, grammar, open, high[0], high[1]]) expect(await statusOf(row.id)).toBe("needs_review");
    const rest = await Promise.all(high.slice(2).map((row) => statusOf(row.id)));
    expect(rest.filter((status) => status === "needs_review")).toHaveLength(2);
    expect(rest.filter((status) => status === "approved")).toHaveLength(6);

    // Each sentence approved unseen says so in the change log; nobody saw it.
    const logged = await testDb.adminLog.findMany({ where: { action: "review" } });
    expect(logged).toHaveLength(6);
    expect(logged[0]).toMatchObject({ entity: "sentence", before: { status: "draft" }, after: { status: "approved", unseen: true } });
  });

  it("reviews every sentence when a finding could not be placed", async () => {
    const pomme = await word("pomme");
    const rows = [];
    for (let i = 0; i < 5; i++) rows.push(await sentence(`pomme ${i}.`, [pomme.id], { level: "B1" }));
    const batch = await batchOf(rows.map((row) => ({ type: "sentence", id: row.id })));
    expect(await db.$transaction((tx) => sendToReview(tx, batch, [null], ADMIN))).toEqual({ review: 5, unseen: 0 });
  });
});

describe("deciding on review (PRD §13.9 step 4)", () => {
  it("approves with the reviewer in the log, keeps the B1 «نوشتنی / شناختنی» choice and closes the batches it finished", async () => {
    const mot = await word("néanmoins", { level: "B1", pos: "adv", gender: null, mastery: "produce", mastery_suggested: "recognize", status: "needs_review" });
    const other = await word("pourtant", { level: "B1", status: "needs_review" });
    const batch = await batchOf([{ type: "word", id: mot.id }]);
    // A second batch that also took the word still has another item waiting.
    const shared = await batchOf([{ type: "word", id: mot.id }, { type: "word", id: other.id }]);
    await testDb.importBatch.updateMany({ data: { state: "qa_done" } });

    expect(await decideReview("words", "fr", mot.id, "approve", ADMIN, { mastery: "recognize" })).toEqual({ state: "done" });
    expect(await testDb.word.findUniqueOrThrow({ where: { id: mot.id } })).toMatchObject({ status: "approved", mastery: "recognize", mastery_manual: true });
    const logged = await testDb.adminLog.findMany({ orderBy: { id: "asc" } });
    expect(logged.map((row) => [row.action, row.admin_id, row.after])).toEqual([
      ["edit", ADMIN, { mastery: "recognize", mastery_manual: true }],
      ["review", ADMIN, { status: "approved" }],
    ]);
    expect((await testDb.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).state).toBe("reviewed");
    expect((await testDb.importBatch.findUniqueOrThrow({ where: { id: shared.id } })).state).toBe("qa_done");
    // Decided already: a second click finds nothing to do.
    expect(await decideReview("words", "fr", mot.id, "reject", ADMIN)).toEqual({ state: "gone" });
  });

  it("rejects with the item's targets, and holds approval while «حل کردن» has a question", async () => {
    const pomme = await word("pomme", { status: "approved" });
    const twin = await word("pomme-2", { lemma: "pomme", dup_of_id: pomme.id, status: "needs_review" });
    const bad = await sentence("pomme pourrie.", [pomme.id], { status: "needs_review" });
    const open = await sentence("pomme orange.", [pomme.id], { status: "needs_review" });
    await testDb.sentenceWord.create({ data: { sentence_id: open.id, word_id: null, surface: "orange", spans: [], position: 1, candidate_reason: "missing" } });
    const draft = await sentence("pomme crue.", [pomme.id]);

    expect(await decideReview("sentences", "fr", bad.id, "reject", ADMIN)).toEqual({ state: "done" });
    expect(await statusOf(bad.id)).toBe("retired");
    expect(await testDb.sentenceTarget.count({ where: { sentence_id: bad.id, status: "retired" } })).toBe(1);
    expect(await testDb.adminLog.findFirstOrThrow({ where: { entity: "sentence", entity_id: String(bad.id) } })).toMatchObject({ action: "review", admin_id: ADMIN });

    expect(await decideReview("words", "fr", twin.id, "approve", ADMIN)).toEqual({ state: "blocked", blockers: ["duplicate"] });
    expect(await decideReview("sentences", "fr", open.id, "approve", ADMIN)).toEqual({ state: "blocked", blockers: ["openRows"] });
    // A draft is not on «بازبینی» yet.
    expect(await decideReview("sentences", "fr", draft.id, "approve", ADMIN)).toEqual({ state: "gone" });
  });
});

describe("the review queue and what it shows", () => {
  it("lists a batch's items waiting for review: words first, B1 words to check for mastery first, then by level", async () => {
    const plain = await word("maison", { level: "B1", status: "needs_review" });
    const differs = await word("pourtant", { level: "B1", mastery: "produce", mastery_suggested: "recognize", status: "needs_review" });
    const easy = await word("chat", { level: "A1", status: "needs_review" });
    const done = await word("chien", { status: "approved" });
    const line = await sentence("chat noir.", [easy.id], { status: "needs_review" });
    const batch = await batchOf([...[plain, differs, easy, done].map((row): EntityRef => ({ type: "word", id: row.id })), { type: "sentence", id: line.id }]);

    expect(await reviewQueue("fr", { batch: batch.id, slug: null })).toEqual([
      { slug: "words", id: easy.id },
      { slug: "words", id: differs.id },
      { slug: "words", id: plain.id },
      { slug: "sentences", id: line.id },
    ]);
    expect(await reviewQueue("fr", { batch: null, slug: "sentences" })).toEqual([{ slug: "sentences", id: line.id }]);
    expect(await reviewQueue("de", { batch: batch.id, slug: null })).toEqual([]);
  });

  it("previews a word with its card and exercises, and a sentence with the exercises made from it", async () => {
    const words = [];
    for (const code of ["pomme", "poire", "banane", "orange", "cerise", "fraise"]) words.push(await word(code, { gender: "f" }));
    const pomme = words[0];
    const line = await sentence("pomme mûre.", [pomme.id], { status: "needs_review" });
    await sentence("pomme verte.", [pomme.id]);

    const card = await previewItem("words", "fr", pomme.id);
    if (card.state !== "ready") throw new Error(card.reason);
    expect(card.screens[0]).toMatchObject({ kind: "word", card: { word: { lemma: "pomme" } } });
    const codes = card.screens.flatMap((screen) => (screen.kind === "exercise" ? [screen.ex.code] : []));
    expect(codes).toEqual(expect.arrayContaining(["W1a", "W2a", "W2d", "W5a", "W6a"]));
    expect(card.words[pomme.id]).toBeDefined();

    const used = await previewItem("sentences", "fr", line.id);
    if (used.state !== "ready") throw new Error(used.reason);
    expect(used.screens[0]).toMatchObject({ kind: "sentence", sentence: { text: "pomme mûre." } });
    const exercises = used.screens.flatMap((screen) => (screen.kind === "exercise" ? [screen.ex] : []));
    expect(exercises.map((ex) => ex.code)).toEqual(expect.arrayContaining(["W6a", "W6b"]));
    // Heard alone (PRD §7.6): with only two sentences there are no three other translations for L1.
    expect(exercises.filter((ex) => ex.code.startsWith("L")).map((ex) => ex.code)).toEqual(["L2", "L3"]);
    // Every exercise of the sentence is about this sentence, not another one of the word.
    for (const ex of exercises) expect(ex.sentenceId).toBe(line.id);

    expect(await previewItem("dialogues", "fr", 1)).toEqual({ state: "none", reason: "missing" });
    expect(await previewItem("texts", "fr", 1)).toEqual({ state: "none", reason: "missing" });
    const skeleton = await word("eau", { meaning_fa: null });
    expect(await previewItem("words", "fr", skeleton.id)).toEqual({ state: "none", reason: "missing" });
  });

  it("finds an item's QA findings in every batch and marks the worst", async () => {
    const pomme = await word("pomme");
    const findings = (severity: string) => [{ path: "words[0]", severity, problem: "معنی دقیق نیست", suggestion: null, label: "pomme", entity: { type: "word", id: pomme.id } }];
    for (const severity of ["low", "high"]) {
      await testDb.importBatch.create({
        data: { language: "fr", prompt_kind: "P_W", prompt_version: "v1", prompt_text: "", state: "qa_done", qa_findings: findings(severity) as Prisma.InputJsonValue },
      });
    }
    const found = await findingsOf("word", [pomme.id, pomme.id + 1]);
    expect(found.get(pomme.id)?.map((finding) => finding.severity)).toEqual(["high", "low"]);
    expect(found.has(pomme.id + 1)).toBe(false);
    expect(findingMark(found.get(pomme.id))).toEqual({ count: 2, severity: "high" });
  });
});

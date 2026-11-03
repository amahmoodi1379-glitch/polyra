import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newItemState } from "@/engine/answer";
import type { Ex, RawAnswer } from "@/engine/ex";
import { emptyCard, rateCard, withDue } from "@/engine/fsrs";
import { grade } from "@/engine/grade";
import { playCard, shownEx } from "@/engine/session/play";
import type { Card } from "@/engine/session/types";
import type { ItemStateE } from "@/engine/state";
import { plusDays, tehranDate } from "@/engine/time";
import { loadDemo } from "@/server/content/demo";
import { submitAnswer } from "@/server/learn/answer";
import { forgetContent, loadContent } from "@/server/learn/content";
import { startFromZero } from "@/server/learn/enroll";
import { startSession, type Bundle } from "@/server/learn/session";
import { saveItemState } from "@/server/learn/writes";
import { acceptAnswer, acceptPlace, markFixed, rejectReport, setReportPriority, suspendReported } from "@/server/reports/admin";
import { fileReport, REPORTS_PER_DAY, takeReportNotices } from "@/server/reports/file";
import { openReportCount, reportQueue, reportRow } from "@/server/reports/list";
import { reportPreview } from "@/server/reports/preview";
import { engineSettings } from "@/server/settings/read";
import { rightAnswer } from "@/sim/answers";
import { testDb } from "./db";

/**
 * «گزارش اشکال» and «حق با تو بود» (PRD §13.10) on the French demo: a report is filed for an answer that
 * is on the server, the panel's four answers change the content and, for the learner who was right,
 * their item (T72).
 */

const NOW = new Date("2026-10-14T06:00:00Z");
let phones = 0;
let admin = 0;

type Person = { id: number; is_admin: boolean; is_tester: boolean; phone: string };

async function person(): Promise<Person> {
  const phone = `+98912100${String(++phones).padStart(4, "0")}`;
  const user = await testDb.user.create({ data: { phone, session_length_min: 15, is_tester: true } });
  await startFromZero(user, "fr", NOW);
  return { id: user.id, is_admin: user.is_admin, is_tester: user.is_tester, phone };
}

/** A learned item at `step`, due now. */
async function learned(userId: number, type: "word" | "grammar_unit", id: number, step: number) {
  const intro = plusDays(NOW, -20);
  const settings = await engineSettings();
  const card = rateCard(emptyCard(intro), "good", intro, settings);
  const state: ItemStateE = { ...newItemState(type, id, intro), step, firstReviewDone: true, typedOnce: true, fsrs: withDue(card, plusDays(NOW, -1)) };
  await saveItemState(testDb, { userId, language: "fr" }, state);
}

/** One answer row as `answer.ts` writes it. */
async function answerRow(userId: number, data: { item_type: string; item_id: number; code: string; result: "correct" | "near" | "wrong" | "idk"; raw?: string; sentence_id?: number | null; target_id?: number | null; step_before?: number }) {
  const id = randomUUID();
  await testDb.reviewLog.create({
    data: {
      id,
      user_id: userId,
      language: "fr",
      kind: "review",
      item_type: data.item_type,
      item_id: data.item_id,
      exercise_code: data.code,
      result: data.result,
      raw_answer: data.raw ?? null,
      sentence_id: data.sentence_id ?? null,
      sentence_target_id: data.target_id ?? null,
      step_before: data.step_before ?? null,
      ts: NOW,
    },
  });
  return id;
}

/** Plays the session until `wanted` finds a card; that card gets `answer`, every other one the right answer. */
async function answerFirst(user: Person, bundle: Bundle, wanted: (ex: Ex) => boolean, answer: (ex: Ex) => RawAnswer) {
  let plan = bundle.plan;
  let seq = bundle.nextSeq;
  for (let i = 0; plan.queue.length > 0 && i < 200; i++) {
    const at = new Date(NOW.getTime() + (i + 1) * 5000);
    const card: Card = plan.queue[0];
    const ex = card.t === "intro" || card.t === "lesson" || card.t === "table" || card.t === "confusion" || card.t === "text" || card.prod ? null : shownEx(plan, card);
    const hit = ex !== null && wanted(ex);
    const raw: RawAnswer = hit ? answer(ex!) : ex ? rightAnswer(ex) : { seen: true };
    const lexicon = new Map(bundle.lexicon);
    const result = playCard(plan, card.id, raw, { latencyMs: 5000, elapsedSec: 5 }, { ctx: { settings: bundle.settings, now: at, today: tehranDate(at), latency: plan.latency }, language: "fr", wordsWithLemma: (lemma) => lexicon.get(lemma) ?? [] });
    if (!result.done) throw new Error("The card was not finished");
    const answerId = randomUUID();
    const response = await submitAnswer(user, { sessionId: bundle.id, answerId, seq, cardId: card.id, answer: raw as Record<string, unknown>, latencyMs: 5000, elapsedSec: 5, at: at.toISOString(), shown: null }, at);
    if (response.kind !== "ok") throw new Error(`Answer ${seq}: ${response.kind}`);
    seq++;
    if (hit) return { ex: ex!, answerId };
    plan = result.advanced.plan;
  }
  throw new Error("No such exercise in the session");
}

const REPORT_TABLES = ["content_report", "user_notice", "event", "review_log", "session", "item_state", "notebook_entry", "new_word_queue", "daily_counter", "enrollment", "trial_ledger", "skill_level", "admin_log", "sentence_drill_state"];

beforeAll(async () => {
  const rows = await testDb.$queryRawUnsafe<{ tablename: string }[]>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
  await testDb.$executeRawUnsafe(`TRUNCATE ${rows.map((row) => `"public"."${row.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await testDb.language.createMany({ data: [{ code: "fr" }, { code: "de" }] });
  expect(await loadDemo()).toMatchObject({ kind: "loaded" });
  admin = (await testDb.user.create({ data: { phone: "+989121009999", is_admin: true, admin_language: "all", session_length_min: 15 } })).id;
}, 120_000);

beforeEach(async () => {
  await testDb.$executeRawUnsafe(`TRUNCATE ${REPORT_TABLES.map((name) => `"public"."${name}"`).join(", ")} CASCADE`);
  forgetContent();
});

afterAll(() => testDb.$disconnect());

/** A word of the demo with a typed sentence target of one blank. */
async function typedTarget() {
  const target = await testDb.sentenceTarget.findFirstOrThrow({ where: { target_type: "word", blanks: 1 }, orderBy: { id: "asc" } });
  return target;
}

describe("filing a report (PRD §13.10)", () => {
  it("needs the answer on the server, the learner's own, a known reason and one line at most", async () => {
    const user = await person();
    const other = await person();
    const word = await testDb.word.findFirstOrThrow({ where: { language: "fr" }, orderBy: { id: "asc" } });
    const answerId = await answerRow(user.id, { item_type: "word", item_id: word.id, code: "W2a", result: "wrong" });

    expect(await fileReport(user, { answerId: "nope", reason: "other" }, NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(await fileReport(user, { answerId, reason: "because" }, NOW)).toEqual({ ok: false, reason: "invalid" });
    expect(await fileReport(user, { answerId, reason: "other", note: "x".repeat(301) }, NOW)).toEqual({ ok: false, reason: "invalid" });
    // The answer is still on its way: the browser asks again.
    expect(await fileReport(user, { answerId: randomUUID(), reason: "other" }, NOW)).toEqual({ ok: false, reason: "later" });
    expect(await fileReport(other, { answerId, reason: "other" }, NOW)).toEqual({ ok: false, reason: "invalid" });

    expect(await fileReport(user, { answerId, reason: "audio", note: "  صدا   قطع   می‌شود " }, NOW)).toEqual({ ok: true });
    // Sent twice (a second tap, a retry): one report.
    expect(await fileReport(user, { answerId, reason: "audio" }, NOW)).toEqual({ ok: true });
    const reports = await testDb.contentReport.findMany();
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ user_id: user.id, review_log_id: answerId, item_type: "word", item_id: word.id, exercise_code: "W2a", reason: "audio", note: "صدا قطع می‌شود", priority: "normal", status: "open" });
    expect(await testDb.event.count({ where: { name: "report", user_id: user.id } })).toBe(1);
  });

  it(`takes at most ${REPORTS_PER_DAY} reports a day from one learner (Tehran's day)`, async () => {
    const user = await person();
    const word = await testDb.word.findFirstOrThrow({ where: { language: "fr" }, orderBy: { id: "asc" } });
    for (let i = 0; i < REPORTS_PER_DAY; i++) {
      const answerId = await answerRow(user.id, { item_type: "word", item_id: word.id, code: "W2a", result: "wrong" });
      expect(await fileReport(user, { answerId, reason: "other" }, NOW)).toEqual({ ok: true });
    }
    const extra = await answerRow(user.id, { item_type: "word", item_id: word.id, code: "W2a", result: "wrong" });
    expect(await fileReport(user, { answerId: extra, reason: "other" }, NOW)).toEqual({ ok: false, reason: "limit" });
    // The next day in Tehran (NOW is 09:30 there; 21:00 UTC is 00:30 the next day).
    expect(await fileReport(user, { answerId: extra, reason: "other" }, new Date("2026-10-14T21:00:00Z"))).toEqual({ ok: true });
  });

  it("three different learners on one item make it urgent (report.auto_high), and an urgent report counts first", async () => {
    const word = await testDb.word.findFirstOrThrow({ where: { language: "fr" }, orderBy: { id: "asc" } });
    const people = [await person(), await person(), await person()];
    // The same learner twice is still one person.
    for (const user of [people[0], people[0], people[1]]) {
      const answerId = await answerRow(user.id, { item_type: "word", item_id: word.id, code: "W2a", result: "wrong" });
      await fileReport(user, { answerId, reason: "answer_wrong" }, NOW);
    }
    expect(await testDb.contentReport.count({ where: { priority: "high" } })).toBe(0);
    const third = await answerRow(people[2].id, { item_type: "word", item_id: word.id, code: "W2a", result: "wrong" });
    await fileReport(people[2], { answerId: third, reason: "answer_wrong" }, NOW);
    expect(await testDb.contentReport.count({ where: { priority: "high" } })).toBe(4);
    expect(await openReportCount("fr")).toEqual({ open: 4, high: 4 });
    expect(await openReportCount("de")).toEqual({ open: 0, high: 0 });

    // Back to normal by hand; another word's report stays apart.
    const reports = await testDb.contentReport.findMany({ orderBy: { id: "asc" } });
    await setReportPriority(reports[0].id, "normal");
    expect((await reportQueue("open", "fr")).rows.map((row) => row.id)).toEqual([reports[1].id, reports[2].id, reports[3].id, reports[0].id]);
    expect((await reportQueue("open", "de")).rows).toHaveLength(0);
  });

  it("names a transform or a translation by its text inside the unit, and a notebook sentence by its unit", async () => {
    const user = await person();
    const transform = await testDb.transformItem.findFirstOrThrow({ orderBy: { id: "asc" } });
    const g6 = await answerRow(user.id, { item_type: "grammar_unit", item_id: transform.grammar_unit_id, code: "G6", result: "wrong", raw: "Il mange pas." });
    expect(await fileReport(user, { answerId: g6, reason: "my_answer_ok", source: transform.source_sentence }, NOW)).toEqual({ ok: true });
    const target = await testDb.sentenceTarget.findFirstOrThrow({ where: { target_type: "grammar" }, orderBy: { id: "asc" } });
    const fromNotebook = await answerRow(user.id, { item_type: "grammar_target", item_id: target.id, code: "G5a", result: "wrong", sentence_id: target.sentence_id, target_id: target.id });
    expect(await fileReport(user, { answerId: fromNotebook, reason: "translation" }, NOW)).toEqual({ ok: true });
    const reports = await testDb.contentReport.findMany({ orderBy: { id: "asc" } });
    expect(reports.map((row) => [row.item_type, row.item_id])).toEqual([
      ["transform_item", transform.id],
      ["grammar_unit", target.target_id],
    ]);
    expect(acceptPlace(reports[0], null)).toEqual({ kind: "transform", itemId: transform.id });
  });
});

describe("T72: «جواب کاربر هم درست است» after a typed answer recorded wrong", () => {
  it("adds the answer, takes the notebook entry out, puts the step back, one failure fewer, FSRS untouched, and a note waits", async () => {
    const user = await person();
    const targets = await testDb.sentenceTarget.findMany({ where: { target_type: "word", blanks: 1 }, distinct: ["target_id"], select: { target_id: true }, orderBy: { target_id: "asc" }, take: 12 });
    for (const target of targets) await learned(user.id, "word", target.target_id, 6);
    const start = await startSession(user, { language: "fr", scope: "vocab", noAudio: true, cap: null }, NOW);
    if (start.kind !== "session") throw new Error(start.kind);
    const { ex, answerId } = await answerFirst(user, start.bundle, (item) => item.code === "W6a" && item.targetId !== null, () => ({ text: "zzzz" }));

    const log = await testDb.reviewLog.findUniqueOrThrow({ where: { id: answerId } });
    expect(log).toMatchObject({ result: "wrong", exercise_code: "W6a", raw_answer: "zzzz", sentence_target_id: ex.targetId });
    const wordId = log.item_id!;
    const before = await testDb.itemState.findUniqueOrThrow({ where: { user_id_item_type_item_id: { user_id: user.id, item_type: "word", item_id: wordId } } });
    expect(before.step).toBeLessThan(log.step_before!);
    expect(before.fail_count).toBe(1);
    expect(await testDb.notebookEntry.count({ where: { user_id: user.id, ref_type: "word", ref_id: wordId } })).toBe(1);

    expect(await fileReport(user, { answerId, reason: "my_answer_ok", note: "zzzz هم درست است" }, NOW)).toEqual({ ok: true });
    const report = await testDb.contentReport.findFirstOrThrow();
    expect(report).toMatchObject({ item_type: "word", item_id: wordId, sentence_id: log.sentence_id, raw_answer: "zzzz" });

    const row = await reportRow(report.id);
    expect(row).toMatchObject({ canAccept: true, result: "wrong", targetId: ex.targetId, item: { slug: "words", id: wordId }, sentence: { id: log.sentence_id } });
    // The panel shows that exercise again, built by the engine.
    const { preview, exact } = await reportPreview(row!);
    expect(exact).toBe(true);
    expect(preview.state === "ready" && preview.screens).toEqual([expect.objectContaining({ kind: "exercise", ex: expect.objectContaining({ code: "W6a", targetId: ex.targetId }) })]);

    expect(await acceptAnswer(admin, report.id, NOW)).toEqual({ ok: true, right: true });
    const target = await testDb.sentenceTarget.findUniqueOrThrow({ where: { id: ex.targetId! } });
    expect(target.accepted).toContain("zzzz");
    expect(await testDb.contentReport.findUniqueOrThrow({ where: { id: report.id } })).toMatchObject({ status: "fixed", resolved_by: admin });
    const after = await testDb.itemState.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.step).toBe(Math.max(before.step, log.step_before!));
    expect(after.fail_count).toBe(0);
    expect(after.fsrs).toEqual(before.fsrs);
    expect(after.deferred_until).toEqual(before.deferred_until);
    expect(await testDb.notebookEntry.count({ where: { user_id: user.id, ref_type: "word", ref_id: wordId } })).toBe(0);
    // Logged like an edit of the sentence, so «برگرداندن» in the change log can take it out again.
    expect(await testDb.adminLog.count({ where: { entity: "sentence", entity_id: String(log.sentence_id), admin_id: admin } })).toBe(1);

    // The next build accepts it, for everyone.
    const content = await loadContent("fr", "tester");
    expect(content.targets.get(ex.targetId!)?.accepted).toContain("zzzz");
    expect(grade({ ...ex, a: { ...ex.a, ...(ex.a.kind === "type" ? { accepted: [...(ex.a.accepted ?? []), "zzzz"] } : {}) } } as Ex, { text: "zzzz" }, { language: "fr" }).result).toBe("correct");

    // «حق با تو بود» once on the home.
    expect(await takeReportNotices(user.id, "fr", NOW)).toBe(1);
    expect(await takeReportNotices(user.id, "fr", NOW)).toBe(0);
    // A closed report takes no second answer.
    expect(await acceptAnswer(admin, report.id, NOW)).toEqual({ ok: false, reason: "closed" });
    expect(await rejectReport(admin, report.id)).toEqual({ ok: false, reason: "closed" });
  });
});

describe("the other answers to a report", () => {
  it("«اصلاح شد» with «حق با زبان‌آموز بود» puts a wrong answer right; without the tick, or for a right answer, nothing changes for the learner", async () => {
    const user = await person();
    const word = await testDb.word.findFirstOrThrow({ where: { language: "fr" }, orderBy: { id: "asc" } });
    await learned(user.id, "word", word.id, 2);
    await testDb.itemState.updateMany({ where: { user_id: user.id, item_id: word.id }, data: { fail_count: 3, deferred_until: plusDays(NOW, 2) } });
    await testDb.notebookEntry.create({ data: { user_id: user.id, language: "fr", ref_type: "word_gender", ref_id: word.id, until: plusDays(NOW, 7) } });
    await testDb.notebookEntry.create({ data: { user_id: user.id, language: "fr", ref_type: "word", ref_id: word.id, until: plusDays(NOW, 7) } });

    const gender = await answerRow(user.id, { item_type: "word", item_id: word.id, code: "W2d", result: "wrong", step_before: 4 });
    const right = await answerRow(user.id, { item_type: "word", item_id: word.id, code: "W2a", result: "correct", step_before: 2 });
    const unticked = await answerRow(user.id, { item_type: "word", item_id: word.id, code: "W2a", result: "idk", step_before: 3 });
    for (const answerId of [gender, right, unticked]) await fileReport(user, { answerId, reason: "answer_wrong" }, NOW);
    const [a, b, c] = await testDb.contentReport.findMany({ orderBy: { id: "asc" } });

    // A choice exercise has no list of accepted answers to add to.
    expect(await acceptAnswer(admin, a.id, NOW)).toEqual({ ok: false, reason: "cannot" });
    expect(await markFixed(admin, a.id, true, NOW)).toEqual({ ok: true, right: true });
    const state = await testDb.itemState.findFirstOrThrow({ where: { user_id: user.id, item_id: word.id } });
    // A sticky word's rest is left alone (PRD §9.13).
    expect(state).toMatchObject({ step: 4, fail_count: 2, deferred_until: plusDays(NOW, 2) });
    // Only the gender entry that answer made goes.
    expect((await testDb.notebookEntry.findMany({ where: { user_id: user.id } })).map((row) => row.ref_type)).toEqual(["word"]);

    expect(await markFixed(admin, b.id, true, NOW)).toEqual({ ok: true, right: false });
    expect(await markFixed(admin, c.id, false, NOW)).toEqual({ ok: true, right: false });
    expect(await testDb.itemState.findFirstOrThrow({ where: { user_id: user.id, item_id: word.id } })).toMatchObject({ step: 4, fail_count: 2 });
    expect(await testDb.userNotice.count({ where: { user_id: user.id } })).toBe(1);
    expect(await testDb.contentReport.count({ where: { status: "fixed" } })).toBe(3);
  });

  it("«رد گزارش» closes it with nothing else; «تعلیق» takes the sentence (or the item) out and keeps the report open", async () => {
    const user = await person();
    const target = await typedTarget();
    const answerId = await answerRow(user.id, { item_type: "word", item_id: target.target_id, code: "W6a", result: "wrong", raw: "abc", sentence_id: target.sentence_id, target_id: target.id, step_before: 6 });
    await fileReport(user, { answerId, reason: "audio" }, NOW);
    const word = await testDb.word.findFirstOrThrow({ where: { language: "fr", id: { not: target.target_id } }, orderBy: { id: "asc" } });
    const plain = await answerRow(user.id, { item_type: "word", item_id: word.id, code: "W1", result: "wrong" });
    await fileReport(user, { answerId: plain, reason: "audio" }, NOW);
    const [onSentence, onWord] = await testDb.contentReport.findMany({ orderBy: { id: "asc" } });

    expect(await suspendReported(admin, onSentence.id)).toEqual({ ok: true, right: false });
    expect((await testDb.sentence.findUniqueOrThrow({ where: { id: target.sentence_id } })).suspended).toBe(true);
    expect((await testDb.word.findUniqueOrThrow({ where: { id: target.target_id } })).suspended).toBe(false);
    expect((await testDb.contentReport.findUniqueOrThrow({ where: { id: onSentence.id } })).status).toBe("open");
    expect(await reportRow(onSentence.id)).toMatchObject({ sentence: { suspended: true } });

    expect(await suspendReported(admin, onWord.id)).toEqual({ ok: true, right: false });
    expect((await testDb.word.findUniqueOrThrow({ where: { id: word.id } })).suspended).toBe(true);

    expect(await rejectReport(admin, onWord.id)).toEqual({ ok: true, right: false });
    expect(await testDb.contentReport.findUniqueOrThrow({ where: { id: onWord.id } })).toMatchObject({ status: "rejected", resolved_by: admin });
    expect(await testDb.userNotice.count()).toBe(0);
    expect(await rejectReport(admin, 999_999)).toEqual({ ok: false, reason: "gone" });

    const done = await reportQueue("done", "fr");
    expect(done.rows.map((row) => row.id)).toEqual([onWord.id]);
    expect((await reportQueue("open", null)).rows.map((row) => row.id)).toEqual([onSentence.id]);
    await testDb.sentence.update({ where: { id: target.sentence_id }, data: { suspended: false } });
    await testDb.word.update({ where: { id: word.id }, data: { suspended: false } });
  });

  it("adds an order to a sentence's whole-sentence answers, and a transform's output to its outputs", async () => {
    const user = await person();
    const grammar = await testDb.sentenceTarget.findFirstOrThrow({ where: { target_type: "grammar" }, orderBy: { id: "asc" } });
    const order = await answerRow(user.id, { item_type: "grammar_unit", item_id: grammar.target_id, code: "G4a", result: "wrong", raw: "B A C", sentence_id: grammar.sentence_id, target_id: grammar.id });
    await fileReport(user, { answerId: order, reason: "my_answer_ok" }, NOW);
    const transform = await testDb.transformItem.findFirstOrThrow({ orderBy: { id: "asc" } });
    const g6 = await answerRow(user.id, { item_type: "grammar_unit", item_id: transform.grammar_unit_id, code: "G6", result: "wrong", raw: "Une autre phrase." });
    await fileReport(user, { answerId: g6, reason: "my_answer_ok", source: transform.source_sentence }, NOW);
    const [first, second] = await testDb.contentReport.findMany({ orderBy: { id: "asc" } });

    // Both were recorded wrong: the learner hears they were right, even with no item state to put back.
    expect(await acceptAnswer(admin, first.id, NOW)).toEqual({ ok: true, right: true });
    const after = await testDb.sentenceTarget.findUniqueOrThrow({ where: { id: grammar.id } });
    expect(after.accepted_full).toContain("B A C");
    expect(after.accepted).toEqual(grammar.accepted);

    expect(await acceptAnswer(admin, second.id, NOW)).toEqual({ ok: true, right: true });
    expect((await testDb.transformItem.findUniqueOrThrow({ where: { id: transform.id } })).accepted_outputs).toEqual([...transform.accepted_outputs, "Une autre phrase."]);
    expect(await testDb.adminLog.count({ where: { entity: "transform_item", entity_id: String(transform.id) } })).toBe(1);
  });
});

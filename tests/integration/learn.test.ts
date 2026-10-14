import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newItemState } from "@/engine/answer";
import { hasCard } from "@/engine/content";
import type { RawAnswer } from "@/engine/ex";
import { emptyCard, rateCard, withDue } from "@/engine/fsrs";
import { playCard, shownEx } from "@/engine/session/play";
import type { Card } from "@/engine/session/types";
import type { ItemStateE, ItemType } from "@/engine/state";
import { plusDays, tehranDate } from "@/engine/time";
import { demoStatus, loadDemo, removeDemo } from "@/server/content/demo";
import { saveOrder } from "@/server/content/order";
import { submitAnswer, sessionEnd } from "@/server/learn/answer";
import { forgetContent, loadContent } from "@/server/learn/content";
import { startFromZero } from "@/server/learn/enroll";
import { homeData } from "@/server/learn/home";
import { startSession, type Bundle } from "@/server/learn/session";
import { saveItemState } from "@/server/learn/writes";
import { engineSettings } from "@/server/settings/read";
import { rightAnswer } from "../../fixtures/synthetic/drive";
import { testDb } from "./db";

/**
 * The learner's side on the server (PRD §10.8, §15.4) with the French demo: sessions are built,
 * answered and finished through the same functions the API routes call.
 */

const NOW = new Date("2026-10-14T06:00:00Z");
let phones = 0;

type Person = { id: number; is_admin: boolean; is_tester: boolean; phone: string };

async function person(extra: { is_tester?: boolean; is_admin?: boolean } = {}): Promise<Person> {
  const phone = `+98912000${String(++phones).padStart(4, "0")}`;
  const user = await testDb.user.create({ data: { phone, session_length_min: 15, ...extra } });
  return { id: user.id, is_admin: user.is_admin, is_tester: user.is_tester, phone };
}

async function enrolled(extra: { is_tester?: boolean; is_admin?: boolean } = { is_tester: true }) {
  const user = await person(extra);
  await startFromZero(user, "fr", NOW);
  return user;
}

async function started(user: Person, now = NOW, scope: "mixed" | "vocab" | "grammar" = "mixed"): Promise<Bundle> {
  const result = await startSession(user, { language: "fr", scope, noAudio: false, cap: null }, now);
  if (result.kind !== "session") throw new Error(`Expected a session, got ${result.kind}`);
  return result.bundle;
}

/** What the browser does for one card: plays it locally, then sends the final answer. */
function answerFor(bundle: Bundle, plan: Bundle["plan"], card: Card, at: Date, answer?: RawAnswer) {
  const ex = card.t === "intro" || card.t === "lesson" || card.t === "table" || card.t === "confusion" ? null : shownEx(plan, card);
  const raw = answer ?? (ex ? rightAnswer(ex) : { seen: true });
  const lexicon = new Map(bundle.lexicon);
  const ctx = { settings: bundle.settings, now: at, today: tehranDate(at), latency: plan.latency };
  const result = playCard(plan, card.id, raw, { latencyMs: 5000, elapsedSec: 5 }, { ctx, language: "fr", wordsWithLemma: (lemma) => lexicon.get(lemma) ?? [] });
  if (!result.done) throw new Error("The card was not finished");
  return { raw, result };
}

const request = (bundle: Bundle, seq: number, card: Card, raw: RawAnswer, at: Date, answerId = randomUUID()) => ({
  sessionId: bundle.id,
  answerId,
  seq,
  cardId: card.id,
  answer: raw as Record<string, unknown>,
  latencyMs: 5000,
  elapsedSec: 5,
  at: at.toISOString(),
  shown: null,
});

/** Plays a whole session with right answers, five seconds a card. */
async function playAll(user: Person, bundle: Bundle, start = NOW) {
  let plan = bundle.plan;
  let seq = bundle.nextSeq;
  for (let i = 0; plan.queue.length > 0 && i < 400; i++) {
    const at = new Date(start.getTime() + (i + 1) * 5000);
    const card = plan.queue[0];
    const { raw, result } = answerFor(bundle, plan, card, at);
    const response = await submitAnswer(user, request(bundle, seq, card, raw, at), at);
    if (response.kind !== "ok") throw new Error(`Answer ${seq}: ${response.kind}`);
    seq++;
    plan = result.advanced.plan;
    if (response.finished) return response.end;
  }
  throw new Error("The session did not finish");
}

/** A learned item, due `dueInDays` from NOW (negative: overdue). */
async function learned(userId: number, type: ItemType, id: number, { step = 2, dueInDays = -1 } = {}) {
  const intro = plusDays(NOW, -10);
  const settings = await engineSettings();
  const card = rateCard(emptyCard(intro), "good", intro, settings);
  const state: ItemStateE = { ...newItemState(type, id, intro), step, firstReviewDone: true, fsrs: withDue(card, plusDays(NOW, dueInDays)) };
  await saveItemState(testDb, { userId, language: "fr" }, state);
}

const LEARNER_TABLES = ["review_log", "session", "item_state", "notebook_entry", "new_word_queue", "daily_counter", "confusion_pair", "skill_level", "enrollment", "trial_ledger", "admin_log"];

beforeAll(async () => {
  const rows = await testDb.$queryRawUnsafe<{ tablename: string }[]>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
  await testDb.$executeRawUnsafe(`TRUNCATE ${rows.map((row) => `"public"."${row.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await testDb.language.createMany({ data: [{ code: "fr" }, { code: "de" }] });
  const loaded = await loadDemo();
  expect(loaded).toMatchObject({ kind: "loaded", words: 60, units: 6 });
}, 120_000);

beforeEach(async () => {
  await testDb.$executeRawUnsafe(`TRUNCATE ${LEARNER_TABLES.map((name) => `"public"."${name}"`).join(", ")} CASCADE`);
  forgetContent();
});

afterAll(() => testDb.$disconnect());

describe("the French demo", () => {
  it("is imported through the panel's importers, approved, once", async () => {
    expect(await demoStatus()).toMatchObject({ loaded: true, words: 60, units: 6, otherWords: 0 });
    expect(await testDb.word.count({ where: { language: "fr", status: { not: "approved" } } })).toBe(0);
    expect(await testDb.sentenceWord.count({ where: { OR: [{ suspect: true }, { candidate_reason: { not: null } }] } })).toBe(0);
    expect(await testDb.grammarUnit.count({ where: { lesson_fa: null } })).toBe(0);
    expect(await loadDemo()).toEqual({ kind: "already" });
  });
});

describe("who sees what (PRD §13.5)", () => {
  it("T46: approved content in a level that is not released: a tester sees it, a learner does not", async () => {
    await testDb.levelRelease.create({ data: { language: "fr", level: "A1" } });
    const tester = await loadContent("fr", "tester");
    const learner = await loadContent("fr", "public");
    expect([...tester.words.values()].filter(hasCard)).toHaveLength(60);
    expect(tester.units).toHaveLength(6);
    expect(learner.words.size).toBe(0);
    expect(learner.units).toHaveLength(0);
  });
});

describe("a session from start to end (PRD §10.8, §3.9)", () => {
  it("writes every answer, the new words, the streak and the end screen", async () => {
    const user = await enrolled();
    const bundle = await started(user);
    expect(bundle.plan.summary.newWords).toBeGreaterThan(0);
    expect(bundle.soundTip).toBe(true);

    const end = await playAll(user, bundle);
    expect(end).toMatchObject({ wrong: 0, streak: { counted: true, count: 1 } });
    expect(end!.newWordsToday).toBe(bundle.plan.summary.newWords);
    expect(await testDb.itemState.count({ where: { user_id: user.id, item_type: "word" } })).toBe(bundle.plan.summary.newWords);
    const session = await testDb.session.findUniqueOrThrow({ where: { id: bundle.id } });
    expect(session.end_reason).toBe("finished");
    expect(await testDb.reviewLog.count({ where: { session_id: bundle.id } })).toBe(session.next_seq - 1);
    expect(await sessionEnd(user, bundle.id)).toEqual(end);
    // The first close of a language starts its free period (PRD §12.1).
    expect((await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } })).trial_started_at).not.toBeNull();
  });

  it("resumes the open session of the same scope instead of building a new one", async () => {
    const user = await enrolled();
    const first = await started(user);
    const again = await started(user, new Date(NOW.getTime() + 60_000));
    expect(again.id).toBe(first.id);
  });
});

describe("answers arrive once and in order (PRD §15.4)", () => {
  it("T45: the same answer_id twice gives one review_log row and one change", async () => {
    const user = await enrolled();
    const bundle = await started(user);
    const plan = bundle.plan;
    const intro = plan.queue[0];
    const at = new Date(NOW.getTime() + 5000);
    const { raw } = answerFor(bundle, plan, intro, at);
    const body = request(bundle, bundle.nextSeq, intro, raw, at);
    expect(await submitAnswer(user, body, at)).toMatchObject({ kind: "ok", seq: bundle.nextSeq });
    const row = await testDb.session.findUniqueOrThrow({ where: { id: bundle.id } });
    expect(await submitAnswer(user, body, new Date(at.getTime() + 1000))).toEqual({ kind: "duplicate" });
    expect(await testDb.reviewLog.count({ where: { id: body.answerId } })).toBe(1);
    const after = await testDb.session.findUniqueOrThrow({ where: { id: bundle.id } });
    expect(after.next_seq).toBe(row.next_seq);
    expect(after.position).toBe(row.position);
  });

  it("T73: an answer with another seq is not applied and gets the session as it stands", async () => {
    const user = await enrolled();
    const bundle = await started(user);
    const card = bundle.plan.queue[0];
    const at = new Date(NOW.getTime() + 5000);
    const { raw } = answerFor(bundle, bundle.plan, card, at);
    const response = await submitAnswer(user, request(bundle, bundle.nextSeq + 1, card, raw, at), at);
    expect(response.kind).toBe("resync");
    if (response.kind === "resync") {
      expect(response.bundle.nextSeq).toBe(bundle.nextSeq);
      expect(response.bundle.plan.queue[0].id).toBe(card.id);
    }
    expect(await testDb.reviewLog.count({ where: { session_id: bundle.id } })).toBe(0);
  });
});

describe("closing a session early (PRD §10.8)", () => {
  it("T79: an intro card seen, then the session closes before the first exercise: no item_state, no new-word count", async () => {
    const user = await enrolled();
    const bundle = await started(user);
    const intro = bundle.plan.queue[0];
    expect(intro.t).toBe("intro");
    const at = new Date(NOW.getTime() + 5000);
    expect(await submitAnswer(user, request(bundle, bundle.nextSeq, intro, { seen: true }, at), at)).toMatchObject({ kind: "ok" });

    // Another button replaces the open session (PRD §10.8).
    const other = await startSession(user, { language: "fr", scope: "vocab", noAudio: false, cap: null }, new Date(at.getTime() + 60_000));
    expect(other.kind).toBe("session");
    expect((await testDb.session.findUniqueOrThrow({ where: { id: bundle.id } })).end_reason).toBe("replaced");
    expect(await testDb.itemState.count({ where: { user_id: user.id } })).toBe(0);
    const daily = await testDb.dailyCounter.findFirst({ where: { user_id: user.id } });
    expect(daily?.new_words ?? 0).toBe(0);
  });
});

describe("the line under «شروع» (PRD §10.2)", () => {
  it("T106: the home screen's dry run with a large backlog writes nothing; a real start spreads it", async () => {
    const user = await enrolled();
    const words = await testDb.word.findMany({ where: { language: "fr", no_card: false }, select: { id: true } });
    for (const word of words) await learned(user.id, "word", word.id, { dueInDays: -20 });
    const snapshot = async () => ({
      enrollment: await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } }),
      deferred: await testDb.itemState.count({ where: { user_id: user.id, deferred_until: { not: null } } }),
      daily: await testDb.dailyCounter.count({ where: { user_id: user.id } }),
      sessions: await testDb.session.count({ where: { user_id: user.id } }),
    });
    const before = await snapshot();
    const home = await homeData(user, "fr", NOW);
    expect(home?.start.reviews).toBeGreaterThan(0);
    expect(await snapshot()).toEqual(before);

    await started(user);
    const after = await snapshot();
    expect(after.enrollment.last_spread_date).not.toBeNull();
    expect(after.deferred).toBeGreaterThan(0);
  });
});

describe("the teacher's unit order (PRD §6.3)", () => {
  it("T47: units 1 and 2 are open; unit 5 moves to place 3; the next unit is unit 5 and 1 and 2 stay", async () => {
    const user = await enrolled();
    const admin = await person({ is_admin: true });
    const words = await testDb.word.findMany({ where: { language: "fr", no_card: false }, select: { id: true } });
    for (const word of words) await learned(user.id, "word", word.id, { dueInDays: 5 });
    const units = await testDb.grammarUnit.findMany({ where: { language: "fr" }, orderBy: { order_no: "asc" }, select: { id: true } });
    const order = units.map((unit) => unit.id);
    for (const id of order.slice(0, 2)) await learned(user.id, "grammar_unit", id, { dueInDays: 5 });

    const moved = [order[0], order[1], order[4], order[2], order[3], order[5]];
    expect(await saveOrder("units", "fr", "A1", order, { order: moved }, admin.id)).toEqual({ state: "saved", changed: true });
    forgetContent();

    const bundle = await started(user, NOW, "grammar");
    const lesson = bundle.plan.queue.find((card) => card.t === "lesson");
    expect(lesson?.item).toBe(`u:${order[4]}`);
    expect(await testDb.itemState.count({ where: { user_id: user.id, item_type: "grammar_unit", item_id: { in: order.slice(0, 2) } } })).toBe(2);
  });
});

describe("removing the demo", () => {
  it("takes out the content and what testers did with it", async () => {
    const user = await enrolled();
    await playAll(user, await started(user));
    expect(await testDb.itemState.count({ where: { user_id: user.id } })).toBeGreaterThan(0);
    expect(await removeDemo()).toEqual({ removed: true });
    expect(await demoStatus()).toMatchObject({ loaded: false, words: 0 });
    expect(await testDb.word.count({ where: { language: "fr" } })).toBe(0);
    expect(await testDb.itemState.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.importBatch.count()).toBe(0);
    expect(await removeDemo()).toEqual({ removed: false });
  });
});

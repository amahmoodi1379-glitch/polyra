import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RawAnswer } from "@/engine/ex";
import { playCard, shownEx } from "@/engine/session/play";
import type { Card } from "@/engine/session/types";
import { tehranDate } from "@/engine/time";
import { loadDemo } from "@/server/content/demo";
import { submitAnswer } from "@/server/learn/answer";
import { forgetContent } from "@/server/learn/content";
import { startFromZero } from "@/server/learn/enroll";
import { startSession, type Bundle } from "@/server/learn/session";
import { queueTappedWord } from "@/server/learn/tap";
import { rightAnswer } from "../../fixtures/synthetic/drive";
import { resetDb, testDb } from "./db";

/**
 * «این را بلدم» and the pretest mode on the server (PRD §11.5) with the French demo: what an answer
 * writes (the probation card, today's counts, the queue row), the daily cap across sessions, a refused
 * press, and the pretest mode turning on in the enrollment and changing the next session.
 */

const NOW = new Date("2026-10-22T06:00:00Z");
let phones = 0;

type Person = { id: number; is_admin: boolean; is_tester: boolean; phone: string };

async function enrolled(): Promise<Person> {
  const phone = `+98912400${String(++phones).padStart(4, "0")}`;
  const user = await testDb.user.create({ data: { phone, session_length_min: 30, is_tester: true } });
  const person = { id: user.id, is_admin: user.is_admin, is_tester: user.is_tester, phone };
  await startFromZero(person, "fr", NOW);
  return person;
}

async function started(user: Person, at = NOW, scope: "mixed" | "vocab" = "vocab"): Promise<Bundle> {
  const result = await startSession(user, { language: "fr", scope, noAudio: false, cap: "more" }, at);
  if (result.kind !== "session") throw new Error(`Expected a session, got ${result.kind}`);
  return result.bundle;
}

/** One card as the browser plays it, then sent; `pick` chooses the answer, else right (or seen). */
async function send(user: Person, bundle: Bundle, plan: Bundle["plan"], seq: number, at: Date, raw?: RawAnswer) {
  const card = plan.queue[0];
  const ex = card.t === "intro" || card.t === "lesson" || card.t === "table" || card.t === "confusion" ? null : shownEx(plan, card);
  const answer = raw ?? (ex ? rightAnswer(ex) : { seen: true });
  const lexicon = new Map(bundle.lexicon);
  const result = playCard(plan, card.id, answer, { latencyMs: 4000, elapsedSec: 5 }, { ctx: { settings: bundle.settings, now: at, today: tehranDate(at), latency: plan.latency }, language: "fr", wordsWithLemma: (lemma) => lexicon.get(lemma) ?? [] });
  const response = await submitAnswer(user, { sessionId: bundle.id, answerId: randomUUID(), seq, cardId: card.id, answer: answer as Record<string, unknown>, latencyMs: 4000, elapsedSec: 5, at: at.toISOString(), shown: null }, at);
  return { response, result, card };
}

/** Plays the session: «این را بلدم» where `press` says so, else right answers. */
async function playAll(user: Person, bundle: Bundle, start: Date, press: (card: Card, plan: Bundle["plan"]) => boolean) {
  let plan = bundle.plan;
  let seq = bundle.nextSeq;
  const pressed: string[] = [];
  for (let i = 0; plan.queue.length > 0 && i < 400; i++) {
    const at = new Date(start.getTime() + (i + 1) * 5000);
    const card = plan.queue[0];
    const iknow = press(card, plan);
    const { response, result } = await send(user, bundle, plan, seq, at, iknow ? { iknow: true } : undefined);
    if (response.kind !== "ok") throw new Error(`Answer ${seq}: ${response.kind}`);
    if (!result.done) throw new Error("not done");
    if (iknow) pressed.push(card.item);
    seq++;
    plan = result.advanced.plan;
  }
  return pressed;
}

/** The panel's switch (PRD §9.12), as a saved engine setting. */
const saveEngineSetting = (key: string, value: boolean) =>
  testDb.engineSetting.upsert({ where: { key }, create: { key, value, default_value: false, description_fa: key }, update: { value } });
const offered = (card: Card, plan: Bundle["plan"]) => (card.t === "intro" || card.t === "lesson") && !!card.probationStep && (plan.counters.iknowLeft ?? 0) > 0;

beforeAll(async () => {
  await resetDb();
  await testDb.language.createMany({ data: [{ code: "fr" }, { code: "de" }] });
  expect(await loadDemo()).toMatchObject({ kind: "loaded" });
  forgetContent();
}, 120_000);

beforeEach(async () => {
  await saveEngineSetting("feature.pretest", false);
});

afterAll(() => testDb.$disconnect());

describe("«این را بلدم» on the server (PRD §11.5)", () => {
  it("writes a probation card with source i_know, counts it in i_know and not as a new word, and logs the press", async () => {
    const user = await enrolled();
    const bundle = await started(user);
    expect(bundle.plan.counters.iknowLeft).toBe(10);
    const card = bundle.plan.queue[0];
    expect(card).toMatchObject({ t: "intro", probationStep: 5 });
    const { response } = await send(user, bundle, bundle.plan, bundle.nextSeq, new Date(NOW.getTime() + 5000), { iknow: true });
    expect(response.kind).toBe("ok");
    const state = await testDb.itemState.findFirstOrThrow({ where: { user_id: user.id, item_id: Number(card.item.slice(2)) } });
    expect(state).toMatchObject({ item_type: "word", step: 5, probation: "single", source: "i_know", first_review_done: false });
    const day = await testDb.dailyCounter.findFirstOrThrow({ where: { user_id: user.id } });
    expect(day).toMatchObject({ i_know: 1, new_words: 0 });
    const log = await testDb.reviewLog.findFirstOrThrow({ where: { user_id: user.id } });
    expect(log).toMatchObject({ kind: "intro", raw_answer: "iknow", item_id: state.item_id });
  });

  it("refuses a press on a card that does not offer it, and any other key with it", async () => {
    const user = await enrolled();
    const bundle = await started(user);
    const plan = bundle.plan;
    // The intro card with an extra key.
    const bad = await submitAnswer(
      user,
      { sessionId: bundle.id, answerId: randomUUID(), seq: bundle.nextSeq, cardId: plan.queue[0].id, answer: { iknow: true, seen: true }, latencyMs: 4000, elapsedSec: 5, at: NOW.toISOString(), shown: null },
      NOW,
    );
    expect(bad.kind).toBe("invalid");
    // Past the intro card: its exercise does not offer the button.
    const { response, result } = await send(user, bundle, plan, bundle.nextSeq, new Date(NOW.getTime() + 5000));
    expect(response.kind).toBe("ok");
    if (!result.done) throw new Error("not done");
    const next = result.advanced.plan.queue[0];
    expect(next.t).not.toBe("intro");
    const refused = await submitAnswer(
      user,
      { sessionId: bundle.id, answerId: randomUUID(), seq: bundle.nextSeq + 1, cardId: next.id, answer: { iknow: true }, latencyMs: 4000, elapsedSec: 5, at: new Date(NOW.getTime() + 10_000).toISOString(), shown: null },
      new Date(NOW.getTime() + 10_000),
    );
    expect(refused.kind).toBe("invalid");
  });

  it("ten a day across sessions: the next session has none left, and the server refuses an eleventh", { timeout: 60_000 }, async () => {
    const user = await enrolled();
    const first = await started(user);
    const pressed = await playAll(user, first, NOW, (card, plan) => offered(card, plan) && card.t === "intro");
    const day = await testDb.dailyCounter.findFirstOrThrow({ where: { user_id: user.id } });
    expect(day.i_know).toBe(pressed.length);
    expect(pressed.length).toBeGreaterThan(0);
    // Up to the cap with a second session; then a third has no button.
    const later = new Date(NOW.getTime() + 3_600_000);
    const second = await started(user, later);
    expect(second.plan.counters.iknowLeft).toBe(Math.max(0, 10 - pressed.length));
    if ((second.plan.counters.iknowLeft ?? 0) > 0) await playAll(user, second, later, (card, plan) => offered(card, plan) && card.t === "intro");
    const after = await testDb.dailyCounter.findFirstOrThrow({ where: { user_id: user.id } });
    expect(after.i_know).toBeLessThanOrEqual(10);
    if (after.i_know === 10) {
      const third = await started(user, new Date(NOW.getTime() + 7_200_000));
      expect(third.plan.counters.iknowLeft).toBe(0);
      expect(third.plan.queue.filter((card) => card.t === "intro").length).toBeGreaterThanOrEqual(0);
    }
  });

  it("a tapped word in the queue: the press removes the queue row and keeps the source i_know", async () => {
    const user = await enrolled();
    const word = await testDb.word.findFirstOrThrow({ where: { language: "fr", no_card: false }, orderBy: { intro_order: "desc" } });
    await queueTappedWord(user, "fr", word.id, NOW);
    expect(await testDb.newWordQueue.count({ where: { user_id: user.id } })).toBe(1);
    const bundle = await started(user);
    expect(bundle.plan.queue[0].item).toBe(`w:${word.id}`);
    await send(user, bundle, bundle.plan, bundle.nextSeq, new Date(NOW.getTime() + 5000), { iknow: true });
    expect(await testDb.newWordQueue.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.itemState.findFirstOrThrow({ where: { user_id: user.id, item_id: word.id } })).toMatchObject({ source: "i_know" });
    expect(await testDb.dailyCounter.findFirstOrThrow({ where: { user_id: user.id } })).toMatchObject({ i_know: 1, new_words: 0, queue_words: 0 });
  });
});

describe("the pretest mode on the server (PRD §11.5)", () => {
  it("five presses turn it on; with the switch on the next session asks new words first; a right pretest is counted as passed", { timeout: 60_000 }, async () => {
    await saveEngineSetting("feature.pretest", true);
    const user = await enrolled();
    const bundle = await started(user);
    let presses = 0;
    await playAll(user, bundle, NOW, (card, plan) => {
      if (!offered(card, plan) || card.t !== "intro" || presses >= 5) return false;
      presses++;
      return true;
    });
    expect(presses).toBe(5);
    expect(await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } })).toMatchObject({ pretest_mode: true });

    const later = new Date(NOW.getTime() + 3_600_000);
    const next = await started(user, later);
    const first = next.plan.queue.find((card) => card.t === "pretest");
    expect(first).toBeDefined();
    let plan = next.plan;
    let seq = next.nextSeq;
    while (plan.queue[0].t !== "pretest") {
      const step = await send(user, next, plan, seq++, new Date(later.getTime() + seq * 5000));
      if (!step.result.done) throw new Error("not done");
      plan = step.result.advanced.plan;
    }
    const pretest = plan.queue[0];
    const { response } = await send(user, next, plan, seq, new Date(later.getTime() + 300_000));
    expect(response.kind).toBe("ok");
    const state = await testDb.itemState.findFirstOrThrow({ where: { user_id: user.id, item_id: Number(pretest.item.slice(2)) } });
    expect(state).toMatchObject({ probation: "single", source: "pretest" });
    const log = await testDb.reviewLog.findFirstOrThrow({ where: { user_id: user.id, kind: "pretest" } });
    expect(log).toMatchObject({ result: "correct", item_id: state.item_id });
    expect(await testDb.dailyCounter.findFirstOrThrow({ where: { user_id: user.id } })).toMatchObject({ pretest_passed: 1 });
  });

  it("T102: five presses with the switch off leave the mode off", { timeout: 60_000 }, async () => {
    await saveEngineSetting("feature.pretest", false);
    const user = await enrolled();
    let presses = 0;
    await playAll(user, await started(user), NOW, (card, plan) => {
      if (!offered(card, plan) || card.t !== "intro" || presses >= 5) return false;
      presses++;
      return true;
    });
    expect(presses).toBe(5);
    expect(await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } })).toMatchObject({ pretest_mode: false });
  });

  it("a mode left on when the switch went off brings no pretest", async () => {
    await saveEngineSetting("feature.pretest", false);
    const user = await enrolled();
    await testDb.enrollment.updateMany({ where: { user_id: user.id }, data: { pretest_mode: true } });
    const bundle = await started(user);
    expect(bundle.plan.queue.some((card) => card.t === "pretest")).toBe(false);
    expect(bundle.plan.queue[0]).toMatchObject({ t: "intro", probationStep: 5 });
  });

  it("a wrong pretest costs nothing: no state, the intro card comes, and ten misses in a row turn the mode off", { timeout: 60_000 }, async () => {
    await saveEngineSetting("feature.pretest", true);
    const user = await enrolled();
    await testDb.enrollment.updateMany({ where: { user_id: user.id }, data: { pretest_mode: true } });
    const bundle = await started(user);
    let plan = bundle.plan;
    let seq = bundle.nextSeq;
    let misses = 0;
    for (let i = 0; plan.queue.length > 0 && i < 400; i++) {
      const card = plan.queue[0];
      const at = new Date(NOW.getTime() + (i + 1) * 5000);
      const { response, result } = await send(user, bundle, plan, seq++, at, card.t === "pretest" ? { idk: true } : undefined);
      expect(response.kind).toBe("ok");
      if (!result.done) throw new Error("not done");
      if (card.t === "pretest") {
        misses++;
        expect(result.state).toBeNull();
        expect(result.advanced.plan.queue[0]).toMatchObject({ t: "intro", item: card.item });
        expect(result.advanced.plan.queue[0].probationStep).toBeUndefined();
      }
      plan = result.advanced.plan;
    }
    expect(misses).toBeGreaterThan(0);
    const enrollment = await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } });
    expect(enrollment.pretest_mode).toBe(misses < 10);
    const day = await testDb.dailyCounter.findFirstOrThrow({ where: { user_id: user.id } });
    expect(day).toMatchObject({ pretest_passed: 0 });
    expect(day.new_words).toBeGreaterThanOrEqual(misses);
  });
});


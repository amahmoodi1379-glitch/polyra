import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RawAnswer } from "@/engine/ex";
import { playCard, shownEx } from "@/engine/session/play";
import type { Card } from "@/engine/session/types";
import { plusDays, tehranDate } from "@/engine/time";
import { loadDemo } from "@/server/content/demo";
import { submitAnswer } from "@/server/learn/answer";
import { forgetContent } from "@/server/learn/content";
import { startFromZero } from "@/server/learn/enroll";
import { acceptLevelDown } from "@/server/learn/leveldown";
import { startSession, type Bundle, type EndSummary } from "@/server/learn/session";
import { rightAnswer, textAnswers } from "../../fixtures/synthetic/drive";
import { productionAnswer } from "@/sim/answers";
import { seeded } from "@/engine/random";
import { resetDb, testDb } from "./db";

/**
 * The end messages of PRD §3.11 added with the level tools: «یک سطح پایین‌تر برویم؟» (row 1, §11.7, T75),
 * longer sessions for long texts (row 3) and the skip exam after the day's «این را بلدم» (row 4). The
 * French demo's second thirty card words are moved to A2.
 */

const NOW = new Date("2026-10-26T06:00:00Z");
let phones = 0;

type Person = { id: number; is_admin: boolean; is_tester: boolean; phone: string };

async function enrolled(minutes = 15): Promise<Person> {
  const phone = `+98912600${String(++phones).padStart(4, "0")}`;
  const user = await testDb.user.create({ data: { phone, session_length_min: minutes, is_tester: true } });
  const person = { id: user.id, is_admin: user.is_admin, is_tester: user.is_tester, phone };
  await startFromZero(person, "fr", NOW);
  return person;
}

async function started(user: Person, at = NOW): Promise<Bundle> {
  const result = await startSession(user, { language: "fr", scope: "mixed", noAudio: false, cap: "more" }, at);
  if (result.kind !== "session") throw new Error(`Expected a session, got ${result.kind}`);
  return result.bundle;
}

/** Plays the session with right answers; `pick` answers a card its own way. */
async function playAll(user: Person, bundle: Bundle, start = NOW, pick: (card: Card, plan: Bundle["plan"]) => RawAnswer | undefined = () => undefined): Promise<EndSummary | null> {
  let plan = bundle.plan;
  let seq = bundle.nextSeq;
  const lexicon = new Map(bundle.lexicon);
  for (let i = 0; plan.queue.length > 0 && i < 400; i++) {
    const at = new Date(start.getTime() + (i + 1) * 5000);
    const card = plan.queue[0];
    const ex = card.t === "intro" || card.t === "lesson" || card.t === "table" || card.t === "confusion" || card.t === "text" || card.t === "textwords" ? null : shownEx(plan, card);
    const raw = pick(card, plan) ?? (card.t === "text" ? textAnswers(plan, card, seeded(card.id), 1) : card.prod ? productionAnswer(card, seeded(card.id), 1) : ex ? rightAnswer(ex) : { seen: true });
    const result = playCard(plan, card.id, raw, { latencyMs: 4000, elapsedSec: 5 }, { ctx: { settings: bundle.settings, now: at, today: tehranDate(at), latency: plan.latency }, language: "fr", wordsWithLemma: (lemma) => lexicon.get(lemma) ?? [] });
    if (!result.done) throw new Error("not done");
    const response = await submitAnswer(user, { sessionId: bundle.id, answerId: randomUUID(), seq, cardId: card.id, answer: raw as Record<string, unknown>, latencyMs: 4000, elapsedSec: 5, at: at.toISOString(), shown: null }, at);
    if (response.kind !== "ok") throw new Error(`Answer ${seq}: ${response.kind}`);
    seq++;
    plan = result.advanced.plan;
    if (response.finished) return response.end;
  }
  throw new Error("The session did not finish");
}

const setting = (key: string, value: boolean) => testDb.engineSetting.upsert({ where: { key }, create: { key, value, default_value: false, description_fa: key }, update: { value } });
const level = (userId: number, skill: "vocab" | "grammar" | "listening" | "reading", value: string, knownBelow: string | null = value) =>
  testDb.skillLevel.updateMany({ where: { user_id: userId, skill }, data: { level: value, known_below: knownBelow } });

beforeAll(async () => {
  await resetDb();
  await testDb.language.createMany({ data: [{ code: "fr" }, { code: "de" }] });
  expect(await loadDemo()).toMatchObject({ kind: "loaded" });
  const words = await testDb.word.findMany({ where: { language: "fr", no_card: false }, orderBy: { intro_order: "asc" }, select: { id: true } });
  await testDb.word.updateMany({ where: { id: { in: words.slice(30).map((row) => row.id) } }, data: { level: "A2" } });
  forgetContent();
}, 120_000);

beforeEach(() => setting("feature.leveldown", false));

afterAll(() => testDb.$disconnect());

describe("«یک سطح پایین‌تر برویم؟» on the server (PRD §11.7)", () => {
  it("T75: vocabulary at A2 with 5 of 35 reviews right: the message first, «بله» puts it at A1, then not for 14 days", { timeout: 60_000 }, async () => {
    await setting("feature.leveldown", true);
    const user = await enrolled();
    await level(user.id, "vocab", "A2");
    const word = await testDb.word.findFirstOrThrow({ where: { language: "fr", level: "A1", no_card: false } });
    await testDb.reviewLog.createMany({
      data: Array.from({ length: 35 }, (_, i) => ({
        id: randomUUID(),
        user_id: user.id,
        language: "fr",
        kind: "review" as const,
        item_type: "word",
        item_id: word.id,
        result: i < 5 ? ("correct" as const) : ("wrong" as const),
        fsrs_rating: i < 5 ? 3 : 1,
        ts: plusDays(NOW, -2),
      })),
    });
    const bundle = await started(user);
    const end = await playAll(user, bundle);
    expect(end?.message).toEqual({ kind: "leveldown", skill: "vocab", from: "A2", to: "A1" });
    expect(await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } })).toMatchObject({ leveldown_asked_at: expect.any(Date) });
    expect(await acceptLevelDown(user, bundle.id, NOW)).toBe("done");
    expect(await testDb.skillLevel.findFirstOrThrow({ where: { user_id: user.id, skill: "vocab" } })).toMatchObject({ level: "A1", known_below: "A1" });
    // Once only; another person's session is not theirs to answer.
    expect(await acceptLevelDown(user, bundle.id, NOW)).toBe("gone");
    const other = await enrolled();
    expect(await acceptLevelDown(other, bundle.id, NOW)).toBe("gone");
    // Not again within 14 days, even if the condition still holds.
    await level(user.id, "vocab", "A2");
    const later = plusDays(NOW, 1);
    expect((await playAll(user, await started(user, later), later))?.message?.kind).not.toBe("leveldown");
  });

  it("with the switch off nobody is asked", { timeout: 60_000 }, async () => {
    const user = await enrolled();
    await level(user.id, "vocab", "A2");
    const word = await testDb.word.findFirstOrThrow({ where: { language: "fr", level: "A1", no_card: false } });
    await testDb.reviewLog.createMany({
      data: Array.from({ length: 35 }, () => ({ id: randomUUID(), user_id: user.id, language: "fr", kind: "review" as const, item_type: "word", item_id: word.id, result: "wrong" as const, fsrs_rating: 1, ts: plusDays(NOW, -2) })),
    });
    expect((await playAll(user, await started(user)))?.message?.kind).not.toBe("leveldown");
  });
});

describe("longer sessions for long texts (PRD §3.11 row 3)", () => {
  it("ten-minute sessions and listening at B1: asked once", { timeout: 60_000 }, async () => {
    const user = await enrolled(10);
    await level(user.id, "listening", "B1", null);
    expect((await playAll(user, await started(user)))?.message).toEqual({ kind: "longer", to: 15 });
    expect(await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } })).toMatchObject({ longer_asked_at: expect.any(Date) });
    const later = plusDays(NOW, 1);
    expect((await playAll(user, await started(user, later), later))?.message?.kind).not.toBe("longer");
  });

  it("not at fifteen minutes, nor below B1", { timeout: 60_000 }, async () => {
    const fifteen = await enrolled(15);
    await level(fifteen.id, "reading", "B1", null);
    expect((await playAll(fifteen, await started(fifteen)))?.message?.kind).not.toBe("longer");
    const ten = await enrolled(10);
    await level(ten.id, "reading", "A2", null);
    expect((await playAll(ten, await started(ten)))?.message?.kind).not.toBe("longer");
  });
});

describe("the skip exam after the day's «این را بلدم» (PRD §3.11 row 4)", () => {
  it("the tenth press in this session and the vocabulary exam on offer: the message with the skill", { timeout: 60_000 }, async () => {
    const user = await enrolled();
    await testDb.dailyCounter.create({ data: { user_id: user.id, language: "fr", date_tehran: new Date(`${tehranDate(NOW)}T00:00:00Z`), i_know: 9 } });
    let pressed = false;
    const end = await playAll(user, await started(user), NOW, (card, plan) => {
      if (pressed || card.t !== "intro" || !card.probationStep || (plan.counters.iknowLeft ?? 0) <= 0) return undefined;
      pressed = true;
      return { iknow: true };
    });
    expect(pressed).toBe(true);
    expect(end?.message).toEqual({ kind: "skipTest", skill: "vocab", next: "A2" });
    // A later session with no press that day does not repeat it.
    const later = new Date(NOW.getTime() + 3_600_000);
    expect((await playAll(user, await started(user, later), later))?.message?.kind).not.toBe("skipTest");
  });
});

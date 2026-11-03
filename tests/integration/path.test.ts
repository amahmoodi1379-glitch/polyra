import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RawAnswer } from "@/engine/ex";
import { playCard, shownEx } from "@/engine/session/play";
import type { Card } from "@/engine/session/types";
import { plusDays, tehranDate } from "@/engine/time";
import { loadDemo } from "@/server/content/demo";
import { submitAnswer } from "@/server/learn/answer";
import { forgetContent } from "@/server/learn/content";
import { startFromZero } from "@/server/learn/enroll";
import { homeData } from "@/server/learn/home";
import { startSession, type Bundle, type EndSummary } from "@/server/learn/session";
import { rightAnswer, textAnswers } from "../../fixtures/synthetic/drive";
import { productionAnswer } from "@/sim/answers";
import { seeded } from "@/engine/random";
import { resetDb, testDb } from "./db";

/**
 * The end of the path on the server (PRD §3.13, T103): with every skill at B2 and four of the demo's texts
 * moved to B2 and finished in both tracks, the next finished session ends with the celebration once,
 * `path_done_at` is written and the home shows the maintenance line with the language's text.
 */

const NOW = new Date("2026-10-28T06:00:00Z");
let phones = 0;

type Person = { id: number; is_admin: boolean; is_tester: boolean; phone: string };

async function enrolled(minutes = 15): Promise<Person> {
  const phone = `+98912700${String(++phones).padStart(4, "0")}`;
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

const level = (userId: number, skill: "vocab" | "grammar" | "listening" | "reading", value: string, knownBelow: string | null = value) =>
  testDb.skillLevel.updateMany({ where: { user_id: userId, skill }, data: { level: value, known_below: knownBelow } });

beforeAll(async () => {
  await resetDb();
  await testDb.language.createMany({ data: [{ code: "fr", coming_soon_fa: "ماژول‌های تخصصی به‌زودی می‌آیند." }, { code: "de" }] });
  expect(await loadDemo()).toMatchObject({ kind: "loaded" });
  const texts = await testDb.text.findMany({ where: { language: "fr" }, orderBy: { id: "asc" }, select: { id: true } });
  await testDb.text.updateMany({ where: { id: { in: texts.slice(0, 4).map((row) => row.id) } }, data: { level: "B2" } });
  forgetContent();
}, 120_000);

afterAll(() => testDb.$disconnect());

describe("the end of the path (PRD §3.13, T103)", () => {
  it("every skill at B2 and ready: the celebration once, path_done_at, then the maintenance line on the home", { timeout: 60_000 }, async () => {
    const user = await enrolled();
    for (const skill of ["vocab", "grammar", "listening", "reading"] as const) await level(user.id, skill, "B2");
    const b2 = await testDb.text.findMany({ where: { language: "fr", level: "B2" }, select: { id: true } });
    for (const text of b2) {
      for (const track of ["listening", "reading"] as const) {
        await testDb.textState.create({
          data: { user_id: user.id, text_id: text.id, track, attempts_done: 3, first_score: 0.9, scores: [{ attempt: 1, set: "A", score: 0.9, at: plusDays(NOW, -20).toISOString() }], last_attempt_at: plusDays(NOW, -5) },
        });
      }
    }
    expect((await homeData(user, "fr", NOW))!.pathDone).toBe(false);
    const end = await playAll(user, await started(user));
    expect(end?.pathDone).toMatchObject({ level: "B2", texts: 4 });
    expect(end?.message).toBeNull();
    expect((await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } })).path_done_at).toEqual(expect.any(Date));
    const home = (await homeData(user, "fr", NOW))!;
    expect(home).toMatchObject({ pathDone: true, comingSoon: "ماژول‌های تخصصی به‌زودی می‌آیند." });
    // Once: the next session ends as usual, and nothing is locked.
    const later = plusDays(NOW, 1);
    const next = await playAll(user, await started(user, later), later);
    expect(next?.pathDone ?? null).toBeNull();
  });

  it("a skill below B2: no celebration", { timeout: 60_000 }, async () => {
    const user = await enrolled();
    for (const skill of ["vocab", "grammar", "listening"] as const) await level(user.id, skill, "B2");
    const end = await playAll(user, await started(user));
    expect(end?.pathDone ?? null).toBeNull();
    expect((await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } })).path_done_at).toBeNull();
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newItemState } from "@/engine/answer";
import { hasCard } from "@/engine/content";
import type { RawAnswer } from "@/engine/ex";
import { emptyCard, rateCard, withDue } from "@/engine/fsrs";
import { playCard, shownEx } from "@/engine/session/play";
import type { Card, Scope } from "@/engine/session/types";
import type { ItemStateE, ItemType } from "@/engine/state";
import { plusDays, tehranDate } from "@/engine/time";
import { seeded } from "@/engine/random";
import { demoStatus, loadDemo, removeDemo } from "@/server/content/demo";
import { saveOrder } from "@/server/content/order";
import { previewItem } from "@/server/content/review/preview";
import { submitAnswer, sessionEnd } from "@/server/learn/answer";
import { forgetContent, loadContent } from "@/server/learn/content";
import { resetProgress, startFromZero } from "@/server/learn/enroll";
import { homeData } from "@/server/learn/home";
import { loadLearner } from "@/server/learn/learner";
import { myPhonics, myPhonicsLesson, myText, myTexts } from "@/server/learn/lists";
import { startSession, type Bundle } from "@/server/learn/session";
import { queueTappedWord } from "@/server/learn/tap";
import { saveTextProgress } from "@/server/learn/text-progress";
import { travelDays } from "@/server/learn/time-travel";
import { saveItemState } from "@/server/learn/writes";
import { engineSettings } from "@/server/settings/read";
import { rightAnswer, textAnswers } from "../../fixtures/synthetic/drive";
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

async function started(user: Person, now = NOW, scope: Scope = "mixed"): Promise<Bundle> {
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

/** Plays a whole session with right answers, five seconds a card; `pick` answers a card its own way. */
async function playAll(user: Person, bundle: Bundle, start = NOW, pick: (card: Card) => RawAnswer | undefined = () => undefined) {
  let plan = bundle.plan;
  let seq = bundle.nextSeq;
  for (let i = 0; plan.queue.length > 0 && i < 400; i++) {
    const at = new Date(start.getTime() + (i + 1) * 5000);
    const card = plan.queue[0];
    const { raw, result } = answerFor(bundle, plan, card, at, pick(card));
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

const LEARNER_TABLES = [
  "review_log",
  "session",
  "item_state",
  "notebook_entry",
  "new_word_queue",
  "daily_counter",
  "confusion_pair",
  "sentence_drill_state",
  "text_state",
  "phonics_state",
  "skill_level",
  "enrollment",
  "trial_ledger",
  "admin_log",
];

beforeAll(async () => {
  const rows = await testDb.$queryRawUnsafe<{ tablename: string }[]>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
  await testDb.$executeRawUnsafe(`TRUNCATE ${rows.map((row) => `"public"."${row.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await testDb.language.createMany({ data: [{ code: "fr" }, { code: "de" }] });
  const loaded = await loadDemo();
  expect(loaded).toMatchObject({ kind: "loaded", words: 60, units: 6, texts: 3, phonics: 3 });
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
    expect(await testDb.text.count({ where: { language: "fr", status: "approved" } })).toBe(3);
    expect(await testDb.question.count({ where: { language: "fr", status: { not: "approved" } } })).toBe(0);
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

  it("a session answered every five hours still ends a day after its build (PRD §10.8, §15.4 step 9)", async () => {
    const user = await enrolled();
    const bundle = await started(user);
    let plan = bundle.plan;
    let seq = bundle.nextSeq;
    for (const hours of [5, 10, 15, 20]) {
      const at = new Date(NOW.getTime() + hours * 3_600_000);
      const card = plan.queue[0];
      const { raw, result } = answerFor(bundle, plan, card, at);
      expect(await submitAnswer(user, request(bundle, seq++, card, raw, at), at)).toMatchObject({ kind: "ok" });
      plan = result.advanced.plan;
    }
    // The next answer, a day and an hour after the build, is dropped and the session ends at its day.
    const late = new Date(NOW.getTime() + 25 * 3_600_000);
    const { raw } = answerFor(bundle, plan, plan.queue[0], late);
    expect(await submitAnswer(user, request(bundle, seq, plan.queue[0], raw, late), late)).toEqual({ kind: "gone" });
    expect(await testDb.session.findUniqueOrThrow({ where: { id: bundle.id } })).toMatchObject({ end_reason: "expired", ended_at: new Date(NOW.getTime() + 24 * 3_600_000) });
    // «شروع» builds a new session instead of resuming the old one.
    expect((await started(user, late)).id).not.toBe(bundle.id);
  });

  it("a round left after two answers is not scored, but its wrong sentence goes to the notebook (PRD §6.5, rule 8)", async () => {
    const user = await enrolled();
    const unit = await testDb.grammarUnit.findFirstOrThrow({ where: { language: "fr" }, orderBy: { id: "asc" } });
    await learned(user.id, "grammar_unit", unit.id, { step: 2 });
    const bundle = await started(user, NOW, "grammar");
    let plan = bundle.plan;
    let seq = bundle.nextSeq;
    const first = plan.queue.findIndex((card) => card.t === "round" && card.item === `u:${unit.id}`);
    expect(first).toBeGreaterThan(-1);
    for (let i = 0; i < first + 2; i++) {
      const card = plan.queue[0];
      const at = new Date(NOW.getTime() + (i + 1) * 5000);
      // The round's first question is answered with «نمی‌دانم», the second right.
      const { raw, result } = answerFor(bundle, plan, card, at, i === first ? { idk: true } : undefined);
      expect(await submitAnswer(user, request(bundle, seq++, card, raw, at), at)).toMatchObject({ kind: "ok" });
      plan = result.advanced.plan;
    }
    const wrong = shownEx(bundle.plan, bundle.plan.queue[first])!;
    expect(wrong.targetId).not.toBeNull();

    await startSession(user, { language: "fr", scope: "vocab", noAudio: false, cap: null }, new Date(NOW.getTime() + 600_000));
    expect((await testDb.session.findUniqueOrThrow({ where: { id: bundle.id } })).end_reason).toBe("replaced");
    const state = await testDb.itemState.findFirstOrThrow({ where: { user_id: user.id, item_type: "grammar_unit", item_id: unit.id } });
    expect(state).toMatchObject({ step: 2, rounds_count: 0 });
    const notes = await testDb.notebookEntry.findMany({ where: { user_id: user.id } });
    expect(notes.map((note) => [note.ref_type, note.ref_id])).toEqual([["grammar_target", wrong.targetId]]);
  });
});

describe("pace (PRD §9.10, «سرعت کم»)", () => {
  it("a round counts by its own result, not by its last question", async () => {
    const user = await enrolled();
    const settings = await engineSettings();
    // A passed round whose last question was wrong, a failed round whose last question was right, and a first typing.
    const row = (rating: number, result: "correct" | "wrong", firstTyping = false) => ({
      id: randomUUID(),
      user_id: user.id,
      language: "fr",
      kind: "review" as const,
      item_type: "grammar_unit",
      item_id: 1,
      result,
      fsrs_rating: rating,
      first_typing: firstTyping,
      ts: plusDays(NOW, -1),
    });
    await testDb.reviewLog.createMany({ data: [row(3, "wrong"), row(1, "correct"), row(2, "wrong", true)] });
    const learner = await loadLearner(testDb, user.id, "fr", "A1", NOW, tehranDate(NOW), settings);
    expect(learner?.paceReviews.map((review) => review.ok).sort()).toEqual([false, true]);
  });
});

describe("the end screen's one message (PRD §3.11)", () => {
  it("offers shorter sessions after three left in a row, and says pace went slow at the next end", async () => {
    const user = await enrolled();
    await testDb.user.update({ where: { id: user.id }, data: { session_length_min: 30 } });
    const before = (minutes: number, scope: "mixed" | "vocab" | "quick", end_reason: "expired" | "replaced" | "finished", doneCount: number) =>
      testDb.session.create({
        data: {
          user_id: user.id,
          language: "fr",
          scope,
          planned_length_min: 30,
          plan: { doneCount, plannedCount: 20 },
          created_at: new Date(NOW.getTime() - minutes * 60_000),
          ended_at: new Date(NOW.getTime() - (minutes - 10) * 60_000),
          end_reason,
        },
      });
    await before(300, "mixed", "expired", 2);
    await before(200, "vocab", "replaced", 0);
    // «امروز وقت کم دارم» neither counts nor breaks the run.
    await before(150, "quick", "finished", 20);
    await before(100, "mixed", "expired", 9);
    // Forty wrong reviews this week: the next build goes to slow pace (PRD §9.10).
    await testDb.reviewLog.createMany({
      data: Array.from({ length: 40 }, () => ({
        id: randomUUID(),
        user_id: user.id,
        language: "fr",
        kind: "review" as const,
        item_type: "word",
        item_id: 1,
        result: "wrong" as const,
        fsrs_rating: 1,
        ts: plusDays(NOW, -1),
      })),
    });
    const enrollment = () => testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } });

    // Shorter sessions come first; the slow-pace note waits for the next end.
    expect((await playAll(user, await started(user)))?.message).toEqual({ kind: "shorter", from: 30, to: 20 });
    expect(await enrollment()).toMatchObject({ pace_mode: "slow", slow_notice_due: true, shorten_asked_at: expect.any(Date) });

    const later = plusDays(NOW, 1);
    expect((await playAll(user, await started(user, later), later))?.message).toEqual({ kind: "slowPace" });
    expect((await enrollment()).slow_notice_due).toBe(false);

    const after = plusDays(NOW, 2);
    expect((await playAll(user, await started(user, after), after))?.message).toBeNull();
  }, 60_000);
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

describe("a touched word (PRD §5.9)", () => {
  it("goes to the new-word queue once, only when unknown, standard and in a level the learner may see", async () => {
    const user = await enrolled();
    const words = await testDb.word.findMany({ where: { language: "fr", no_card: false, register: "standard" }, orderBy: { intro_order: "asc" }, select: { id: true } });
    const [fresh, known] = [words.at(-1)!.id, words.at(-2)!.id];
    await learned(user.id, "word", known);

    expect(await queueTappedWord(user, "fr", fresh, NOW)).toBe(true);
    expect(await queueTappedWord(user, "fr", fresh, NOW)).toBe(false);
    expect(await queueTappedWord(user, "fr", known, NOW)).toBe(false);
    expect(await testDb.newWordQueue.findMany({ where: { user_id: user.id }, select: { word_id: true, source: true } })).toEqual([{ word_id: fresh, source: "tap" }]);

    // A no_card word, and a word below the learner's known level, are known already (PRD §5.7).
    const noCard = await testDb.word.findFirstOrThrow({ where: { language: "fr", no_card: true }, select: { id: true } });
    expect(await queueTappedWord(user, "fr", noCard.id, NOW)).toBe(false);
    const below = words.at(-3)!.id;
    expect((await testDb.word.findUniqueOrThrow({ where: { id: below } })).level).toBe("A1");
    expect(await testDb.skillLevel.updateMany({ where: { user_id: user.id, skill: "vocab" }, data: { known_below: "A2" } })).toEqual({ count: 1 });
    expect(await queueTappedWord(user, "fr", below, NOW)).toBe(false);

    // The demo is approved, not released: a learner who is not a tester does not see it; nor does someone who has not started French.
    const learner = await enrolled({});
    expect(await queueTappedWord(learner, "fr", fresh, NOW)).toBe(false);
    const stranger = await person({ is_tester: true });
    expect(await queueTappedWord(stranger, "fr", fresh, NOW)).toBe(false);
  });

  it("comes first in the next session and keeps «tap» as its source", async () => {
    const user = await enrolled();
    const words = await testDb.word.findMany({ where: { language: "fr", no_card: false, register: "standard" }, orderBy: { intro_order: "asc" }, select: { id: true } });
    const fresh = words.at(-1)!.id;
    expect(await queueTappedWord(user, "fr", fresh, NOW)).toBe(true);
    const bundle = await started(user);
    expect(bundle.plan.queue.find((card) => card.t === "intro")?.item).toBe(`w:${fresh}`);
    await playAll(user, bundle);
    expect(await testDb.itemState.findFirstOrThrow({ where: { user_id: user.id, item_type: "word", item_id: fresh } })).toMatchObject({ source: "tap" });
    expect(await testDb.newWordQueue.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.dailyCounter.findFirstOrThrow({ where: { user_id: user.id } })).toMatchObject({ queue_words: 1 });
  });
});

describe("sentence listening (PRD §7.6)", () => {
  it("opens the listening button, and each showing counts once, right or wrong", async () => {
    const user = await enrolled();
    const closed = await homeData(user, "fr", NOW);
    expect(closed!.skills.find((tile) => tile.skill === "listening")!.lock).toEqual({ kind: "words", need: 30, left: 30 });
    expect((await startSession(user, { language: "fr", scope: "listening", noAudio: false, cap: null }, NOW)).kind).toBe("nothing_left");

    const words = await testDb.word.findMany({ where: { language: "fr", no_card: false }, select: { id: true } });
    for (const { id } of words) await learned(user.id, "word", id, { dueInDays: 5 });
    const home = await homeData(user, "fr", NOW);
    const tile = home!.skills.find((item) => item.skill === "listening")!;
    expect(tile.lock).toBeNull();

    // The demo's texts aside (as if a placement test had used them), the session is sentence drills only.
    const texts = await testDb.text.findMany({ where: { language: "fr" }, select: { id: true } });
    await testDb.textState.createMany({ data: texts.map((text) => ({ user_id: user.id, text_id: text.id, track: "listening" as const, used_in_test: true })) });
    const bundle = await started(user, NOW, "listening");
    expect(bundle.plan.queue.length).toBeGreaterThan(0);
    expect(bundle.plan.queue.every((card) => card.t === "drill" && card.ex?.code === "L1")).toBe(true);
    const card = bundle.plan.queue[0];
    const at = new Date(NOW.getTime() + 5000);
    const { raw } = answerFor(bundle, bundle.plan, card, at, { idk: true });
    const body = request(bundle, bundle.nextSeq, card, raw, at);
    expect(await submitAnswer(user, body, at)).toMatchObject({ kind: "ok" });
    expect(await submitAnswer(user, body, new Date(at.getTime() + 1000))).toEqual({ kind: "duplicate" });
    const sentenceId = card.ex!.sentenceId!;
    expect(await testDb.sentenceDrillState.findMany({ where: { user_id: user.id }, select: { sentence_id: true, count: true } })).toEqual([{ sentence_id: sentenceId, count: 1 }]);
    expect(await testDb.reviewLog.findUniqueOrThrow({ where: { id: body.answerId } })).toMatchObject({
      kind: "drill",
      item_type: null,
      item_id: null,
      exercise_code: "L1",
      sentence_id: sentenceId,
      result: "idk",
      fsrs_rating: null,
    });
    // No item moved and nothing went to the notebook.
    expect(await testDb.notebookEntry.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.itemState.count({ where: { user_id: user.id, step: { not: 2 } } })).toBe(0);

    // The snapshot carries it: the sentence waits three days, then comes as L2.
    const settings = await engineSettings();
    const later = plusDays(NOW, 4);
    const snapshot = await loadLearner(testDb, user.id, "fr", "A1", later, tehranDate(later), settings);
    expect(snapshot!.drills).toEqual([{ sentenceId, count: 1, lastAt: at.toISOString() }]);
  });
});

/** A tester who knows every demo word: the reading track opens with the demo's A1 texts (PRD §7.5). */
async function reader() {
  const user = await enrolled();
  const words = await testDb.word.findMany({ where: { language: "fr", no_card: false }, select: { id: true } });
  for (const { id } of words) await learned(user.id, "word", id, { dueInDays: 5 });
  return user;
}

/** Answers the cards before the session's text («کلمه‌های این متن» included) and returns the text card. */
async function toText(user: Person, bundle: Bundle, start: Date) {
  let plan = bundle.plan;
  let seq = bundle.nextSeq;
  let at = start;
  while (plan.queue[0] && plan.queue[0].t !== "text") {
    at = new Date(at.getTime() + 5000);
    const { raw, result } = answerFor(bundle, plan, plan.queue[0], at);
    expect(await submitAnswer(user, request(bundle, seq++, plan.queue[0], raw, at), at)).toMatchObject({ kind: "ok" });
    plan = result.advanced.plan;
  }
  return { plan, seq, at, card: plan.queue[0] };
}

describe("texts (PRD §7.3–7.5, §7.9, §10.11)", () => {
  it("a first round left half-way keeps its answers, goes on in another session, and the text then opens in «متن‌های من»", async () => {
    const user = await reader();
    const home = await homeData(user, "fr", NOW);
    expect(home!.skills.find((tile) => tile.skill === "reading")!.text).toBe("new");
    expect(home!.links.texts).toBe(0);

    const bundle = await started(user, NOW, "reading");
    const { plan, card, at } = await toText(user, bundle, NOW);
    expect(card.text).toMatchObject({ track: "reading", attempt: 1, stage: "first", set: "A", resume: null });
    const textId = card.text!.textId;
    const first = plan.texts[textId].questions.A[0];
    const right = (textAnswers(plan, card, seeded("t"), 1) as { answers: Record<string, unknown> }).answers;

    // One answer given, then the learner leaves: the place is kept on the card and in text_state (PRD §7.4).
    const noted = { sessionId: bundle.id, cardId: card.id, answers: { [first.id]: right[first.id] } as never, plays: 0, positionMs: 41_000 };
    expect(await saveTextProgress(user, noted, at)).toBe("ok");
    expect(await saveTextProgress(user, { ...noted, cardId: "another" }, at)).toBe("gone");
    const kept = await testDb.textState.findUniqueOrThrow({ where: { user_id_text_id_track: { user_id: user.id, text_id: textId, track: "reading" } } });
    expect(kept).toMatchObject({ attempts_done: 0, first_score: null, partial: { attempt: 1, stage: "first", answers: { [first.id]: right[first.id] }, positionMs: 41_000 } });
    expect(kept.partial_until).toEqual(new Date(at.getTime() + 24 * 3_600_000));

    // A mixed session two hours later replaces the reading one and starts with the same round where it was (T91).
    const later = new Date(NOW.getTime() + 2 * 3_600_000);
    const again = await started(user, later, "mixed");
    expect(await testDb.session.findUniqueOrThrow({ where: { id: bundle.id } })).toMatchObject({ end_reason: "replaced" });
    const resumed = again.plan.queue.find((item) => item.t === "text")!;
    expect(again.plan.queue[0].id).toBe(resumed.id);
    expect(resumed.text).toMatchObject({ textId, stage: "first", resume: { answers: { [first.id]: right[first.id] }, positionMs: 41_000 } });

    // The first round with every answer right, then the round with help: attempt 1 is done (T34, band 1).
    const step = async (bundleNow: Bundle, planNow: Bundle["plan"], seq: number, when: Date) => {
      const textCard = planNow.queue[0];
      const raw = textAnswers(planNow, textCard, seeded("t"), 1);
      const { result } = answerFor(bundleNow, planNow, textCard, when, raw);
      expect(await submitAnswer(user, request(bundleNow, seq, textCard, raw, when), when)).toMatchObject({ kind: "ok" });
      return result.advanced.plan;
    };
    const afterFirst = await step(again, again.plan, again.nextSeq, new Date(later.getTime() + 60_000));
    expect(afterFirst.queue[0].text).toMatchObject({ textId, stage: "help" });
    const firstState = await testDb.textState.findUniqueOrThrow({ where: { user_id_text_id_track: { user_id: user.id, text_id: textId, track: "reading" } } });
    expect(firstState).toMatchObject({ attempts_done: 0, first_score: 1, partial: { stage: "help" } });
    const logged = await testDb.reviewLog.findMany({ where: { user_id: user.id, item_type: "text", item_id: textId } });
    expect(logged).toHaveLength(plan.texts[textId].questions.A.length);
    expect(logged.every((row) => row.question_set === "A" && row.result === "correct")).toBe(true);

    // «متن‌های من» lists a text from its first round (PRD §7.9); a reading text shows at once.
    expect(await myTexts(user, "fr")).toEqual([expect.objectContaining({ id: textId, tracks: ["reading"] })]);
    const open = await myText(user, "fr", textId);
    expect(open).toMatchObject({ listenFirst: false, view: { id: textId, track: "reading", questions: { A: [], B: [] } } });
    expect(open!.view.sentences.length).toBeGreaterThan(0);

    const doneAt = new Date(later.getTime() + 120_000);
    await step(again, afterFirst, again.nextSeq + 1, doneAt);
    const done = await testDb.textState.findUniqueOrThrow({ where: { user_id_text_id_track: { user_id: user.id, text_id: textId, track: "reading" } } });
    expect(done).toMatchObject({ attempts_done: 1, first_score: 1, partial: null, partial_until: null });
    expect(done.next_attempt_at).toEqual(new Date(doneAt.getTime() + 3 * 86_400_000));
    expect((await homeData(user, "fr", doneAt))!.links.texts).toBe(1);

    // Reading «متن‌های من» writes nothing.
    const logs = await testDb.reviewLog.count({ where: { user_id: user.id } });
    await myTexts(user, "fr");
    await myText(user, "fr", textId);
    expect(await testDb.reviewLog.count({ where: { user_id: user.id } })).toBe(logs);
    // Another learner's text, or one never started, is not there.
    expect(await myText(await reader(), "fr", textId)).toBeNull();
    const other = await testDb.text.findFirstOrThrow({ where: { language: "fr", id: { not: textId } }, select: { id: true } });
    expect(await myText(user, "fr", other.id)).toBeNull();
  });

  it("a listening text with an attempt still to come waits for a full play in «متن‌های من»; after its last attempt it does not", async () => {
    const user = await reader();
    const text = await testDb.text.findFirstOrThrow({ where: { language: "fr" }, select: { id: true } });
    const scores = [{ attempt: 1, set: "A", score: 0.75, at: NOW.toISOString() }];
    await testDb.textState.create({ data: { user_id: user.id, text_id: text.id, track: "listening", attempts_done: 1, first_score: 0.75, scores, last_attempt_at: NOW, next_attempt_at: plusDays(NOW, 3) } });
    expect(await myText(user, "fr", text.id)).toMatchObject({ listenFirst: true, view: { track: "listening" } });
    // Band 1 has two attempts: after the second, the text shows at once.
    await testDb.textState.update({
      where: { user_id_text_id_track: { user_id: user.id, text_id: text.id, track: "listening" } },
      data: { attempts_done: 2, scores: [...scores, { attempt: 2, set: "B", score: 1, at: plusDays(NOW, 3).toISOString() }], next_attempt_at: null },
    });
    expect(await myText(user, "fr", text.id)).toMatchObject({ listenFirst: false });
    // A half-way attempt with no stage done is not there yet.
    const fresh = await reader();
    await testDb.textState.create({ data: { user_id: fresh.id, text_id: text.id, track: "listening", partial: { attempt: 1, stage: "first", answers: {}, plays: 1, positionMs: 0 }, partial_until: plusDays(NOW, 1) } });
    expect(await myTexts(fresh, "fr")).toEqual([]);
  });

  it("shows the panel's reviewer every screen of a text: its words, then each stage of each attempt in both tracks", async () => {
    const text = await testDb.text.findFirstOrThrow({ where: { language: "fr", code: "fr-a1-t001" }, select: { id: true } });
    const preview = await previewItem("texts", "fr", text.id);
    if (preview.state !== "ready") throw new Error(preview.reason);
    const stages = preview.screens.flatMap((screen) => (screen.kind === "text" ? [`${screen.info.track} ${screen.info.attempt} ${screen.info.stage} ${screen.info.set}`] : []));
    // Band 1: two attempts (PRD §7.4, T34).
    expect(stages).toEqual(["listening 1 first A", "listening 1 help A", "listening 2 again B", "reading 1 first A", "reading 1 help A", "reading 2 again B"]);
    expect(preview.screens[0].kind).toBe("textwords");
  });

  it("asks before a text longer than the session; «بعداً» builds without it and is kept for the day, «شروع» brings it (PRD §10.4, §10.11)", async () => {
    const user = await reader();
    await testDb.user.update({ where: { id: user.id }, data: { session_length_min: 1 } });
    const ask = await startSession(user, { language: "fr", scope: "reading", noAudio: false, cap: null }, NOW);
    expect(ask).toMatchObject({ kind: "ask_text_session", track: "reading" });
    expect((ask as { minutes: number }).minutes).toBeGreaterThan(1);

    const later = await startSession(user, { language: "fr", scope: "reading", noAudio: false, cap: null, text: "later" }, NOW);
    expect(later.kind).toBe("nothing_left");
    expect(await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id }, select: { text_prompt_date: true } })).toEqual({ text_prompt_date: new Date(`${tehranDate(NOW)}T00:00:00Z`) });
    expect(await testDb.textState.count({ where: { user_id: user.id } })).toBe(0);

    const yes = await startSession(user, { language: "fr", scope: "reading", noAudio: false, cap: null, text: "confirmed" }, NOW);
    expect(yes.kind).toBe("session");
    const bundle = (yes as { bundle: Bundle }).bundle;
    expect(bundle.plan.queue.some((card) => card.t === "text" && card.text?.textId === (ask as { textId: number }).textId)).toBe(true);
  });
});

describe("phonics (PRD §8)", () => {
  const lessons = () => testDb.phonicsLesson.findMany({ where: { language: "fr" }, orderBy: { order_no: "asc" } });
  const enrollmentOf = (user: Person) => testDb.enrollment.findUniqueOrThrow({ where: { user_id_language: { user_id: user.id, language: "fr" } } });

  it("T22 on the server: from zero the round comes after the first items, is written, and «الفبا و تلفظ» moves on", async () => {
    const user = await enrolled();
    expect(await enrollmentOf(user)).toMatchObject({ phonics_auto: true, phonics_skips: 0 });
    const [first, second, third] = await lessons();
    expect((await homeData(user, "fr", NOW))?.links.phonics).toEqual({ index: 1, total: 3, done: false });

    const bundle = await started(user);
    expect(bundle.plan.queue.findIndex((card) => card.t === "phonics")).toBeGreaterThan(2);
    expect(bundle.plan.phonics).toMatchObject({ lessonId: first.id, round: 1, auto: true });
    expect(bundle.plan.queue.filter((card) => card.t === "phonicsq")).toHaveLength(6);
    await playAll(user, bundle);

    expect(await testDb.phonicsState.findMany({ where: { user_id: user.id }, select: { lesson_id: true, rounds_done: true, last_score: true, done: true } })).toEqual([
      { lesson_id: first.id, rounds_done: 1, last_score: 1, done: false },
    ]);
    expect(await testDb.reviewLog.count({ where: { user_id: user.id, kind: "phonics" } })).toBe(6);
    expect((await homeData(user, "fr", NOW))?.links.phonics).toEqual({ index: 2, total: 3, done: false });
    const overview = await myPhonics(user, "fr", NOW);
    expect(overview.lessons.map((lesson) => lesson.state)).toEqual(["tomorrow", "next", "closed"]);
    expect(overview.next).toEqual({ no: 2, round: 1 });
    // Round 2 from the next Tehran day, before the next lesson.
    expect((await myPhonics(user, "fr", plusDays(NOW, 1))).next).toEqual({ no: 1, round: 2 });
    // An opened lesson reads again whole; one not opened does not.
    expect(await myPhonicsLesson(user, "fr", first.id)).toMatchObject({ lessonId: first.id, index: 1, total: 3, kind: "rule" });
    expect((await myPhonicsLesson(user, "fr", first.id))?.words).toHaveLength(8);
    expect(await myPhonicsLesson(user, "fr", second.id)).toBeNull();
    expect(await myPhonicsLesson(user, "fr", third.id)).toBeNull();
  });

  it("T74 on the server: three «بعداً» in a row turn the auto rounds off with the end message once; the module stays open", async () => {
    const user = await enrolled();
    let end = null;
    for (let day = 0; day < 3; day++) {
      const at = plusDays(NOW, day);
      const bundle = await started(user, at);
      expect(bundle.plan.phonics?.auto).toBe(true);
      end = await playAll(user, bundle, at, (card) => (card.t === "phonics" ? { skip: "later" } : undefined));
      if (day < 2) expect(end?.message).toBeNull();
    }
    expect(end?.message).toEqual({ kind: "phonicsOff" });
    expect(await enrollmentOf(user)).toMatchObject({ phonics_auto: false, phonics_skips: 3, phonics_off_due: false });
    expect(await testDb.phonicsState.count({ where: { user_id: user.id } })).toBe(0);
    const after = await started(user, plusDays(NOW, 3));
    expect(after.plan.queue.some((card) => card.t === "phonics")).toBe(false);
    expect((await homeData(user, "fr", plusDays(NOW, 3)))?.links.phonics).toEqual({ index: 1, total: 3, done: false });
  }, 60_000);

  it("«الفبا و تلفظ» builds the round alone, not without sound; a round left without sound writes nothing and counts no «بعداً»", async () => {
    const user = await enrolled();
    expect(await startSession(user, { language: "fr", scope: "phonics", noAudio: true, cap: null }, NOW)).toEqual({ kind: "needs_audio" });
    const bundle = await started(user, NOW, "phonics");
    expect(bundle.plan.queue.map((card) => card.t)).toEqual(["phonics", ...Array(6).fill("phonicsq")]);
    expect(bundle.plan.phonics?.auto).toBe(false);
    let plan = bundle.plan;
    for (const [seq, raw] of [{ seen: true }, { idk: true }, { skip: "drop" }].entries()) {
      const at = new Date(NOW.getTime() + (seq + 1) * 5000);
      const card = plan.queue[0];
      const { result } = answerFor(bundle, plan, card, at, raw as RawAnswer);
      expect(await submitAnswer(user, request(bundle, bundle.nextSeq + seq, card, raw as RawAnswer, at), at)).toMatchObject({ kind: "ok", finished: seq === 2 });
      plan = result.advanced.plan;
    }
    expect(await testDb.phonicsState.count({ where: { user_id: user.id } })).toBe(0);
    expect(await enrollmentOf(user)).toMatchObject({ phonics_auto: true, phonics_skips: 0 });
    expect(await testDb.reviewLog.findMany({ where: { user_id: user.id }, orderBy: { seq: "asc" }, select: { kind: true, result: true, raw_answer: true } })).toEqual([
      { kind: "intro", result: "correct", raw_answer: null },
      { kind: "phonics", result: "idk", raw_answer: "" },
      { kind: "intro", result: "idk", raw_answer: "drop" },
    ]);
  });

  it("refuses a start or a question's answer that is not its own", async () => {
    const user = await enrolled();
    const bundle = await started(user, NOW, "phonics");
    const lead = bundle.plan.queue[0];
    expect(await submitAnswer(user, request(bundle, bundle.nextSeq, lead, { choice: "o0" }, NOW), NOW)).toEqual({ kind: "invalid" });
    const { result } = answerFor(bundle, bundle.plan, lead, NOW);
    await submitAnswer(user, request(bundle, bundle.nextSeq, lead, { seen: true }, NOW), NOW);
    const question = result.advanced.plan.queue[0];
    expect(await submitAnswer(user, request(bundle, bundle.nextSeq + 1, question, { skip: "later" }, NOW), NOW)).toEqual({ kind: "invalid" });
  });

  it("shows the panel's reviewer both rounds with every sound to hear", async () => {
    const [rule, contrast, liaison] = await lessons();
    const kinds = async (id: number) => {
      const preview = await previewItem("phonics", "fr", id);
      if (preview.state !== "ready") throw new Error(preview.reason);
      return preview.screens.map((screen) => (screen.kind === "exercise" ? screen.ex.code : screen.kind));
    };
    expect(await kinds(rule.id)).toEqual(["phonics", ...Array(6).fill("P1"), "phonics", ...Array(6).fill("P1")]);
    expect(await kinds(contrast.id)).toEqual(["phonics", "P1", "P4", "P1", "P4", "P1", "P4", "phonics", "P2", "P3", "P2", "P3", "P2", "P3"]);
    expect(await kinds(liaison.id)).toEqual(["phonics", ...Array(4).fill("P5"), "phonics", ...Array(4).fill("P5")]);
    const preview = await previewItem("phonics", "fr", contrast.id);
    if (preview.state !== "ready" || preview.screens[0].kind !== "phonics") throw new Error("no lesson screen");
    expect(preview.screens[0].view).toMatchObject({ words: { length: 8 }, pairs: { length: 6 } });
  });

  it("a tester's reset takes the phonics states with the rest", async () => {
    const user = await enrolled();
    await playAll(user, await started(user, NOW, "phonics"));
    expect(await testDb.phonicsState.count({ where: { user_id: user.id } })).toBe(1);
    await resetProgress(user, "fr");
    expect(await testDb.phonicsState.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.enrollment.count({ where: { user_id: user.id } })).toBe(0);
  });
});

describe("moving time for a test account", () => {
  it("moves every date of this language back, so the next session is days later", async () => {
    const user = await enrolled();
    await playAll(user, await started(user));
    const before = await testDb.itemState.findMany({ where: { user_id: user.id }, orderBy: { id: "asc" } });
    const enrollment = await testDb.enrollment.findUniqueOrThrow({ where: { user_id_language: { user_id: user.id, language: "fr" } } });
    const day = await testDb.dailyCounter.findFirstOrThrow({ where: { user_id: user.id } });
    const later = new Date(NOW.getTime() + 3_600_000);

    await travelDays(user, "fr", 3, later);

    const after = await testDb.itemState.findMany({ where: { user_id: user.id }, orderBy: { id: "asc" } });
    const days = (a: string, b: string) => (Date.parse(a) - Date.parse(b)) / 86_400_000;
    for (const [i, row] of after.entries()) {
      const was = before[i].fsrs as { due: string };
      expect(days(was.due, (row.fsrs as { due: string }).due)).toBe(3);
      expect(before[i].introduced_at!.getTime() - row.introduced_at!.getTime()).toBe(3 * 86_400_000);
    }
    const moved = await testDb.enrollment.findUniqueOrThrow({ where: { id: enrollment.id } });
    expect(enrollment.streak_last_date!.getTime() - moved.streak_last_date!.getTime()).toBe(3 * 86_400_000);
    const movedDay = await testDb.dailyCounter.findUniqueOrThrow({ where: { id: day.id } });
    expect(day.date_tehran.getTime() - movedDay.date_tehran.getTime()).toBe(3 * 86_400_000);
    expect((await testDb.reviewLog.findFirstOrThrow({ where: { user_id: user.id } })).ts.getTime()).toBeLessThan(NOW.getTime() - 2 * 86_400_000);

    // Reviews are due now, and the next session is built as if three days had passed.
    const next = await started(user, later);
    expect(next.plan.queue.length).toBeGreaterThan(0);
  });

  it("closes an open session first and leaves other accounts alone", async () => {
    const user = await enrolled();
    const other = await enrolled();
    await started(user);
    await playAll(other, await started(other));
    const otherBefore = await testDb.itemState.findMany({ where: { user_id: other.id }, orderBy: { id: "asc" } });
    await travelDays(user, "fr", 1, NOW);
    expect(await testDb.session.count({ where: { user_id: user.id, ended_at: null } })).toBe(0);
    expect(await testDb.itemState.findMany({ where: { user_id: other.id }, orderBy: { id: "asc" } })).toEqual(otherBefore);
  });

  it("is only for test accounts and the steps on the page", async () => {
    const learner = await enrolled({});
    await expect(travelDays(learner, "fr", 1)).rejects.toThrow();
    const tester = await enrolled();
    await expect(travelDays(tester, "fr", 2)).rejects.toThrow();
  });
});

describe("removing the demo", () => {
  it("takes out the content and what testers did with it", async () => {
    const user = await enrolled();
    await playAll(user, await started(user));
    expect(await testDb.itemState.count({ where: { user_id: user.id } })).toBeGreaterThan(0);
    expect(await testDb.phonicsState.count({ where: { user_id: user.id } })).toBe(1);
    expect(await removeDemo()).toEqual({ removed: true });
    expect(await testDb.phonicsState.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.phonicsLesson.count({ where: { language: "fr" } })).toBe(0);
    expect(await demoStatus()).toMatchObject({ loaded: false, words: 0 });
    expect(await testDb.word.count({ where: { language: "fr" } })).toBe(0);
    expect(await testDb.itemState.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.importBatch.count()).toBe(0);
    expect(await removeDemo()).toEqual({ removed: false });
  });
});

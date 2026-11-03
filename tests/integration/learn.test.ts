import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { newItemState } from "@/engine/answer";
import { hasCard } from "@/engine/content";
import type { RawAnswer } from "@/engine/ex";
import { emptyCard, rateCard, withDue } from "@/engine/fsrs";
import { playCard, shownEx } from "@/engine/session/play";
import type { Card, Scope } from "@/engine/session/types";
import type { ItemStateE, ItemType } from "@/engine/state";
import { num } from "@/engine/settings";
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
import { myWritings, saveWriting, tickWriting, writingCard } from "@/server/learn/writing";
import { engineSettings } from "@/server/settings/read";
import { rightAnswer, textAnswers } from "../../fixtures/synthetic/drive";
import { productionAnswer } from "@/sim/answers";
import type { InstallState } from "@/components/learn/install";
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
  const raw = answer ?? (card.t === "text" ? textAnswers(plan, card, seeded(card.id), 1) : card.prod ? productionAnswer(card, seeded(card.id), 1) : ex ? rightAnswer(ex) : { seen: true });
  const lexicon = new Map(bundle.lexicon);
  const ctx = { settings: bundle.settings, now: at, today: tehranDate(at), latency: plan.latency };
  const result = playCard(plan, card.id, raw, { latencyMs: 5000, elapsedSec: 5 }, { ctx, language: "fr", wordsWithLemma: (lemma) => lexicon.get(lemma) ?? [] });
  if (!result.done) throw new Error("The card was not finished");
  return { raw, result };
}

const request = (bundle: Bundle, seq: number, card: Card, raw: RawAnswer, at: Date, answerId = randomUUID(), device?: InstallState) => ({
  sessionId: bundle.id,
  answerId,
  seq,
  cardId: card.id,
  answer: raw as Record<string, unknown>,
  latencyMs: 5000,
  elapsedSec: 5,
  at: at.toISOString(),
  shown: null,
  device,
});

/** Plays a whole session with right answers, five seconds a card; `pick` answers a card its own way. */
async function playAll(user: Person, bundle: Bundle, start = NOW, pick: (card: Card) => RawAnswer | undefined = () => undefined, device?: InstallState) {
  let plan = bundle.plan;
  let seq = bundle.nextSeq;
  for (let i = 0; plan.queue.length > 0 && i < 400; i++) {
    const at = new Date(start.getTime() + (i + 1) * 5000);
    const card = plan.queue[0];
    const { raw, result } = answerFor(bundle, plan, card, at, pick(card));
    const response = await submitAnswer(user, request(bundle, seq, card, raw, at, randomUUID(), device), at);
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
  "speak_state",
  "dialogue_state",
  "errorfix_state",
  "writing_entry",
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
  expect(loaded).toMatchObject({ kind: "loaded", words: 60, units: 6, texts: 7, phonics: 3, speaking: 6 });
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
    expect(await testDb.text.count({ where: { language: "fr", status: "approved" } })).toBe(7);
    expect(await testDb.question.count({ where: { language: "fr", status: { not: "approved" } } })).toBe(0);
    expect(await loadDemo()).toEqual({ kind: "already", texts: 0, speaking: 0 });
  });

  it("adds a text written after a server loaded the demo, approved like the rest", async () => {
    const last = await testDb.text.findFirstOrThrow({ where: { language: "fr", code: "fr-a1-t007" } });
    const questions = await testDb.question.findMany({ where: { text_id: last.id }, select: { id: true } });
    await testDb.question.deleteMany({ where: { text_id: last.id } });
    await testDb.text.delete({ where: { id: last.id } });
    await testDb.sentence.deleteMany({ where: { id: { in: last.sentence_ids } } });
    forgetContent();

    expect(await loadDemo()).toEqual({ kind: "already", texts: 1, speaking: 0 });
    const back = await testDb.text.findFirstOrThrow({ where: { language: "fr", code: "fr-a1-t007" }, include: { questions: true } });
    expect(back).toMatchObject({ status: "approved", level: "A1", band: 1, kind: "ad" });
    expect(back.questions).toHaveLength(questions.length);
    expect(back.questions.every((question) => question.status === "approved")).toBe(true);
    expect(await testDb.sentence.count({ where: { id: { in: back.sentence_ids }, status: "approved" } })).toBe(back.sentence_ids.length);
    expect(await loadDemo()).toEqual({ kind: "already", texts: 0, speaking: 0 });
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

  it("a session left half-way still moves the skill levels when it closes (PRD §9.6)", async () => {
    const user = await enrolled();
    const unit = await testDb.grammarUnit.findFirstOrThrow({ where: { language: "fr" }, orderBy: { order_no: "desc" }, select: { id: true, level: true } });
    await testDb.grammarUnit.update({ where: { id: unit.id }, data: { level: "A2" } });
    forgetContent();
    try {
      const bundle = await started(user);
      // A unit of A2 opened by now (as by an answer of this session): the grammar level is A2 (PRD §6.2).
      await learned(user.id, "grammar_unit", unit.id, { dueInDays: 5 });
      expect(await testDb.skillLevel.findFirstOrThrow({ where: { user_id: user.id, skill: "grammar" } })).toMatchObject({ level: "A1" });
      // The learner leaves it: another button replaces it, and the level moves without a finished session.
      expect((await startSession(user, { language: "fr", scope: "vocab", noAudio: false, cap: null }, new Date(NOW.getTime() + 60_000))).kind).toBe("session");
      expect((await testDb.session.findUniqueOrThrow({ where: { id: bundle.id } })).end_reason).toBe("replaced");
      expect(await testDb.skillLevel.findFirstOrThrow({ where: { user_id: user.id, skill: "grammar" } })).toMatchObject({ level: "A2" });
    } finally {
      await testDb.grammarUnit.update({ where: { id: unit.id }, data: { level: unit.level } });
      forgetContent();
    }
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

  it("offers to install after the 1st, 3rd and 7th finished session, only on a phone that can, three times at most (row 7)", async () => {
    const user = await enrolled();
    const count = async () => (await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } })).install_prompt_count;
    const play = async (day: number, device: InstallState) => {
      const at = plusDays(NOW, day);
      return (await playAll(user, await started(user, at), at, () => undefined, device))?.message ?? null;
    };
    /** Finished sessions from before, to reach the 7th without playing them. */
    const finished = (n: number, day: number) =>
      testDb.session.createMany({
        data: Array.from({ length: n }, (_, i) => ({
          user_id: user.id,
          language: "fr",
          scope: "mixed" as const,
          planned_length_min: 15,
          plan: {},
          created_at: plusDays(NOW, day - 0.5 + i * 0.01),
          ended_at: plusDays(NOW, day - 0.49 + i * 0.01),
          end_reason: "finished" as const,
        })),
      });

    // The first finished session on a phone that can install hears it.
    expect(await play(0, "prompt")).toEqual({ kind: "install", ios: false });
    expect(await count()).toBe(1);
    // Not at the 2nd, never inside the installed app, then at the 4th (the 3rd was already reached).
    expect(await play(1, "prompt")).toBeNull();
    expect(await play(2, "standalone")).toBeNull();
    expect(await count()).toBe(1);
    expect(await play(3, "ios")).toEqual({ kind: "install", ios: true });
    expect(await count()).toBe(2);
    // The 6th is too early, the 7th is the last time.
    await finished(1, 4);
    expect(await play(4, "prompt")).toBeNull();
    expect(await play(5, "prompt")).toEqual({ kind: "install", ios: false });
    expect(await count()).toBe(3);
    await finished(5, 6);
    expect(await play(6, "ios")).toBeNull();
    expect(await count()).toBe(3);

    // A browser that cannot install (a computer) never hears it, and nothing is used up.
    const desk = await enrolled();
    expect((await playAll(desk, await started(desk), NOW, () => undefined, "none"))?.message).toBeNull();
    expect((await testDb.enrollment.findFirstOrThrow({ where: { user_id: desk.id } })).install_prompt_count).toBe(0);
  }, 120_000);
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

describe("«الان نمی‌توانم گوش بدهم» (PRD §10.12)", () => {
  it("T62 on the server: a sentence drill and a listening text leave unscored and stay due; a reading text or a word cannot be dropped", async () => {
    const user = await reader();
    const bundle = await started(user, NOW, "listening");
    const kinds = new Set(bundle.plan.queue.map((card) => card.t));
    expect(kinds.has("drill")).toBe(true);
    expect(bundle.plan.queue.some((card) => card.t === "text" && card.text?.track === "listening")).toBe(true);

    // Every card of this session needs sound; each one dropped leaves nothing written but its log row.
    let plan = bundle.plan;
    let seq = bundle.nextSeq;
    for (let i = 0; plan.queue.length > 0; i++) {
      const at = new Date(NOW.getTime() + (i + 1) * 5000);
      const card = plan.queue[0];
      const { result } = answerFor(bundle, plan, card, at, { skip: "drop" });
      const response = await submitAnswer(user, request(bundle, seq++, card, { skip: "drop" }, at), at);
      expect(response).toMatchObject({ kind: "ok" });
      plan = result.advanced.plan;
    }
    expect(await testDb.sentenceDrillState.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.textState.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.newWordQueue.count({ where: { user_id: user.id } })).toBe(0);
    const rows = await testDb.reviewLog.findMany({ where: { user_id: user.id }, select: { kind: true, result: true, raw_answer: true } });
    expect(rows.length).toBe(seq - bundle.nextSeq);
    expect(rows.every((row) => row.kind === "intro" && row.result === "idk" && row.raw_answer === "drop")).toBe(true);
    // A text session counts only a text really tried (PRD §10.11 condition 3).
    expect(await testDb.reviewLog.count({ where: { user_id: user.id, item_type: "text", kind: { not: "intro" } } })).toBe(0);

    // The same drill comes again the next day: its showing was not counted.
    const next = await started(user, plusDays(NOW, 1), "listening");
    expect(next.plan.queue.some((card) => card.t === "drill")).toBe(true);

    // A reading text and a word's exercise take no drop.
    const other = await reader();
    const reading = await started(other, NOW, "reading");
    const first = reading.plan.queue[0];
    expect(await submitAnswer(other, request(reading, reading.nextSeq, first, { skip: "drop" }, NOW), NOW)).toEqual({ kind: "invalid" });
  });

  it("T92: a session left with only sound is replaced by a mixed one without sound, with no drill and no listening text", async () => {
    const user = await reader();
    const listening = await started(user, NOW, "listening");
    const at = new Date(NOW.getTime() + 60_000);
    const silent = await startSession(user, { language: "fr", scope: "mixed", noAudio: true, cap: null, replace: true }, at);
    if (silent.kind !== "session") throw new Error(silent.kind);
    expect(await testDb.session.findUniqueOrThrow({ where: { id: listening.id } })).toMatchObject({ end_reason: "replaced" });
    expect(silent.bundle.id).not.toBe(listening.id);
    expect(silent.bundle.plan.noAudio).toBe(true);
    expect(silent.bundle.plan.queue.length).toBeGreaterThan(0);
    expect(silent.bundle.plan.queue.some((card) => card.t === "drill" || card.t === "phonics" || (card.t === "text" && card.text?.track === "listening"))).toBe(false);
    expect(await testDb.session.findUniqueOrThrow({ where: { id: silent.bundle.id } })).toMatchObject({ no_audio: true, ended_at: null });

    // Without «replace», the open mixed session of the same scope goes on as before.
    const resumed = await started(user, new Date(at.getTime() + 60_000));
    expect(resumed.id).toBe(silent.bundle.id);
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

describe("speaking and writing (PRD §8b)", () => {
  const setting = (key: string, value: number) =>
    testDb.engineSetting.upsert({ where: { key }, create: { key, value, default_value: value, description_fa: key }, update: { value } });
  afterEach(() => testDb.engineSetting.deleteMany({ where: { key: "gate.dialogue_words" } }));

  /** Every demo card word learned and not due, so the session has room and every sentence is known. */
  async function knowsEveryWord(userId: number) {
    for (const word of await testDb.word.findMany({ where: { language: "fr", no_card: false }, select: { id: true } })) await learned(userId, "word", word.id, { dueInDays: 5 });
  }

  it("«بگو، بعد بشنو» and a dialogue in a mixed session write their states and one log row per dialogue turn", async () => {
    const user = await enrolled();
    await knowsEveryWord(user.id);
    await setting("gate.dialogue_words", 0);
    const bundle = await started(user);
    expect(bundle.plan.queue.map((card) => card.t)).toContain("dialogue");
    const dialogue = bundle.plan.queue.find((card) => card.t === "dialogue")!;
    await playAll(user, bundle);
    // Behind the dialogue gate again, the next session's speaking share goes to «بگو، بعد بشنو».
    await testDb.engineSetting.deleteMany({ where: { key: "gate.dialogue_words" } });
    const later = new Date(NOW.getTime() + 3_600_000);
    const next = await started(user, later);
    const kinds = next.plan.queue.map((card) => card.t);
    expect(kinds).toContain("speak");
    expect(kinds).not.toContain("dialogue");
    // A speaking card never opens the session (DECISIONS.md).
    expect(kinds.slice(0, 3)).not.toContain("speak");
    const speaks = kinds.filter((kind) => kind === "speak").length;
    await playAll(user, next, later);

    const dialogueId = Number(dialogue.item.slice(2));
    const state = await testDb.dialogueState.findFirstOrThrow({ where: { user_id: user.id, dialogue_id: dialogueId } });
    expect(state).toMatchObject({ attempts_done: 1, scores: [1] });
    expect(state.next_attempt_at).not.toBeNull();
    const turns = (await testDb.dialogue.findUniqueOrThrow({ where: { id: dialogueId } })).turns as unknown[];
    expect(await testDb.reviewLog.count({ where: { user_id: user.id, kind: "dialogue", item_id: dialogueId } })).toBe(turns.length);
    expect(await testDb.speakState.count({ where: { user_id: user.id, count: 1, correct_count: 1, last_rating: "ok" } })).toBe(speaks);
    expect(await testDb.reviewLog.count({ where: { user_id: user.id, kind: "self", result: "self_ok" } })).toBe(speaks);
    // Nothing of speaking moves a word (PRD §8b.1).
    expect(await testDb.itemState.count({ where: { user_id: user.id, item_type: "word", step: { not: 2 } } })).toBe(0);
  });

  it("find the mistake opens at grammar B1 with its units opened, and keeps both attempts", async () => {
    const user = await enrolled();
    await knowsEveryWord(user.id);
    for (const unit of await testDb.grammarUnit.findMany({ where: { language: "fr" }, select: { id: true } })) await learned(user.id, "grammar_unit", unit.id, { dueInDays: 5 });
    expect((await started(user)).plan.queue.some((card) => card.t === "errorfix")).toBe(false);
    await testDb.session.deleteMany({ where: { user_id: user.id } });

    await testDb.skillLevel.updateMany({ where: { user_id: user.id, language: "fr", skill: "grammar" }, data: { level: "B1" } });
    const bundle = await started(user);
    const card = bundle.plan.queue.find((item) => item.t === "errorfix");
    expect(card).toBeDefined();
    await playAll(user, bundle);
    const state = await testDb.errorfixState.findFirstOrThrow({ where: { user_id: user.id, errorfix_item_id: Number(card!.item.slice(2)) } });
    expect(state).toMatchObject({ attempts_done: 1, results: [{ ok: true, wrongTaps: 0 }] });
    expect(state.next_attempt_at).not.toBeNull();
    expect(await testDb.reviewLog.count({ where: { user_id: user.id, kind: "errorfix", result: "correct" } })).toBe(1);
  });

  it("«بازبینی» shows a dialogue's two attempts, find the mistake and the writing page as the learner gets them", async () => {
    const dialogue = await testDb.dialogue.findFirstOrThrow({ where: { language: "fr", code: "fr-a1-d001" } });
    const shown = await previewItem("dialogues", "fr", dialogue.id);
    if (shown.state !== "ready") throw new Error(shown.reason);
    expect(shown.screens.map((screen) => (screen.kind === "dialogue" ? screen.attempt : null))).toEqual([1, 2]);
    const first = shown.screens[0];
    if (first.kind !== "dialogue") throw new Error(first.kind);
    expect(first.view.turns).toHaveLength(5);
    expect(first.view.turns[0]).toMatchObject({ line: { text: "Bonjour, vous allez bien ?" }, correct: 0 });
    expect(first.view.turns[0].choices).toHaveLength(3);

    const item = await testDb.errorfixItem.findFirstOrThrow({ where: { language: "fr" }, orderBy: { id: "asc" } });
    const fix = await previewItem("errorfix", "fr", item.id);
    if (fix.state !== "ready" || fix.screens[0].kind !== "errorfix") throw new Error("no errorfix screen");
    expect(fix.screens[0].view).toMatchObject({ corrected: "Ma sœur est grande et elle a un chat noir.", marks: [{ wrong: "grand", right: "grande" }, { wrong: "est", right: "a" }, { wrong: "noire", right: "noir" }] });

    // A dialogue's wrong answer is never given to say aloud; its right answer may be (PRD §8b.2).
    const content = await loadContent("fr", "tester");
    const byText = (text: string) => [...content.sentences.values()].find((sentence) => sentence.text === text);
    expect(byText("Non, je suis Paul.")).toMatchObject({ wrongChoice: true, bank: false });
    expect(byText("Oui, très bien, merci.")?.wrongChoice).toBeUndefined();

    const task = await testDb.writingTask.findFirstOrThrow({ where: { language: "fr" }, orderBy: { id: "asc" } });
    expect(await previewItem("writing", "fr", task.id)).toMatchObject({ state: "ready", screens: [{ kind: "writing", task: { id: task.id, minWords: 60 }, minToFinish: 30 }] });
  });

  it("the weekly writing: open from vocabulary B1, kept with its ticks, counts the week and the streak; a tester's try changes nothing", async () => {
    const user = await enrolled();
    expect((await writingCard(user, "fr", NOW)).state).toBe("closed");
    const tasks = await testDb.writingTask.findMany({ where: { language: "fr" }, orderBy: { id: "asc" } });
    expect(tasks).toHaveLength(2);

    // A tester tries the second task before their level allows: not kept, nothing changes.
    const text = Array.from({ length: 40 }, () => "Je mange du pain.").join(" ");
    expect(await saveWriting(user, { language: "fr", taskId: tasks[1].id, text, ticks: [0, 9], seconds: 300 }, NOW)).toEqual({ kind: "ok", id: null });
    expect(await testDb.writingEntry.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } })).toMatchObject({ writing_done_week: null, streak_count: 0 });
    // A learner cannot write another task than this week's.
    const learner = await enrolled({});
    await testDb.skillLevel.updateMany({ where: { user_id: learner.id, language: "fr", skill: "vocab" }, data: { level: "B1" } });
    expect(await saveWriting(learner, { language: "fr", taskId: tasks[1].id, text, ticks: [], seconds: 60 }, NOW)).toEqual({ kind: "invalid" });

    await testDb.skillLevel.updateMany({ where: { user_id: user.id, language: "fr", skill: "vocab" }, data: { level: "B1" } });
    const card = await writingCard(user, "fr", NOW);
    expect(card).toMatchObject({ state: "open", task: { id: tasks[0].id } });
    expect(await saveWriting(user, { language: "fr", taskId: tasks[0].id, text: "Bonjour.", ticks: [], seconds: 30 }, NOW)).toEqual({ kind: "short" });
    const saved = await saveWriting(user, { language: "fr", taskId: tasks[0].id, text, ticks: [1, 1, 0], seconds: 3600 }, NOW);
    expect(saved).toMatchObject({ kind: "ok" });
    const entry = await testDb.writingEntry.findUniqueOrThrow({ where: { id: (saved as { id: number }).id } });
    expect(entry.checklist_ticks).toEqual([0, 1]);
    const enrollment = await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } });
    expect(enrollment.writing_done_week).not.toBeNull();
    expect(enrollment.streak_count).toBe(1);
    // Time counts up to `writing.max_minutes` (PRD §8b.6).
    const settings = await engineSettings();
    const day = await testDb.dailyCounter.findFirstOrThrow({ where: { user_id: user.id } });
    expect(day.active_sec).toBe(num(settings, "writing.max_minutes") * 60);
    expect((await writingCard(user, "fr", NOW)).state).toBe("done");
    expect(await tickWriting(user, entry.id, [2, 0])).toBe(true);
    const mine = await myWritings(user, "fr");
    expect(mine.map((item) => item.ticks)).toEqual([[0, 2]]);
  });
});

describe("removing the demo", () => {
  it("takes out the content and what testers did with it", async () => {
    const user = await enrolled();
    await playAll(user, await started(user));
    expect(await testDb.itemState.count({ where: { user_id: user.id } })).toBeGreaterThan(0);
    expect(await testDb.phonicsState.count({ where: { user_id: user.id } })).toBe(1);
    const sentence = await testDb.sentence.findFirstOrThrow({ where: { language: "fr" } });
    const dialogue = await testDb.dialogue.findFirstOrThrow({ where: { language: "fr" } });
    const task = await testDb.writingTask.findFirstOrThrow({ where: { language: "fr" } });
    await testDb.speakState.create({ data: { user_id: user.id, sentence_id: sentence.id, count: 1 } });
    await testDb.dialogueState.create({ data: { user_id: user.id, dialogue_id: dialogue.id, attempts_done: 1 } });
    await testDb.writingEntry.create({ data: { user_id: user.id, writing_task_id: task.id, text: "Bonjour." } });
    expect(await removeDemo()).toEqual({ removed: true });
    expect(await testDb.speakState.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.dialogueState.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.writingEntry.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.dialogue.count() + (await testDb.errorfixItem.count()) + (await testDb.writingTask.count())).toBe(0);
    expect(await testDb.phonicsState.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.phonicsLesson.count({ where: { language: "fr" } })).toBe(0);
    expect(await demoStatus()).toMatchObject({ loaded: false, words: 0 });
    expect(await testDb.word.count({ where: { language: "fr" } })).toBe(0);
    expect(await testDb.itemState.count({ where: { user_id: user.id } })).toBe(0);
    expect(await testDb.importBatch.count()).toBe(0);
    expect(await removeDemo()).toEqual({ removed: false });
  });
});

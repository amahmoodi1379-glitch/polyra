/**
 * Listening and reading texts (PRD §7.4, §7.5, §9.6, §10.2, §10.11): attempts and their question sets
 * (T34), the next text (T35, T64), the track score (T89) and level (T36), a text left half-way (T91),
 * the text session (T65), due attempts in a mixed session (T82), questions graded (§7.3) and a text
 * played through the same `playCard` the browser and the server run.
 */
import { describe, expect, it } from "vitest";
import type { Content, QuestionC, TextC, Track } from "@/engine/content";
import { gradeQuestion, stageScore } from "@/engine/questions";
import { buildSession, type BuildOptions, type BuildResult } from "@/engine/session/build";
import { playCard, type PlayEnv } from "@/engine/session/play";
import type { SessionPlan } from "@/engine/session/types";
import type { LearnerSnapshot, TextScoreE, TextStateE } from "@/engine/state";
import {
  afterStage,
  attemptCost,
  dueTexts,
  indexTextStates,
  newText,
  nextAttempt,
  partialText,
  remainingCost,
  stageRules,
  textLevelUp,
  textProgress,
  trackScore,
  type TextEnv,
} from "@/engine/texts";
import { plusDays, tehranDate } from "@/engine/time";
import { syntheticContent } from "../../../fixtures/synthetic";
import { freshLearner, newDay } from "../../../fixtures/synthetic/learner";
import { content as kitContent, defaults, word } from "./kit";

const NOW = new Date("2026-03-21T08:00:00Z");
const TODAY = tehranDate(NOW);
const ago = (days: number) => plusDays(NOW, -days).toISOString();
const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({ scope: "mixed", lengthMin: 10, noAudio: false, cap: null, seed: "texts", ...over });
const planOf = (result: BuildResult): SessionPlan => {
  if (result.kind !== "plan") throw new Error(`Expected a plan, got ${result.kind}`);
  return result.plan;
};

let questionId = 1000;
const mcq = (correct = 0): QuestionC => ({ id: questionId++, prompt: "?", promptFa: null, explanationFa: null, type: "mcq", options: ["a", "b", "c"], correct });
const questions = (n: number) => Array.from({ length: n }, (_, i) => mcq(i % 3));

/** A text of A1 with no sentences of its own (all its words count as known) and `n` questions in each set of each track. */
function text(id: number, over: Partial<TextC> & { n?: number; tracks?: Track[] } = {}): TextC {
  const { n = 4, tracks = ["listening", "reading"], ...rest } = over;
  const sets = (track: Track) => (tracks.includes(track) ? { A: questions(n), B: questions(n) } : { A: [], B: [] });
  return {
    id,
    code: `t${id}`,
    level: "A1",
    band: 2,
    kind: "message",
    title: `متن ${id}`,
    sentenceIds: [],
    speakers: null,
    audio: { url: `/media/t${id}.mp3`, offsetsMs: [], durationSec: 30 },
    wordCount: 60,
    keyWordIds: [],
    placementOk: false,
    difficulty: id,
    orderOverride: null,
    questions: { listening: sets("listening"), reading: sets("reading") },
    ...rest,
  };
}

const withTexts = (base: Content, texts: TextC[]): Content => ({ ...base, texts });

function state(textId: number, track: Track, over: Partial<TextStateE> = {}): TextStateE {
  return { textId, track, attemptsDone: 0, firstScore: null, scores: [], lastAttemptAt: null, nextAttemptAt: null, partial: null, partialUntil: null, usedInTest: false, ...over };
}

/** A text whose attempt 1 was done `days` ago with a first round of `score`. */
function firstDone(textId: number, track: Track, score: number, days: number, over: Partial<TextStateE> = {}, borrowed = false): TextStateE {
  const first: TextScoreE = { attempt: 1, set: "A", score, at: ago(days), ...(borrowed ? { borrowed: true } : {}) };
  return state(textId, track, { attemptsDone: 1, firstScore: score, scores: [first], lastAttemptAt: ago(days), nextAttemptAt: plusDays(NOW, 3 - days).toISOString(), ...over });
}

function tenv(content: Content, states: TextStateE[], over: Partial<TextEnv> = {}): TextEnv {
  return { content, settings: defaults, now: NOW, known: () => true, states: indexTextStates(states), levelOf: () => "A1", ...over };
}

function learner(over: Partial<LearnerSnapshot> = {}): LearnerSnapshot {
  return { ...newDay(freshLearner("fr", { sessionLength: 10 }), TODAY), ...over };
}

const playEnv = (content: Content, now = NOW): PlayEnv => ({ ctx: { settings: defaults, now, today: tehranDate(now), latency: {} }, language: content.language, wordsWithLemma: () => [] });

describe("attempts of a text (PRD §7.4)", () => {
  it("T34: band 2 goes A (both stages), B after 3 days, A after 14, then never again; band 1 goes A then B; first_score only from the first round", () => {
    const band2 = text(1);
    expect(nextAttempt(band2, undefined)).toEqual({ attempt: 1, set: "A" });
    const base = { text: band2, track: "reading" as const, borrowed: false, answers: {} };

    const first = afterStage(null, { ...base, attempt: 1, stage: "first", set: "A", score: 0.5 }, NOW, defaults);
    expect(first).toMatchObject({ attemptsDone: 0, firstScore: 0.5, partial: { attempt: 1, stage: "help" } });
    expect(first.partialUntil).toBe(new Date(NOW.getTime() + 24 * 3_600_000).toISOString());

    const helped = afterStage(first, { ...base, attempt: 1, stage: "help", set: "A", score: 1 }, NOW, defaults);
    expect(helped).toMatchObject({ attemptsDone: 1, firstScore: 0.5, partial: null, nextAttemptAt: plusDays(NOW, 3).toISOString() });
    expect(helped.scores).toEqual([{ attempt: 1, set: "A", score: 0.5, at: NOW.toISOString() }]);
    expect(nextAttempt(band2, helped)).toEqual({ attempt: 2, set: "B" });

    const at3 = plusDays(NOW, 3);
    const second = afterStage(helped, { ...base, attempt: 2, stage: "again", set: "B", score: 0.9 }, at3, defaults);
    expect(second).toMatchObject({ attemptsDone: 2, firstScore: 0.5, nextAttemptAt: plusDays(at3, 14).toISOString() });
    expect(nextAttempt(band2, second)).toEqual({ attempt: 3, set: "A" });

    const third = afterStage(second, { ...base, attempt: 3, stage: "again", set: "A", score: 1 }, plusDays(at3, 14), defaults);
    expect(third).toMatchObject({ attemptsDone: 3, firstScore: 0.5, nextAttemptAt: null });
    expect(third.scores.map((score) => [score.attempt, score.set])).toEqual([
      [1, "A"],
      [2, "B"],
      [3, "A"],
    ]);
    expect(nextAttempt(band2, third)).toBeNull();

    const band1 = text(2, { band: 1 });
    const one = afterStage(afterStage(null, { ...base, text: band1, attempt: 1, stage: "first", set: "A", score: 1 }, NOW, defaults), { ...base, text: band1, attempt: 1, stage: "help", set: "A", score: 1 }, NOW, defaults);
    expect(nextAttempt(band1, one)).toEqual({ attempt: 2, set: "B" });
    const two = afterStage(one, { ...base, text: band1, attempt: 2, stage: "again", set: "B", score: 1 }, at3, defaults);
    expect(two.nextAttemptAt).toBeNull();
    expect(nextAttempt(band1, two)).toBeNull();
  });

  it("an attempt comes due on its day, not before, the oldest first", () => {
    const content = withTexts(kitContent({ words: [] }), [text(1), text(2), text(3)]);
    const states = [
      firstDone(1, "reading", 0.7, 2),
      firstDone(2, "reading", 0.7, 5),
      firstDone(3, "reading", 0.7, 4),
    ];
    expect(dueTexts(tenv(content, states), ["reading"]).map((pick) => [pick.text.id, pick.attempt, pick.set])).toEqual([
      [2, 2, "B"],
      [3, 2, "B"],
    ]);
    expect(dueTexts(tenv(content, states), ["listening"])).toEqual([]);
  });

  it("what each stage allows: plays, slow speed and sentences in listening; translations, word meanings and the clock in reading", () => {
    const item = text(1, { wordCount: 150, n: 5 });
    expect(stageRules(item, "listening", 1, "first")).toMatchObject({ plays: 2, slow: false, bySentence: false, revise: false });
    expect(stageRules(item, "listening", 1, "help")).toMatchObject({ plays: null, slow: true, bySentence: true, revise: true });
    expect(stageRules(item, "listening", 2, "again").plays).toBe(2);
    expect(stageRules(item, "listening", 3, "again").plays).toBe(1);
    expect(stageRules(item, "reading", 1, "first")).toMatchObject({ translations: false, wordTap: false, timedSec: null });
    expect(stageRules(item, "reading", 1, "help")).toMatchObject({ translations: true, wordTap: true, revise: true, timedSec: null });
    expect(stageRules(item, "reading", 2, "again").timedSec).toBeNull();
    // A minute per hundred words and twenty seconds per question.
    expect(stageRules(item, "reading", 3, "again").timedSec).toBe(90 + 100);
  });

  it("an attempt's time in a session follows PRD §10.1, and what is left of a half-way attempt is its share", () => {
    const item = text(1, { n: 5, audio: { url: "/x.mp3", offsetsMs: [], durationSec: 240 }, wordCount: 240 });
    expect(attemptCost(item, "listening", { attempt: 1, set: "A" }, defaults)).toBe(240 * 3 + 5 * 20);
    expect(attemptCost(item, "listening", { attempt: 2, set: "B" }, defaults)).toBe(240 * 1.5 + 5 * 15);
    expect(attemptCost(item, "reading", { attempt: 1, set: "A" }, defaults)).toBe(120 * 2 + 5 * 20);
    expect(attemptCost(item, "reading", { attempt: 3, set: "A" }, defaults)).toBe(120 + 5 * 15);
    // Without a recording the device voice reads it, two and a half words a second.
    expect(attemptCost({ ...item, audio: null }, "listening", { attempt: 1, set: "A" }, defaults)).toBe(96 * 3 + 5 * 20);
    const full = attemptCost(item, "reading", { attempt: 1, set: "A" }, defaults);
    expect(remainingCost(item, "reading", { attempt: 1, stage: "first", answers: { a: 1, b: 2 }, plays: 0, positionMs: 0 }, defaults)).toBeCloseTo(full * 0.8);
    expect(remainingCost(item, "reading", { attempt: 1, stage: "help", answers: {}, plays: 0, positionMs: 0 }, defaults)).toBeCloseTo(full * 0.5);
  });
});

describe("which text comes next (PRD §7.5)", () => {
  it("T35: a learner whose track score is 0.9 gets the middle of the allowed texts; with no score, the easiest", () => {
    const content = withTexts(kitContent({ words: [] }), [1, 2, 3, 4, 5, 6, 7, 8].map((id) => text(id)));
    const strong = [firstDone(1, "listening", 0.9, 9), firstDone(2, "listening", 0.9, 8), firstDone(3, "listening", 0.9, 7)];
    expect(newText(tenv(content, strong), "listening", new Set())?.text.id).toBe(6);
    expect(newText(tenv(content, []), "listening", new Set())?.text.id).toBe(1);
    // Below `text.jump_score` the easiest still.
    const weak = strong.map((item) => ({ ...item, scores: [{ ...item.scores[0], score: 0.7 }] }));
    expect(newText(tenv(content, weak), "listening", new Set())?.text.id).toBe(4);
  });

  it("T64: a text tried in reading is not for listening while others are left, nor before 30 days; after 31 it is borrowed", () => {
    const x = text(1);
    const tried = [firstDone(1, "reading", 0.8, 29)];
    expect(newText(tenv(withTexts(kitContent({ words: [] }), [x, text(2)]), tried), "listening", new Set())?.text.id).toBe(2);
    expect(newText(tenv(withTexts(kitContent({ words: [] }), [x]), tried), "listening", new Set())).toBeNull();
    const old = [firstDone(1, "reading", 0.8, 31)];
    expect(newText(tenv(withTexts(kitContent({ words: [] }), [x]), old), "listening", new Set())).toMatchObject({ text: { id: 1 }, borrowed: true, attempt: 1, set: "A" });
  });

  it("known words: 90% to open a track; a started track lowers it to 80% and 70%, then takes the easiest", () => {
    const words = Array.from({ length: 10 }, (_, i) => word(i + 1, `mot${i + 1}`, `معنی ${i + 1}`));
    const base = kitContent({ words });
    const sentence = { id: 900, text: "x", translationFa: "x", level: "A1", speak: { text: "x", lang: "fr" as const, url: null }, bank: false, tokens: words.map((item) => ({ kind: "word" as const, wordId: item.id, surface: item.lemma, spans: [[0, 1]] as [number, number][], meaningCtx: null })) };
    const content: Content = { ...withTexts(base, [text(1, { sentenceIds: [900] }), text(2)]), sentences: new Map([...base.sentences, [900, sentence]]) };
    const knownUpTo = (n: number) => (id: number) => id <= n;
    // Text 2 has no words of its own: it is open; text 1 needs nine known words of ten.
    expect(newText(tenv(withTexts(content, [content.texts[0]]), [], { known: knownUpTo(9) }), "reading", new Set())?.text.id).toBe(1);
    expect(newText(tenv(withTexts(content, [content.texts[0]]), [], { known: knownUpTo(8) }), "reading", new Set())).toBeNull();
    const started = [firstDone(5, "reading", 0.8, 1)];
    expect(newText(tenv(withTexts(content, [content.texts[0]]), started, { known: knownUpTo(8) }), "reading", new Set())?.text.id).toBe(1);
    expect(newText(tenv(withTexts(content, [content.texts[0]]), started, { known: knownUpTo(2) }), "reading", new Set())?.text.id).toBe(1);
    // Key words count as known.
    const keyed = { ...content.texts[0], keyWordIds: [9, 10] };
    expect(newText(tenv(withTexts(content, [keyed]), [], { known: knownUpTo(7) }), "reading", new Set())?.text.id).toBe(1);
  });

  it("a text of the other level, one a test used, or one already in the session is not new", () => {
    const content = withTexts(kitContent({ words: [] }), [text(1, { level: "A2" }), text(2), text(3)]);
    const used = [state(2, "listening", { usedInTest: true })];
    expect(newText(tenv(content, used), "reading", new Set([3]))).toBeNull();
    expect(newText(tenv(content, used), "reading", new Set())?.text.id).toBe(3);
  });

  it("an attempt 1 given up comes back first, from the start", () => {
    const content = withTexts(kitContent({ words: [] }), [text(1), text(2)]);
    const givenUp = [state(2, "reading", { scores: [{ attempt: 1, set: "A", score: 0.5, at: ago(2) }], firstScore: 0.5, partial: { attempt: 1, stage: "help", answers: {}, plays: 0, positionMs: 0 }, partialUntil: ago(1) })];
    expect(newText(tenv(content, givenUp), "reading", new Set())).toMatchObject({ text: { id: 2 }, attempt: 1, resume: null });
  });
});

describe("track score and level (PRD §7.5, §9.6)", () => {
  it("T89: only first rounds count; attempt 2 and a borrowed text do not", () => {
    const states = [
      firstDone(1, "listening", 0.4, 6, { scores: [{ attempt: 1, set: "A", score: 0.4, at: ago(6) }, { attempt: 2, set: "B", score: 1, at: ago(3) }] }),
      firstDone(2, "listening", 0.4, 5),
      firstDone(3, "listening", 0.4, 4),
      firstDone(4, "listening", 1, 3, {}, true),
    ];
    expect(trackScore(states, "listening", defaults)).toBeCloseTo(0.4);
    // Below three first rounds it is not defined.
    expect(trackScore(states.slice(1), "listening", defaults)).toBeNull();
    // The last `text.track_window` (5) first rounds.
    const many = [0.2, 0.2, 1, 1, 1, 1, 1].map((score, i) => firstDone(i + 1, "reading", score, 10 - i));
    expect(trackScore(many, "reading", defaults)).toBe(1);
  });

  it("T36: eight first rounds with a track score of 0.8 move the track up; low first rounds with high second attempts do not", () => {
    const content = withTexts(kitContent({ words: [] }), Array.from({ length: 10 }, (_, i) => text(i + 1)));
    const good = Array.from({ length: 8 }, (_, i) => firstDone(i + 1, "reading", 0.8, 20 - i, { nextAttemptAt: plusDays(NOW, 2).toISOString() }));
    expect(textLevelUp(content, indexTextStates(good), "reading", "A1", defaults, NOW)).toBe("A2");
    expect(textLevelUp(content, indexTextStates(good), "listening", "A1", defaults, NOW)).toBeNull();
    const low = good.map((item) => ({ ...item, attemptsDone: 2, scores: [{ ...item.scores[0], score: 0.5 }, { attempt: 2, set: "B" as const, score: 1, at: ago(1) }] }));
    expect(textLevelUp(content, indexTextStates(low), "reading", "A1", defaults, NOW)).toBeNull();
    // A closed next level keeps the track where it is.
    expect(textLevelUp({ ...content, openLevels: ["A1"] }, indexTextStates(good), "reading", "A1", defaults, NOW)).toBeNull();
  });

  it("rule 2: every text of the level touched in some track, no due attempt left and four first rounds", () => {
    const content = withTexts(kitContent({ words: [] }), Array.from({ length: 6 }, (_, i) => text(i + 1)));
    const later = { nextAttemptAt: plusDays(NOW, 5).toISOString() };
    const own = [1, 2, 3, 4].map((id) => firstDone(id, "reading", 0.5, 10, later));
    const others = [5, 6].map((id) => firstDone(id, "listening", 0.5, 10, later));
    expect(textLevelUp(content, indexTextStates([...own, ...others]), "reading", "A1", defaults, NOW)).toBe("A2");
    // One text nobody touched, or one due attempt, keeps it.
    expect(textLevelUp(content, indexTextStates([...own, others[0]]), "reading", "A1", defaults, NOW)).toBeNull();
    const due = [{ ...own[0], nextAttemptAt: ago(1) }, ...own.slice(1), ...others];
    expect(textLevelUp(content, indexTextStates(due), "reading", "A1", defaults, NOW)).toBeNull();
    // Three first rounds are not enough.
    expect(textLevelUp(content, indexTextStates([...own.slice(1), firstDone(1, "listening", 0.5, 10, later), ...others]), "reading", "A1", defaults, NOW)).toBeNull();
  });

  it("the bar: 70% first rounds out of eight (or the level's texts), 30% the track score out of 0.8", () => {
    const content = withTexts(kitContent({ words: [] }), Array.from({ length: 10 }, (_, i) => text(i + 1)));
    const four = [1, 2, 3, 4].map((id) => firstDone(id, "reading", 0.8, 10 - id));
    expect(textProgress(content, indexTextStates(four), "reading", "A1", defaults)).toMatchObject({ firstRounds: 4, score: 0.8, progress: 0.7 * 0.5 + 0.3 });
    const small = withTexts(content, content.texts.slice(0, 4));
    expect(textProgress(small, indexTextStates(four), "reading", "A1", defaults).progress).toBeCloseTo(1);
    expect(textProgress(content, indexTextStates(four.slice(0, 2)), "reading", "A1", defaults)).toMatchObject({ score: null, progress: 0.7 * 0.25 });
  });
});

describe("texts in a session (PRD §10.2, §10.11)", () => {
  const base = () => syntheticContent({ words: 60, units: 2 });

  it("T65: three mixed sessions without a text: a 370-second text leads the session without a question; 820 asks first; «بعداً» builds a normal session", () => {
    const short = text(1, { n: 5, tracks: ["listening"], audio: { url: "/a.mp3", offsetsMs: [], durationSec: 90 } });
    const plan = planOf(buildSession(withTexts(base(), [short]), learner({ mixedWithoutText: 3 }), defaults, NOW, TODAY, opts()));
    expect(plan.queue[0]).toMatchObject({ t: "text", item: "x:1", text: { stage: "first", attempt: 1, set: "A", track: "listening" } });
    expect(plan.queue[1]).toMatchObject({ t: "text", text: { stage: "help" } });
    expect(plan.queue.length).toBeGreaterThan(2);
    const built = buildSession(withTexts(base(), [short]), learner({ mixedWithoutText: 3 }), defaults, NOW, TODAY, opts());
    expect(built.kind === "plan" && built.effects.textSession).toBe(true);

    const long = { ...short, audio: { url: "/a.mp3", offsetsMs: [], durationSec: 240 } };
    const asked = buildSession(withTexts(base(), [long]), learner({ mixedWithoutText: 3 }), defaults, NOW, TODAY, opts());
    expect(asked).toMatchObject({ kind: "ask_text_session", minutes: 14, textId: 1, track: "listening" });

    const later = buildSession(withTexts(base(), [long]), learner({ mixedWithoutText: 3 }), defaults, NOW, TODAY, opts({ text: "later" }));
    expect(later.kind).toBe("plan");
    expect(planOf(later).queue.some((card) => card.t === "text")).toBe(false);
    expect(later.kind === "plan" && later.effects.textSession).toBe(false);
    // Not asked again today; asked again with «شروع»: the session is only the text.
    const today = learner({ mixedWithoutText: 3, enrollment: { ...learner().enrollment, textPromptDate: TODAY } });
    expect(buildSession(withTexts(base(), [long]), today, defaults, NOW, TODAY, opts()).kind).toBe("plan");
    const confirmed = planOf(buildSession(withTexts(base(), [long]), learner({ mixedWithoutText: 3 }), defaults, NOW, TODAY, opts({ text: "confirmed" })));
    expect(confirmed.queue.map((card) => card.t)).toEqual(["text", "text"]);
  });

  it("the text session waits for its six conditions", () => {
    const short = text(1, { n: 5, tracks: ["listening"], audio: { url: "/a.mp3", offsetsMs: [], durationSec: 90 } });
    const content = withTexts(base(), [short]);
    const lead = (result: BuildResult) => result.kind === "plan" && result.effects.textSession;
    expect(lead(buildSession(content, learner({ mixedWithoutText: 2 }), defaults, NOW, TODAY, opts()))).toBe(false);
    expect(lead(buildSession(content, learner({ mixedWithoutText: 3, today: { ...learner().today, textSessionDone: true } }), defaults, NOW, TODAY, opts()))).toBe(false);
    expect(lead(buildSession(content, learner({ mixedWithoutText: 3 }), defaults, NOW, TODAY, opts({ scope: "vocab" })))).toBe(false);
    // Without sound only reading: this text has no reading questions.
    expect(lead(buildSession(content, learner({ mixedWithoutText: 3 }), defaults, NOW, TODAY, opts({ noAudio: true })))).toBe(false);
    // A due attempt comes before a new text.
    const both = withTexts(base(), [short, text(2, { tracks: ["reading"] })]);
    const due = buildSession(both, learner({ mixedWithoutText: 3, texts: [firstDone(2, "reading", 0.6, 4)] }), defaults, NOW, TODAY, opts());
    expect(planOf(due).queue[0]).toMatchObject({ t: "text", item: "x:2", text: { attempt: 2, set: "B", stage: "again" } });
  });

  it("T91: a session closed in the middle of a first round goes on 2 hours later from the same question; 25 hours later the attempt starts again", () => {
    const item = text(1, { tracks: ["reading"] });
    const content = withTexts(base(), [item]);
    const partial = { attempt: 1, stage: "first" as const, answers: { [String(item.questions.reading.A[0].id)]: { choice: 0 } }, plays: 1, positionMs: 12_000 };
    const closed = state(1, "reading", { partial, partialUntil: plusDays(NOW, 1).toISOString() });
    const at2h = new Date(NOW.getTime() + 2 * 3_600_000);
    const resumed = planOf(buildSession(content, learner({ texts: [closed] }), defaults, at2h, tehranDate(at2h), opts()));
    expect(resumed.queue[0]).toMatchObject({ t: "text", text: { stage: "first", resume: partial } });
    expect(resumed.queue[1]).toMatchObject({ t: "text", text: { stage: "help", resume: null } });
    expect(resumed.summary.resumeText).toBe(true);
    expect(partialText(tenv(content, [closed], { now: at2h }), ["reading"])?.resume).toEqual(partial);

    const at25h = new Date(NOW.getTime() + 25 * 3_600_000);
    expect(partialText(tenv(content, [closed], { now: at25h }), ["reading"])).toBeNull();
    const again = newText(tenv(content, [closed], { now: at25h }), "reading", new Set());
    expect(again).toMatchObject({ text: { id: 1 }, attempt: 1, set: "A", resume: null });
    const restarted = planOf(buildSession(content, learner({ texts: [closed] }), defaults, at25h, tehranDate(at25h), opts({ lengthMin: 15 })));
    const card = restarted.queue.find((item) => item.t === "text");
    expect(card?.text).toMatchObject({ stage: "first", attempt: 1, set: "A", resume: null });
    expect(restarted.textStates["x:1"]?.attemptsDone).toBe(0);
  });

  it("a half-way attempt in the help stage goes on with that stage only", () => {
    const item = text(1, { tracks: ["reading"] });
    const first = afterStage(null, { text: item, track: "reading", attempt: 1, stage: "first", set: "A", borrowed: false, score: 0.5, answers: {} }, NOW, defaults);
    const plan = planOf(buildSession(withTexts(base(), [item]), learner({ texts: [first] }), defaults, NOW, TODAY, opts()));
    expect(plan.queue[0]).toMatchObject({ t: "text", text: { stage: "help" } });
    expect(plan.queue.filter((card) => card.t === "text")).toHaveLength(1);
  });

  it("T82: a 30-minute mixed session takes two due attempts at most, the oldest first", () => {
    const texts = [1, 2, 3].map((id) => text(id, { tracks: ["reading"] }));
    const states = [firstDone(1, "reading", 0.7, 5), firstDone(2, "reading", 0.7, 7), firstDone(3, "reading", 0.7, 6)];
    const plan = planOf(buildSession(withTexts(base(), texts), learner({ sessionLength: 30, texts: states }), defaults, NOW, TODAY, opts({ lengthMin: 30 })));
    expect(plan.queue.filter((card) => card.t === "text").map((card) => card.item).sort()).toEqual(["x:2", "x:3"]);
    const short = planOf(buildSession(withTexts(base(), texts), learner({ texts: states }), defaults, NOW, TODAY, opts()));
    expect(short.queue.filter((card) => card.t === "text").map((card) => card.item)).toEqual(["x:2"]);
  });

  it("a mixed session takes a new text that fits 60% of it, with its key words first; one text never comes in both tracks", () => {
    const item = text(1, { keyWordIds: [3, 4] });
    const plan = planOf(buildSession(withTexts(base(), [item]), learner(), defaults, NOW, TODAY, opts({ lengthMin: 15 })));
    const cards = plan.queue.filter((card) => card.item === "x:1");
    expect(cards.map((card) => card.t)).toEqual(["textwords", "text", "text"]);
    expect(cards[0].words).toEqual([3, 4]);
    expect(new Set(cards.slice(1).map((card) => card.text?.track)).size).toBe(1);
    expect(plan.words[3]).toBeDefined();
    expect(plan.summary.newTexts).toBe(1);
    // Today's new text time is spent: no new text; the day's first one may be longer than the cap.
    const spent = learner({ today: { ...learner().today, newTextSec: { listening: 880, reading: 880 } } });
    expect(planOf(buildSession(withTexts(base(), [item]), spent, defaults, NOW, TODAY, opts({ lengthMin: 15 }))).queue.some((card) => card.t === "text")).toBe(false);
    const huge = text(2, { tracks: ["reading"], wordCount: 1200 });
    expect(planOf(buildSession(withTexts(base(), [huge]), learner(), defaults, NOW, TODAY, opts({ lengthMin: 30, scope: "reading", text: "confirmed" }))).queue.some((card) => card.t === "text")).toBe(true);
  });

  it("«شنیداری» and «خواندن» are texts first; listening fills the rest with drills; a text longer than the session is asked about", () => {
    const item = text(1, { tracks: ["reading"] });
    const reading = planOf(buildSession(withTexts(base(), [item]), learner(), defaults, NOW, TODAY, opts({ scope: "reading" })));
    expect(reading.queue.map((card) => card.t)).toEqual(["text", "text"]);
    const long = text(2, { tracks: ["reading"], wordCount: 1200 });
    expect(buildSession(withTexts(base(), [long]), learner(), defaults, NOW, TODAY, opts({ scope: "reading" }))).toMatchObject({ kind: "ask_text_session", textId: 2 });
    expect(planOf(buildSession(withTexts(base(), [long]), learner(), defaults, NOW, TODAY, opts({ scope: "reading", text: "confirmed" }))).queue.map((card) => card.t)).toEqual(["text", "text"]);
    // Without sound no listening text.
    const heard = text(3, { tracks: ["listening"] });
    const quiet = buildSession(withTexts(base(), [heard]), learner(), defaults, NOW, TODAY, opts({ scope: "listening", noAudio: true }));
    expect(quiet.kind !== "plan" || !quiet.plan.queue.some((card) => card.t === "text")).toBe(true);
  });

  it("a text played: the first round is scored and kept half-way, the round with help is practice and ends attempt 1", () => {
    const item = text(1, { tracks: ["reading"] });
    const content = withTexts(base(), [item]);
    let plan = planOf(buildSession(content, learner(), defaults, NOW, TODAY, opts({ scope: "reading" })));
    const [q1, q2, q3, q4] = item.questions.reading.A;
    const first = playCard(plan, plan.queue[0].id, { answers: { [q1.id]: { choice: q1.type === "mcq" ? q1.correct : 0 }, [q2.id]: { idk: true }, [q3.id]: { choice: 2 } } }, { latencyMs: 0, elapsedSec: 60 }, playEnv(content));
    if (!first.done || !first.text) throw new Error("text not graded");
    expect(first.text).toMatchObject({ kind: "text_attempt", stage: "first", newSec: Math.round(attemptCost(item, "reading", { attempt: 1, set: "A" }, defaults)) });
    expect(first.text.graded.map((row) => row.result)).toEqual(["correct", "idk", q3.type === "mcq" && q3.correct === 2 ? "correct" : "wrong", "idk"]);
    expect(first.text.state).toMatchObject({ firstScore: first.text.score, attemptsDone: 0, partial: { stage: "help" } });
    expect(first.text.graded.find((row) => row.questionId === q4.id)?.result).toBe("idk");
    plan = first.advanced.plan;
    expect(plan.textStates["x:1"]?.partial?.answers).toEqual(expect.objectContaining({ [q1.id]: expect.anything() }));

    const help = playCard(plan, plan.queue[0].id, { answers: Object.fromEntries(item.questions.reading.A.map((q) => [q.id, { choice: q.type === "mcq" ? q.correct : 0 }])) }, { latencyMs: 0, elapsedSec: 60 }, playEnv(content));
    if (!help.done || !help.text) throw new Error("text not graded");
    expect(help.text).toMatchObject({ kind: "practice", stage: "help", score: 1, newSec: 0 });
    expect(help.text.state).toMatchObject({ attemptsDone: 1, firstScore: first.text.score, partial: null });
    expect(help.advanced.plan.queue).toEqual([]);
  });

  it("a timed reading that ran out counts the questions left wrong, not «نمی‌دانم»", () => {
    const question = mcq(1);
    expect(gradeQuestion(question, undefined, { lang: "fr" }).result).toBe("idk");
    expect(gradeQuestion(question, undefined, { lang: "fr", timedOut: true }).result).toBe("wrong");
    expect(gradeQuestion(question, { idk: true }, { lang: "fr", timedOut: true }).result).toBe("idk");
  });
});

describe("questions (PRD §7.3)", () => {
  const base = { id: 1, prompt: "?", promptFa: null, explanationFa: null };
  const right = (question: QuestionC, answer: Parameters<typeof gradeQuestion>[1]) => gradeQuestion(question, answer, { lang: "fr" }).result;

  it("each kind has one right answer; order, match and cloze only when every part is right", () => {
    expect(right({ ...base, type: "tf", correct: false }, { value: false })).toBe("correct");
    expect(right({ ...base, type: "order", items: ["a", "b", "c"], correctOrder: [2, 0, 1] }, { order: [2, 0, 1] })).toBe("correct");
    expect(right({ ...base, type: "order", items: ["a", "b", "c"], correctOrder: [2, 0, 1] }, { order: [2, 1, 0] })).toBe("wrong");
    const match: QuestionC = { ...base, type: "match", left: ["a", "b"], right: ["x", "y"], pairs: [[0, 1], [1, 0]] };
    expect(right(match, { pairs: [[1, 0], [0, 1]] })).toBe("correct");
    expect(right(match, { pairs: [[0, 1]] })).toBe("wrong");
    const cloze: QuestionC = { ...base, type: "cloze", textWithGaps: "_ _", bank: ["un", "deux", "trois"], answers: ["un", "deux"] };
    expect(right(cloze, { fills: ["un", "deux"] })).toBe("correct");
    expect(right(cloze, { fills: ["un", "trois"] })).toBe("wrong");
    expect(right({ ...base, type: "find", correctSentence: 3 }, { sentence: 3 })).toBe("correct");
    expect(right({ ...base, type: "ctx", word: "x", options: ["a", "b"], correct: 1 }, { choice: 0 })).toBe("wrong");
  });

  it("a number, a time or a price: Persian digits and spaces are fine", () => {
    const price: QuestionC = { ...base, type: "num", answer: "12,50", accepted: ["12,50", "12.50"] };
    expect(right(price, { text: "۱۲,۵۰" })).toBe("correct");
    expect(right(price, { text: " 12.50 " })).toBe("correct");
    expect(right(price, { text: "12" })).toBe("wrong");
    expect(right(price, { text: "" })).toBe("wrong");
  });

  it("a dictation: nine of ten words is right, names are not scored", () => {
    const dict: QuestionC = { ...base, type: "dict", sentence: 0 };
    const sentence = { text: "Marie a mangé une soupe chaude dans la petite cuisine.", names: ["Marie"] };
    const graded = gradeQuestion(dict, { text: "a mange une soupe chaude dans la petite cuisine" }, { lang: "fr", sentence });
    expect(graded.result).toBe("correct");
    // The name is not one of the nine words: one word wrong of nine is below 90%.
    expect(gradeQuestion(dict, { text: "a mangé une soup chaude dans la petite cuisine" }, { lang: "fr", sentence }).result).toBe("wrong");
    expect(graded.marks?.[0]).toBeNull();
    expect(stageScore([graded, { questionId: 2, result: "idk", raw: null }])).toBe(0.5);
  });
});

/**
 * The alphabet and sounds module (PRD §8): the next round, the questions of each kind of lesson, the
 * lesson after a round, «بعداً», and where the round sits in a session (§8.4, §10.7 rule 3, T22, T74).
 */
import { describe, expect, it } from "vitest";
import { newItemState } from "@/engine/answer";
import type { Content, PhonicsC } from "@/engine/content";
import type { Ex } from "@/engine/ex";
import { emptyCard, rateCard, withDue } from "@/engine/fsrs";
import { grade } from "@/engine/grade";
import { afterPhonicsRound, buildPhonicsRound, nextPhonicsRound, phonicsProgress, phonicsScore, phonicsSkipsAfter, type PhonicsRound } from "@/engine/phonics";
import { seeded } from "@/engine/random";
import { buildSession, type BuildOptions, type BuildResult } from "@/engine/session/build";
import { playCard, type PlayEnv } from "@/engine/session/play";
import type { Card, SessionPlan } from "@/engine/session/types";
import type { Settings } from "@/engine/settings";
import type { LearnerSnapshot, PhonicsStateE } from "@/engine/state";
import { tehranDate, tehranDayStart, addDays } from "@/engine/time";
import { makeEnv } from "@/engine/session/views";
import { syntheticContent } from "../../../fixtures/synthetic";
import { always, playSession } from "../../../fixtures/synthetic/drive";
import { freshLearner, newDay, record } from "../../../fixtures/synthetic/learner";
import { settings } from "./kit";

const NOW = new Date("2026-03-21T08:00:00Z");
const TODAY = tehranDate(NOW);
const TOMORROW = tehranDayStart(addDays(TODAY, 1));
const s = settings();
const content = syntheticContent({ phonics: 14 });
const lessonOf = (kind: PhonicsC["kind"]) => content.phonics.find((lesson) => lesson.kind === kind)!;

const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({ scope: "mixed", lengthMin: 10, noAudio: false, cap: null, seed: "phonics", ...over });
const learner = (over: Partial<LearnerSnapshot> = {}, auto = true): LearnerSnapshot => ({ ...newDay(freshLearner("fr", { sessionLength: 10, phonicsAuto: auto }), TODAY), ...over });
const state = (lessonId: number, roundsDone: number, nextAt: Date | null, done = false, lastScore: number | null = 1): PhonicsStateE => ({
  lessonId,
  roundsDone,
  lastScore,
  nextAt: nextAt?.toISOString() ?? null,
  done,
});

function planOf(result: BuildResult): SessionPlan {
  if (result.kind !== "plan") throw new Error(`Expected a plan, got ${result.kind}`);
  return result.plan;
}

function round(pick: PhonicsRound, userId = 1, seed = "q"): Ex[] {
  const env = makeEnv(content, freshLearner("fr"), s, seeded(seed));
  const built = buildPhonicsRound(env, pick, userId, { index: 1, total: content.phonics.length });
  if (!built) throw new Error("no round");
  return built.questions;
}

const choiceTexts = (ex: Ex) => (ex.a.kind === "choice" ? ex.a.options.map((option) => option.text).sort() : []);
const correctText = (ex: Ex) => (ex.a.kind === "choice" ? ex.a.options.find((option) => option.id === (ex.a as { correct: string }).correct)!.text : null);
const playEnv = (now = NOW): PlayEnv => ({ ctx: { settings: s, now, today: tehranDate(now), latency: {} }, language: "fr", wordsWithLemma: () => [] });

describe("which round comes next (PRD §8.3, §8.4)", () => {
  const [first, second, third] = content.phonics;

  it("starts with round 1 of the first lesson, and opens a lesson only after round 1 of the one before", () => {
    expect(nextPhonicsRound(content, [], NOW)).toMatchObject({ lesson: { id: first.id }, round: 1, repeat: false });
    // Round 1 of the first lesson done today: round 2 waits for tomorrow, so round 1 of the second comes.
    const states = [state(first.id, 1, TOMORROW)];
    expect(nextPhonicsRound(content, states, NOW)).toMatchObject({ lesson: { id: second.id }, round: 1 });
    // Tomorrow round 2 of the first comes before anything new.
    expect(nextPhonicsRound(content, [...states, state(second.id, 1, TOMORROW)], TOMORROW)).toMatchObject({ lesson: { id: first.id }, round: 2, repeat: false });
  });

  it("repeats round 2 once after a low score, then the lesson is over whatever the score (T-rule of §8.3)", () => {
    const low = afterPhonicsRound(state(first.id, 1, null), first.id, 2, 0.5, NOW, s);
    expect(low).toMatchObject({ roundsDone: 2, done: false, nextAt: TOMORROW.toISOString(), lastScore: 0.5 });
    expect(nextPhonicsRound(content, [low], NOW)).toMatchObject({ lesson: { id: second.id }, round: 1 });
    expect(nextPhonicsRound(content, [low], TOMORROW)).toMatchObject({ lesson: { id: first.id }, round: 2, repeat: true });
    expect(afterPhonicsRound(low, first.id, 2, 0.2, TOMORROW, s)).toMatchObject({ roundsDone: 3, done: true, nextAt: null });
    // A good round 2 ends the lesson at once; round 1 never ends it, however it went.
    expect(afterPhonicsRound(state(first.id, 1, null), first.id, 2, 0.6, NOW, s)).toMatchObject({ roundsDone: 2, done: true });
    expect(afterPhonicsRound(null, first.id, 1, 0, NOW, s)).toMatchObject({ roundsDone: 1, done: false, nextAt: TOMORROW.toISOString() });
  });

  it("counts «درس ۳ از ۱۴» and knows when every lesson is over", () => {
    expect(phonicsProgress(content, [])).toEqual({ index: 1, total: 14, done: false });
    expect(phonicsProgress(content, [state(first.id, 1, TOMORROW), state(second.id, 2, null, true)])).toEqual({ index: 3, total: 14, done: false });
    const all = content.phonics.map((lesson) => state(lesson.id, 2, null, true));
    expect(phonicsProgress(content, all)).toEqual({ index: 14, total: 14, done: true });
    expect(nextPhonicsRound(content, all, NOW)).toBeNull();
    expect(phonicsProgress({ phonics: [] }, [])).toEqual({ index: 0, total: 0, done: false });
  });

  it("follows a new teacher's order: the next round 1 is the first lesson not started (PRD §13.6)", () => {
    const reordered: Pick<Content, "phonics"> = { phonics: [third, first, second] };
    expect(nextPhonicsRound(reordered, [state(first.id, 2, null, true)], NOW)).toMatchObject({ lesson: { id: third.id }, round: 1 });
  });
});

describe("the questions of a round (PRD §8.2, §8.3)", () => {
  it("contrast, round 1: P1 and P4 in turn, three of each, with the options the PRD names", () => {
    const lesson = lessonOf("contrast");
    const questions = round({ lesson, round: 1, repeat: false });
    expect(questions.map((ex) => ex.code)).toEqual(["P1", "P4", "P1", "P4", "P1", "P4"]);
    for (const ex of questions.filter((item) => item.code === "P1")) {
      const word = lesson.words.find((item) => item.text === ex.q.heard!.text)!;
      expect(ex.listen).toBe(word.speak);
      expect(choiceTexts(ex)).toEqual([word.text, ...word.wrong].sort());
      expect(correctText(ex)).toBe(word.text);
    }
    for (const ex of questions.filter((item) => item.code === "P4")) {
      const pair = lesson.pairs.find((item) => item.a.text === ex.q.heard!.text)!;
      const options = ex.a.kind === "choice" ? ex.a.options : [];
      expect(options.every((option) => !!option.speak)).toBe(true);
      expect(correctText(ex)).toBe(pair.a.text);
      expect(options.map((option) => option.text)).toContain(pair.b.text);
      const other = options.find((option) => option.text !== pair.a.text && option.text !== pair.b.text)!;
      expect(lesson.pairs.some((item) => item !== pair && item.b.text === other.text)).toBe(true);
    }
    expect(questions.every((ex) => ex.idk && ex.audio && ex.item === `p:${lesson.id}`)).toBe(true);
  });

  it("contrast, round 2: P2 and P3 in turn; P2 has both a same and a different pair; P3's odd one is a `b`", () => {
    const lesson = lessonOf("contrast");
    for (const seed of ["a", "b", "c", "d"]) {
      const questions = round({ lesson, round: 2, repeat: false }, 1, seed);
      expect(questions.map((ex) => ex.code)).toEqual(["P2", "P3", "P2", "P3", "P2", "P3"]);
      const told = questions.filter((ex) => ex.code === "P2");
      const answers = told.map((ex) => (ex.a.kind === "choice" ? ex.a.correct : null));
      expect(answers).toContain("same");
      expect(answers).toContain("different");
      for (const ex of told) {
        const [one, two] = ex.q.sounds!;
        const same = one.text === two.text;
        expect(ex.a.kind === "choice" && ex.a.correct).toBe(same ? "same" : "different");
        // «same» is `a` twice; «different» is `a` and `b` of one pair.
        if (same) expect(lesson.pairs.some((pair) => pair.a.text === one.text)).toBe(true);
        else expect(lesson.pairs.some((pair) => [pair.a.text, pair.b.text].sort().join() === [one.text, two.text].sort().join())).toBe(true);
      }
      for (const ex of questions.filter((item) => item.code === "P3")) {
        const odd = correctText(ex)!;
        const rest = choiceTexts(ex).filter((text) => text !== odd);
        expect(lesson.pairs.some((pair) => pair.b.text === odd)).toBe(true);
        expect(rest.every((text) => lesson.pairs.some((pair) => pair.a.text === text))).toBe(true);
        expect(new Set(rest).size).toBe(2);
      }
    }
  });

  it("rule: six P1; round 2 asks first the words round 1 did not, the same for one learner every time", () => {
    const lesson = lessonOf("rule");
    const heard = (list: Ex[]) => list.map((ex) => ex.q.heard!.text);
    const first = heard(round({ lesson, round: 1, repeat: false }, 7, "x"));
    expect(first).toHaveLength(6);
    expect(new Set(first).size).toBe(6);
    expect(new Set(heard(round({ lesson, round: 1, repeat: false }, 7, "y")))).toEqual(new Set(first));
    const second = heard(round({ lesson, round: 2, repeat: false }, 7, "z"));
    expect(second).toHaveLength(6);
    const unused = lesson.words.map((word) => word.text).filter((text) => !first.includes(text));
    expect(unused).toHaveLength(2);
    for (const text of unused) expect(second).toContain(text);
  });

  it("liaison: two sample sentences, four P5; round 2 the sentences round 1 did not ask", () => {
    const lesson = lessonOf("liaison");
    const env = makeEnv(content, freshLearner("fr"), s, seeded("l"));
    const built = buildPhonicsRound(env, { lesson, round: 1, repeat: false }, 3, { index: 3, total: 14 })!;
    expect(built.view.samples).toHaveLength(2);
    expect(built.questions.map((ex) => ex.code)).toEqual(["P5", "P5", "P5", "P5"]);
    const text = (ex: Ex) => (ex.a.kind === "liaison" ? ex.a.words.join(" ") : "");
    const asked = built.questions.map(text);
    expect(asked.some((item) => built.view.samples.some((sample) => sample.text === item))).toBe(false);
    const second = round({ lesson, round: 2, repeat: false }, 3, "m").map(text);
    const left = lesson.sentences.map((sentence) => sentence.text).filter((item) => !asked.includes(item) && !built.view.samples.some((sample) => sample.text === item));
    for (const item of left) expect(second).toContain(item);
    // P5 is right only with every liaison and nothing more; its sound comes with the feedback.
    const ex = built.questions[0];
    if (ex.a.kind !== "liaison") throw new Error("P5");
    expect(ex.audio).toBe(false);
    expect(ex.after).not.toBeNull();
    const ctx = { language: "fr" as const };
    expect(grade(ex, { gaps: [...ex.a.correct].reverse() }, ctx)).toMatchObject({ result: "correct" });
    expect(grade(ex, { gaps: [...ex.a.correct, ex.a.words.length - 2].filter((gap, i, all) => all.indexOf(gap) === i) }, ctx).result).toBe(
      ex.a.correct.includes(ex.a.words.length - 2) ? "correct" : "wrong",
    );
    expect(grade(ex, { gaps: [] }, ctx)).toMatchObject({ result: "wrong" });
    expect(grade(ex, { idk: true }, ctx)).toMatchObject({ result: "idk" });
  });

  it("scores a round by the share right; «نمی‌دانم» is not right", () => {
    expect(phonicsScore(["correct", "correct", "wrong", "idk", "correct", "correct"])).toBeCloseTo(4 / 6);
    expect(phonicsScore([])).toBe(0);
  });
});

describe("the auto mode in a session (PRD §8.4, §10.7)", () => {
  const isPhonics = (card: Card) => card.t === "phonics" || card.t === "phonicsq";

  it("T22: a learner from zero, day one, 10 minutes: three words, the phonics round, then the rest; its time taken once", () => {
    const played = playSession(content, learner(), s, NOW, opts(), always(true), seeded("t22"));
    const plan = planOf(played.build);
    const start = plan.queue.findIndex((card) => card.t === "phonics");
    // Three new words (each an intro card and its first exercise) before the round.
    expect(plan.queue.slice(0, start).map((card) => card.t)).toEqual(["intro", "ex", "intro", "ex", "intro", "ex"]);
    expect(plan.queue.slice(start + 1, start + 7).every((card) => card.t === "phonicsq")).toBe(true);
    expect(plan.queue.slice(start + 7).some(isPhonics)).toBe(false);
    expect(plan.summary).toMatchObject({ newWords: 10, newUnits: 0, newConj: 0 });
    expect(plan.queue.some((card) => ["lesson", "g0", "round", "table", "text", "drill"].includes(card.t))).toBe(false);
    expect(plan.phonics).toMatchObject({ lessonId: content.phonics[0].id, round: 1, auto: true, answers: [] });
    // The round's time comes off the session once: 600 - 80 leaves room for the ten words and no more.
    const without = planOf(buildSession(content, learner({}, false), s, NOW, TODAY, opts()));
    expect(without.summary.newWords).toBe(10);
    expect(without.queue.some(isPhonics)).toBe(false);
    // Played to the end: the lesson's round 1 is done and its round 2 waits for tomorrow.
    expect(played.learner.phonics).toEqual([state(content.phonics[0].id, 1, TOMORROW, false, 1)]);
    expect(played.results.filter((result) => result.card.t === "phonicsq").map((result) => result.log.kind)).toEqual(Array(6).fill("phonics"));
  });

  it("comes last in a session of fewer than three items", () => {
    // Two words due, no new word left today: the session holds two reviews, then the round.
    const due = [...content.words.values()].slice(0, 2).map((word) => {
      const intro = new Date(NOW.getTime() - 5 * 86_400_000);
      return { ...newItemState("word", word.id, intro), step: 2, firstReviewDone: true, fsrs: withDue(rateCard(emptyCard(intro), "good", intro, s), new Date(NOW.getTime() - 86_400_000)) };
    });
    const base = learner({ items: due });
    const capped = { ...base, today: { ...base.today, newWords: 50, wordsCapToday: 50, capPromptShown: true } };
    const plan = planOf(buildSession(content, capped, s, NOW, TODAY, opts({ scope: "vocab", cap: "none" })));
    expect(plan.queue.map((card) => card.t)).toEqual(["ex", "ex", "phonics", ...Array(6).fill("phonicsq")]);
  });

  it("only in mixed and vocabulary sessions of the auto mode, never without sound; «الفبا و تلفظ» is the round alone", () => {
    for (const scope of ["grammar", "quick", "listening", "reading", "notebook", "extra"] as const) {
      const built = buildSession(content, learner(), s, NOW, TODAY, opts({ scope }));
      if (built.kind === "plan") expect(built.plan.queue.some(isPhonics)).toBe(false);
    }
    expect(planOf(buildSession(content, learner(), s, NOW, TODAY, opts({ scope: "vocab" }))).queue.some(isPhonics)).toBe(true);
    expect(planOf(buildSession(content, learner(), s, NOW, TODAY, opts({ noAudio: true }))).queue.some(isPhonics)).toBe(false);
    // Not in the auto mode: only from «الفبا و تلفظ», where the session is the round and nothing else.
    const alone = planOf(buildSession(content, learner({}, false), s, NOW, TODAY, opts({ scope: "phonics" })));
    expect(alone.queue.every(isPhonics)).toBe(true);
    expect(alone.queue).toHaveLength(7);
    expect(alone.phonics).toMatchObject({ auto: false });
    expect(buildSession(content, learner({}, false), s, NOW, TODAY, opts({ scope: "phonics", noAudio: true }))).toMatchObject({ kind: "nothing_left" });
    const over = learner({ phonics: content.phonics.map((lesson) => state(lesson.id, 2, null, true)) }, false);
    expect(buildSession(content, over, s, NOW, TODAY, opts({ scope: "phonics" }))).toMatchObject({ kind: "nothing_left" });
  });

  it("T74: «بعداً» sets the round aside and counts; three in a row turn the auto mode off", () => {
    let current = learner();
    for (let n = 1; n <= 3; n++) {
      const plan = planOf(buildSession(content, current, s, NOW, TODAY, opts({ seed: `later${n}` })));
      // Play up to the round, then «بعداً».
      let live = plan;
      for (let i = 0; live.queue[0].t !== "phonics"; i++) {
        const card = live.queue[0];
        const result = playCard(live, card.id, card.ex ? { choice: card.ex.a.kind === "choice" ? card.ex.a.correct : "" } : { seen: true }, { latencyMs: 3000, elapsedSec: i * 5 }, playEnv());
        if (!result.done) throw new Error("graded");
        current = record(current, result, s, NOW, TODAY, 3000);
        live = result.advanced.plan;
      }
      const lead = live.queue[0];
      expect(lead.t).toBe("phonics");
      const result = playCard(live, lead.id, { skip: "later" }, { latencyMs: 1000, elapsedSec: 60 }, playEnv());
      if (!result.done) throw new Error("seen");
      expect(result.phonicsLater).toBe(true);
      expect(result.log).toMatchObject({ kind: "intro", itemType: "phonics_lesson", result: "idk", raw: "later" });
      expect(result.advanced.plan.queue.some(isPhonics)).toBe(false);
      current = record(current, result, s, NOW, TODAY, 1000);
      expect(current.enrollment).toMatchObject({ phonicsSkips: n, phonicsAuto: n < 3 });
      expect(current.phonics).toEqual([]);
    }
    expect(phonicsSkipsAfter(2, "round", s)).toEqual({ skips: 0, off: false });
    expect(planOf(buildSession(content, current, s, NOW, TODAY, opts({ seed: "after" }))).queue.some(isPhonics)).toBe(false);
  });

  it("a round left out without sound counts nothing; a round left half-way is not done; a finished one clears «بعداً»", () => {
    const plan = planOf(buildSession(content, learner({}, false), s, NOW, TODAY, opts({ scope: "phonics" })));
    const dropped = playCard(plan, plan.queue[0].id, { skip: "drop" }, { latencyMs: 500, elapsedSec: 1 }, playEnv());
    if (!dropped.done) throw new Error("seen");
    expect(dropped.phonicsLater).toBe(false);
    expect(dropped.advanced.finished).toBe(true);
    // «بعداً» on a round the learner chose is not counted either.
    const later = playCard(plan, plan.queue[0].id, { skip: "later" }, { latencyMs: 500, elapsedSec: 1 }, playEnv());
    expect(later.done && later.phonicsLater).toBe(false);
    // Sound turned off half-way (PRD §10.12, T62): the rest of the round goes, unscored and unwritten.
    const started = playCard(plan, plan.queue[0].id, { seen: true }, { latencyMs: 500, elapsedSec: 1 }, playEnv());
    if (!started.done) throw new Error("seen");
    const first = started.advanced.plan.queue[0];
    const answered = playCard(started.advanced.plan, first.id, { idk: true }, { latencyMs: 500, elapsedSec: 4 }, playEnv());
    if (!answered.done) throw new Error("graded");
    const silent = playCard(answered.advanced.plan, answered.advanced.plan.queue[0].id, { skip: "drop" }, { latencyMs: 500, elapsedSec: 6 }, playEnv());
    if (!silent.done) throw new Error("dropped");
    expect(silent).toMatchObject({ graded: null, phonics: null, phonicsLater: false, log: { result: "idk", raw: "drop" } });
    expect(silent.advanced).toMatchObject({ finished: true, phonicsDone: false });
    expect(silent.advanced.plan.phonics?.answers).toEqual(["idk"]);

    let current = { ...learner({}, false), enrollment: { ...learner({}, false).enrollment, phonicsSkips: 2 } };
    let live = plan;
    for (let i = 0; live.queue.length > 0; i++) {
      const card = live.queue[0];
      const result = playCard(live, card.id, card.ex ? { idk: true } : { seen: true }, { latencyMs: 2000, elapsedSec: i * 5 }, playEnv());
      if (!result.done) throw new Error("graded");
      // Half-way, nothing is written.
      if (card.t === "phonicsq" && !card.roundEnd) expect(result.phonics).toBeNull();
      current = record(current, result, s, NOW, TODAY, 2000);
      live = result.advanced.plan;
    }
    expect(current.phonics).toEqual([state(content.phonics[0].id, 1, TOMORROW, false, 0)]);
    expect(current.enrollment.phonicsSkips).toBe(0);
  });
});

/**
 * Plays sessions with a made-up learner: the right answer or a wrong one for every exercise, and
 * every card through the same `playCard` the browser and the server use.
 */
import type { Content, QuestionC } from "../../src/engine/content";
import type { Ex, RawAnswer } from "../../src/engine/ex";
import type { InvariantInput } from "../../src/engine/invariants";
import type { Rng } from "../../src/engine/random";
import type { QuestionAnswer } from "../../src/engine/questions";
import { buildSession, type BuildEffects, type BuildOptions, type BuildResult } from "../../src/engine/session/build";
import { playCard, shownEx, wantsAlt, type PlayResult } from "../../src/engine/session/play";
import type { Card, SessionPlan, TextView } from "../../src/engine/session/types";
import { num, type Settings } from "../../src/engine/settings";
import { itemKey, type LearnerSnapshot } from "../../src/engine/state";
import { folds, type Lang } from "../../src/engine/text";
import { tehranDate } from "../../src/engine/time";
import { closeLeft, finishLevels, newDay, record } from "./learner";

export function rightAnswer(ex: Ex): RawAnswer {
  const spec = ex.a;
  switch (spec.kind) {
    case "choice":
    case "spot":
      return { choice: spec.correct };
    case "choice2":
      return { choices: spec.correct };
    case "type":
      return { text: spec.accepted[0], gender: spec.gender?.correct ?? null };
    case "letters":
      return { letters: spec.hidden.map((i) => [...spec.word][i]) };
    case "tiles":
      return { tiles: spec.orders[0] };
    case "pairs":
      return { firstPair: spec.pairs[spec.target] };
    case "sort":
      return { firstSort: Object.fromEntries(spec.items.map((item) => [item.id, item.set])) };
    case "table":
      return { rows: spec.rows.map((row) => row.accepted?.[0] ?? "") };
    case "dictation":
      return { text: spec.words.map((word) => word.text).join(" ") };
  }
}

export function wrongAnswer(ex: Ex): RawAnswer {
  const spec = ex.a;
  if (spec.kind === "choice") return { choice: spec.options.find((option) => option.id !== spec.correct)!.id };
  if (ex.idk) return { idk: true };
  if (spec.kind === "pairs") return { firstPair: spec.right.find((item) => item.id !== spec.pairs[spec.target])!.id };
  if (spec.kind === "sort") return { firstSort: Object.fromEntries(spec.items.map((item) => [item.id, item.set + 1])) };
  return { idk: true };
}

/** A typed answer one small slip away (PRD §5.6): without accents, or a German noun in lower case. Null when there is none. */
export function nearAnswer(ex: Ex, language: Lang): RawAnswer | null {
  if (ex.a.kind !== "type") return null;
  const right = ex.a.accepted[0];
  const [folded] = folds(right);
  if (folded !== right) return { text: folded, gender: ex.a.gender?.correct ?? null };
  if (language === "de" && /^\p{Lu}/u.test(right) && !ex.a.sentence) return { text: right.toLowerCase(), gender: ex.a.gender?.correct ?? null };
  return null;
}

/** A wrong answer of the kind a learner gives: a wrong option, a typo, or «نمی‌دانم». */
export function slipAnswer(ex: Ex, rng: Rng): RawAnswer {
  const spec = ex.a;
  if (ex.idk && rng() < 0.3) return { idk: true };
  if (spec.kind === "type") return { text: `${spec.accepted[0].slice(0, -2)}qx`, gender: spec.gender?.buttons.find((button) => button !== spec.gender?.correct) ?? null };
  if (spec.kind === "letters") return { letters: spec.hidden.map(() => "q") };
  if (spec.kind === "table") return { rows: spec.rows.map((row) => (row.accepted ? "qx" : "")) };
  if (spec.kind === "tiles") return { tiles: [...spec.orders[0]].reverse() };
  if (spec.kind === "dictation") return { text: spec.words.slice(0, Math.ceil(spec.words.length / 2)).map((word) => word.text).join(" ") };
  return wrongAnswer(ex);
}

/** The right answer of a text question (PRD §7.3). */
export function rightQuestion(question: QuestionC, view: TextView): QuestionAnswer {
  switch (question.type) {
    case "mcq":
    case "ctx":
      return { choice: question.correct };
    case "tf":
      return { value: question.correct };
    case "order":
      return { order: question.correctOrder };
    case "match":
      return { pairs: question.pairs };
    case "cloze":
      return { fills: question.answers };
    case "find":
      return { sentence: question.correctSentence };
    case "num":
      return { text: question.accepted[0] };
    case "dict":
      return { text: view.sentences[question.sentence]?.text ?? "" };
  }
}

/** A wrong answer of a text question. */
export function wrongQuestion(question: QuestionC): QuestionAnswer {
  switch (question.type) {
    case "mcq":
    case "ctx":
      return { choice: (question.correct + 1) % question.options.length };
    case "tf":
      return { value: !question.correct };
    case "order":
      return { order: [...question.correctOrder].reverse() };
    case "match":
      return { pairs: question.pairs.map(([left], i) => [left, question.pairs[(i + 1) % question.pairs.length][1]] as [number, number]) };
    case "cloze":
      return { fills: question.answers.map(() => "qx") };
    case "find":
      return { sentence: question.correctSentence + 1 };
    case "num":
      return { text: "0" };
    case "dict":
      return { text: "qx" };
  }
}

/** The answers of a text stage: each question right with its chance, else wrong or now and then «نمی‌دانم». */
export function textAnswers(plan: SessionPlan, card: Card, rng: Rng, chance: number | ((question: QuestionC) => number)): RawAnswer {
  const info = card.text!;
  const view = plan.texts[info.textId];
  const answers: Record<string, QuestionAnswer> = {};
  for (const question of view.questions[info.set]) {
    const p = typeof chance === "number" ? chance : chance(question);
    answers[String(question.id)] = rng() < p ? rightQuestion(question, view) : rng() < 0.3 ? { idk: true } : wrongQuestion(question);
  }
  return { answers };
}

/** How a made-up learner answers a card; `plan` and `at` let a model of memory look at the item's state. */
export type Policy = (card: Card, ex: Ex | null, rng: Rng, info: { plan: SessionPlan; at: Date }) => { answer: RawAnswer; latencyMs: number };

/** Right with probability `p` (a tenth of the typed ones a near slip), else a wrong option, a typo or «نمی‌دانم». */
export const randomPolicy =
  (p: number, language: Lang): Policy =>
  (card, ex, rng, info) => {
    const latencyMs = 2000 + Math.floor(rng() * 14000);
    if (card.t === "text") return { answer: textAnswers(info.plan, card, rng, p), latencyMs: latencyMs * 10 };
    if (!ex) return { answer: { seen: true }, latencyMs };
    if (rng() >= p) return { answer: slipAnswer(ex, rng), latencyMs };
    return { answer: (rng() < 0.1 && nearAnswer(ex, language)) || rightAnswer(ex), latencyMs };
  };

export const always =
  (right: boolean): Policy =>
  (card, ex, rng, info) => ({
    answer: card.t === "text" ? textAnswers(info.plan, card, rng, right ? 1 : 0) : ex ? (right ? rightAnswer(ex) : wrongAnswer(ex)) : { seen: true },
    latencyMs: 6000,
  });

export const withAccuracy =
  (p: number): Policy =>
  (card, ex, rng, info) => ({
    answer: card.t === "text" ? textAnswers(info.plan, card, rng, p) : ex ? (rng() < p ? rightAnswer(ex) : wrongAnswer(ex)) : { seen: true },
    latencyMs: 3000 + Math.floor(rng() * 9000),
  });

export type Played = {
  learner: LearnerSnapshot;
  plan: SessionPlan | null;
  results: Extract<PlayResult, { done: true }>[];
  /** Milliseconds each card took, beside `results`. */
  latencies: number[];
  build: BuildResult;
  left: boolean;
};

export type PlayOptions = {
  /** Leave after this many cards: the session closes the way the server closes it. */
  leaveAfter?: number;
  /** «الان نمی‌توانم گوش بدهم» after this many cards (PRD §10.12). */
  muteAfter?: number;
  /** Called after the build and after every card with what `checkInvariants` takes. */
  check?: (input: InvariantInput) => void;
  /** The answer to «پیش از جلسه متن» (PRD §10.11); «شروع» when not given. */
  textAsk?: () => "confirmed" | "later";
};

/** Builds a session and plays its cards with the policy. */
export function playSession(content: Content, learner0: LearnerSnapshot, settings: Settings, now: Date, opts: BuildOptions, policy: Policy, rng: Rng, play: PlayOptions = {}): Played {
  const today = tehranDate(now);
  let before = newDay(learner0, today);
  let build = buildSession(content, before, settings, now, today, opts);
  // The server writes a build's effects whatever it returns (pace, spread, the word cap).
  let learner = applyEffects(before, build.effects, today);
  play.check?.({ content, settings, learner, now, today, build: { result: build, opts, before } });
  // «پیش از جلسه متن»: «شروع» builds the text session, «بعداً» a normal one and no question again today (PRD §10.11).
  if (build.kind === "ask_text_session") {
    const answer = play.textAsk?.() ?? "confirmed";
    before = answer === "later" ? { ...learner, enrollment: { ...learner.enrollment, textPromptDate: today } } : learner;
    const again = { ...opts, text: answer };
    build = buildSession(content, before, settings, now, today, again);
    learner = applyEffects(before, build.effects, today);
    play.check?.({ content, settings, learner, now, today, build: { result: build, opts: again, before } });
  }
  if (build.kind !== "plan") return { learner, plan: null, results: [], latencies: [], build, left: false };
  let plan = build.plan;
  const results: Extract<PlayResult, { done: true }>[] = [];
  const latencies: number[] = [];
  let elapsed = 0;
  const wordsWithLemma = (lemma: string) => content.lemmaIndex.get(lemma) ?? [];
  for (let index = 0; plan.queue.length > 0 && index < 2000; index++) {
    const at = new Date(now.getTime() + elapsed * 1000);
    if (play.leaveAfter !== undefined && index >= play.leaveAfter) {
      // Left in the middle of a text: the browser's last progress note is kept for `text.resume_hours` (PRD §7.4).
      if (plan.queue[0].t === "text" && rng() < 0.5) learner = leftInText(learner, plan, plan.queue[0], rng, at, settings);
      learner = closeLeft(learner, plan, settings, at, today);
      play.check?.({ content, settings, learner, now: at, today });
      return { learner, plan, results, latencies, build, left: true };
    }
    const card = plan.queue[0];
    const alt = wantsAlt(plan, card, { muted: play.muteAfter !== undefined && index >= play.muteAfter, noVoice: false, waitedSec: null }, settings);
    const ex = card.t === "intro" || card.t === "lesson" || card.t === "table" || card.t === "confusion" || card.t === "textwords" || card.t === "text" ? null : shownEx(plan, card, alt);
    const { answer, latencyMs } = policy(card, ex, rng, { plan, at });
    elapsed += latencyMs / 1000;
    const ctx = { settings, now: at, today, latency: plan.latency };
    const timing = { latencyMs, elapsedSec: elapsed, alt };
    let result = playCard(plan, card.id, answer, timing, { ctx, language: content.language, wordsWithLemma });
    if (!result.done) result = playCard(plan, card.id, { idk: true }, timing, { ctx, language: content.language, wordsWithLemma });
    if (!result.done) throw new Error("idk is always graded");
    learner = record(learner, result, settings, at, today, latencyMs);
    play.check?.({ content, settings, learner, now: at, today, played: { result, plan, alt } });
    plan = result.advanced.plan;
    results.push(result);
    latencies.push(latencyMs);
  }
  if (plan.queue.length === 0) {
    learner = finishLevels(learner, content, settings, now);
    // Finished mixed sessions in a row without a text attempt (PRD §10.11 condition 3).
    if (opts.scope === "mixed") learner = { ...learner, mixedWithoutText: results.some((result) => result.text) ? 0 : learner.mixedWithoutText + 1 };
  }
  return { learner, plan, results, latencies, build, left: false };
}

/** The progress note of a text stage left half-way: some answers, a play used, a place in the sound (PRD §7.4). */
function leftInText(learner: LearnerSnapshot, plan: SessionPlan, card: Card, rng: Rng, at: Date, settings: Settings): LearnerSnapshot {
  const info = card.text!;
  const before = learner.texts.find((item) => item.textId === info.textId && item.track === info.track);
  const given = textAnswers(plan, card, rng, 0.7) as { answers: Record<string, QuestionAnswer> };
  const answers = Object.fromEntries(Object.entries(given.answers).slice(0, Math.floor(rng() * Object.keys(given.answers).length)));
  const partial = { attempt: info.attempt, stage: info.stage, answers, plays: Math.min(1, info.rules.plays ?? 1), positionMs: 0, ...(info.borrowed ? { borrowed: true } : {}) };
  const state = before ?? {
    textId: info.textId,
    track: info.track,
    attemptsDone: 0,
    firstScore: null,
    scores: [],
    lastAttemptAt: null,
    nextAttemptAt: null,
    partial: null,
    partialUntil: null,
    usedInTest: false,
  };
  const next = { ...state, partial, partialUntil: new Date(at.getTime() + num(settings, "text.resume_hours") * 3_600_000).toISOString() };
  return { ...learner, texts: [...learner.texts.filter((item) => !(item.textId === info.textId && item.track === info.track)), next] };
}

/** What a build writes before the session starts (PRD §10.2): pace, spread backlog, the word cap. */
export function applyEffects(learner: LearnerSnapshot, effects: BuildEffects, today: string): LearnerSnapshot {
  const deferred = new Map(effects.spread.map((item) => [item.key, item.deferredUntil]));
  return {
    ...learner,
    enrollment: { ...learner.enrollment, paceMode: effects.paceMode, lastSpreadDate: effects.lastSpreadDate },
    items: learner.items.map((item) => {
      const key = itemKey(item.itemType, item.itemId);
      return deferred.has(key) ? { ...item, deferredUntil: deferred.get(key)! } : item;
    }),
    today: {
      ...learner.today,
      date: today,
      wordsCapToday: effects.wordsCapToday,
      capPromptShown: effects.capPromptShown,
      textSessionDone: learner.today.textSessionDone || effects.textSession,
    },
  };
}

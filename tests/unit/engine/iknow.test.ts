/**
 * «این را بلدم» and the pretest mode (PRD §11.5): the button on fresh intro cards and lessons, its daily
 * cap, the probation card it makes and the cards that leave; the pretest mode turning on and off, the W1a
 * before the intro card, the words that never get one, and the daily counts. Content is made up.
 */
import { describe, expect, it } from "vitest";
import { applyRound, probationState, type AnswerCtx, type RoundAnswer } from "@/engine/answer";
import type { Content } from "@/engine/content";
import type { RawAnswer } from "@/engine/ex";
import { isStableUnit } from "@/engine/levels";
import { newWordEvents, pretestModeAfter, type NewWordEvent } from "@/engine/pretest";
import { buildSession, type BuildOptions } from "@/engine/session/build";
import { nextUnit } from "@/engine/session/newmaterial";
import { playCard, shownEx, type PlayEnv, type PlayResult } from "@/engine/session/play";
import type { Card, SessionPlan } from "@/engine/session/types";
import type { Settings } from "@/engine/settings";
import { itemKey, type ItemStateE, type LearnerSnapshot } from "@/engine/state";
import { addDays, plusDays, tehranDate } from "@/engine/time";
import { syntheticContent } from "../../../fixtures/synthetic";
import { rightAnswer, wrongAnswer } from "../../../fixtures/synthetic/drive";
import { freshLearner, newDay, record, type SimLearner } from "../../../fixtures/synthetic/learner";
import { settings } from "./kit";

const NOW = new Date("2026-03-21T08:00:00Z");
const TODAY = tehranDate(NOW);
const content: Content = syntheticContent({ perLevel: { words: [80, 40, 40, 40], units: [8, 4, 4, 4] }, textsPerLevel: 0 });
const s = settings({ "session.overrun": 600 });
const on = settings({ "session.overrun": 600, "feature.pretest": true });
const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({ scope: "vocab", lengthMin: 15, noAudio: false, cap: null, seed: "iknow", ...over });

function learner(over: Partial<SimLearner> = {}): SimLearner {
  return { ...newDay(freshLearner("fr", { sessionLength: 15 }), TODAY), ...over };
}

/** Grammar open from the start, as after placement at A2 (PRD §10.3, T25). */
const placed = syntheticContent({ unitWordsLevel: "A2", textsPerLevel: 0 });
const grammarLearner = (): SimLearner => newDay(freshLearner("fr", { vocabLevel: "A2", knownBelow: "A2" }), TODAY);

function plan(who: LearnerSnapshot, set: Settings = s, o: Partial<BuildOptions> = {}): SessionPlan {
  const built = buildSession(content, who, set, NOW, TODAY, opts(o));
  if (built.kind !== "plan") throw new Error(`no plan: ${built.kind}`);
  return built.plan;
}

const env = (p: SessionPlan, set: Settings = s): PlayEnv => ({ ctx: { settings: set, now: NOW, today: TODAY, latency: p.latency }, language: "fr", wordsWithLemma: (lemma) => content.lemmaIndex.get(lemma) ?? [] });
const timing = { latencyMs: 3000, elapsedSec: 10, alt: false };
const isEx = (card: Card) => !["intro", "lesson", "table", "confusion", "textwords", "text"].includes(card.t);

function play(p: SessionPlan, answer: RawAnswer, set: Settings = s): Extract<PlayResult, { done: true }> {
  const result = playCard(p, p.queue[0].id, answer, timing, env(p, set));
  if (!result.done) throw new Error("not final");
  return result;
}

/** Plays until `stop` says so on the next card; every other card answered right (or seen). */
function until(p: SessionPlan, who: SimLearner, stop: (card: Card) => boolean, set: Settings = s): { plan: SessionPlan; learner: SimLearner } {
  let current = p;
  let state = who;
  for (let i = 0; i < 300 && current.queue.length > 0 && !stop(current.queue[0]); i++) {
    const card = current.queue[0];
    const ex = isEx(card) ? shownEx(current, card, false) : null;
    const result = play(current, ex ? rightAnswer(ex) : { seen: true }, set);
    state = record(state, result, set, NOW, TODAY, 3000);
    current = result.advanced.plan;
  }
  return { plan: current, learner: state };
}

describe("«این را بلدم» (PRD §11.5)", () => {
  it("is on every fresh intro card with the probation step of its word, and on a fresh lesson with step 5", () => {
    const recognize = syntheticContent({ perLevel: { words: [80, 40, 40, 40], units: [8, 4, 4, 4] }, textsPerLevel: 0 });
    recognize.words.get(1)!.mastery = "recognize";
    const built = buildSession(recognize, learner(), s, NOW, TODAY, opts());
    const p = (built as { plan: SessionPlan }).plan;
    const intros = p.queue.filter((card) => card.t === "intro");
    expect(intros.length).toBeGreaterThan(0);
    for (const card of intros) expect(card.probationStep).toBe(card.item === "w:1" ? 3 : 5);
    expect(p.counters.iknowLeft).toBe(10);
    const grammar = (buildSession(placed, grammarLearner(), s, NOW, TODAY, opts({ scope: "grammar" })) as { plan: SessionPlan }).plan;
    const lesson = grammar.queue.find((card) => card.t === "lesson")!;
    expect(lesson.fresh).toBe(true);
    expect(lesson.probationStep).toBe(5);
  });

  it("on a word: a single probation card (source i_know) a week away, its first exercise leaves, not a new word today", () => {
    const p = plan(learner());
    expect(p.queue[0].t).toBe("intro");
    const key = p.queue[0].item;
    const result = play(p, { iknow: true });
    expect(result.state).toMatchObject({ itemType: "word", step: 5, probation: "single", source: "i_know" });
    expect(Date.parse(result.state!.fsrs.due) - NOW.getTime()).toBeGreaterThan(5 * 86_400_000);
    expect(result.advanced.plan.queue.some((card) => card.item === key)).toBe(false);
    expect(result.advanced.plan.counters.iknowLeft).toBe(9);
    expect(result.log).toMatchObject({ kind: "intro", raw: "iknow" });
    const after = record(learner(), result, s, NOW, TODAY, 3000);
    expect(after.today).toMatchObject({ iKnow: 1, newWords: 0 });
  });

  it("on a word in the queue: the queue row goes and the word keeps the source i_know", () => {
    const tapped = learner({ queue: [{ wordId: 70, source: "tap", addedAt: NOW.toISOString() }] });
    const p = plan(tapped);
    expect(p.queue[0].item).toBe("w:70");
    const result = play(p, { iknow: true });
    const after = record(tapped, result, s, NOW, TODAY, 3000);
    expect(after.queue).toEqual([]);
    expect(after.items.find((item) => item.itemId === 70)?.source).toBe("i_know");
    expect(after.today).toMatchObject({ iKnow: 1, newWords: 0, queueWords: 0 });
  });

  it("on a lesson: the unit's warm-ups and round leave, a step-5 probation card, and the next unit opens", () => {
    const p = (buildSession(placed, grammarLearner(), s, NOW, TODAY, opts({ scope: "grammar" })) as { plan: SessionPlan }).plan;
    const before = { plan: p, learner: grammarLearner() };
    const lesson = before.plan.queue[0];
    expect(lesson).toMatchObject({ t: "lesson", fresh: true, probationStep: 5 });
    const result = play(before.plan, { iknow: true });
    expect(result.state).toMatchObject({ itemType: "grammar_unit", step: 5, probation: "single", source: "i_know" });
    expect(result.advanced.plan.queue.some((card) => card.block === lesson.block)).toBe(false);
    const after = record(before.learner, result, s, NOW, TODAY, 3000);
    expect(after.today).toMatchObject({ iKnow: 1, newUnits: 0 });
    const units = new Map(after.items.filter((item) => item.itemType === "grammar_unit").map((item) => [item.itemId, item]));
    expect(isStableUnit(units.get(result.state!.itemId), s)).toBe(true);
    const next = nextUnit(placed, units, s, null);
    expect(next).not.toBeNull();
    expect(units.has(next!.id)).toBe(false);
  });

  it("the daily cap: after ten presses the button is gone until tomorrow, also in a new session", () => {
    const full = learner({ today: { ...learner().today, iKnow: 10 } });
    const p = plan(full);
    expect(p.counters.iknowLeft).toBe(0);
    expect(() => play(p, { iknow: true })).toThrow();
    const tomorrow = newDay(full, addDays(TODAY, 1));
    expect(tomorrow.today.iKnow).toBe(0);
  });

  it("ten presses in one session: the tenth leaves none, the eleventh is refused", () => {
    let p = plan(learner(), s, { lengthMin: 30 });
    let who = learner();
    let pressed = 0;
    for (let i = 0; i < 300 && p.queue.length > 0; i++) {
      const card = p.queue[0];
      if (card.probationStep && card.t === "intro") {
        if ((p.counters.iknowLeft ?? 0) === 0) {
          expect(() => play(p, { iknow: true })).toThrow();
          break;
        }
        const result = play(p, { iknow: true });
        who = record(who, result, s, NOW, TODAY, 3000);
        p = result.advanced.plan;
        pressed++;
        continue;
      }
      const ex = isEx(card) ? shownEx(p, card, false) : null;
      const result = play(p, ex ? rightAnswer(ex) : { seen: true });
      who = record(who, result, s, NOW, TODAY, 3000);
      p = result.advanced.plan;
    }
    expect(pressed).toBeLessThanOrEqual(10);
    expect(who.today.iKnow).toBe(pressed);
    expect(who.items.filter((item) => item.source === "i_know")).toHaveLength(pressed);
  });

  it("not offered again after the probation card failed: the intro card that comes back has no button (T27)", () => {
    const claimed = probationState("word", 1, 5, "single", "i_know", plusDays(NOW, -9), s);
    const who = learner({ items: [{ ...claimed, introducedAt: plusDays(NOW, -9).toISOString() }] });
    const p = plan(who, s, { scope: "vocab" });
    const at = until(p, who, (card) => card.item === "w:1");
    const card = at.plan.queue[0];
    const ex = shownEx(at.plan, card, false)!;
    expect(ex.code).toBe("W5a");
    const result = play(at.plan, wrongAnswer(ex));
    expect(result.state).toMatchObject({ step: 1, probation: "none" });
    const intro = result.advanced.plan.queue.find((other) => other.item === "w:1" && other.t === "intro");
    expect(intro).toBeDefined();
    expect(intro!.probationStep).toBeUndefined();
  });
});

describe("a unit's probation (PRD §9.7)", () => {
  const ctx: AnswerCtx = { settings: s, now: NOW, today: TODAY, latency: {} };
  const unit = content.units[0];
  const claimed: ItemStateE = probationState("grammar_unit", unit.id, 5, "single", "i_know", plusDays(NOW, -9), s);
  const round = (results: ("correct" | "wrong")[]): RoundAnswer[] => results.map((result, i) => ({ code: "G1", result, latencyMs: 4000, targetId: i + 1 }));

  it("its first round passed: probation ends, the unit goes on from step 5", () => {
    const out = applyRound(claimed, 5, round(["correct", "correct", "correct", "correct", "correct"]), ctx, 8);
    expect(out.state.probation).toBe("none");
    expect(out.state.step).toBeGreaterThanOrEqual(5);
    expect(out.lessonAgain ?? false).toBe(false);
  });

  it("its first round below a pass: Again, step 1 and the lesson again", () => {
    const out = applyRound(claimed, 5, round(["wrong", "wrong", "correct", "wrong", "wrong"]), ctx, 8);
    expect(out).toMatchObject({ rating: "again", stepAfter: 1, lessonAgain: true });
    expect(out.state).toMatchObject({ step: 1, probation: "none" });
  });
});

describe("the pretest mode (PRD §11.5)", () => {
  const ev = (...parts: [NewWordEvent, number][]) => parts.flatMap(([event, n]) => Array<NewWordEvent>(n).fill(event));

  it("turns on at five «این را بلدم» among the last twenty new words, not at four", () => {
    expect(pretestModeAfter(false, ev(["iknow", 5], ["word", 15]), s)).toBe(true);
    expect(pretestModeAfter(false, ev(["iknow", 4], ["word", 16]), s)).toBe(false);
    // Older than twenty words does not count.
    expect(pretestModeAfter(false, ev(["word", 20], ["iknow", 5]), s)).toBe(false);
  });

  it("only presses after the last pretest count, so a mode that went off needs new presses", () => {
    expect(pretestModeAfter(false, ev(["iknow", 2], ["pretest_fail", 1], ["iknow", 5]), s)).toBe(false);
    expect(pretestModeAfter(false, ev(["iknow", 5], ["pretest_fail", 10]), s)).toBe(true);
  });

  it("turns off when fewer than half of the last twenty pretests were right, once ten were asked", () => {
    expect(pretestModeAfter(true, ev(["pretest_ok", 9], ["pretest_fail", 11]), s)).toBe(false);
    expect(pretestModeAfter(true, ev(["pretest_ok", 10], ["pretest_fail", 10]), s)).toBe(true);
    expect(pretestModeAfter(true, ev(["pretest_fail", 9]), s)).toBe(true);
    expect(pretestModeAfter(true, ev(["pretest_fail", 10]), s)).toBe(false);
    // Pretests from before the mode came on (before the newest «این را بلدم») do not count.
    expect(pretestModeAfter(true, ev(["pretest_ok", 1], ["iknow", 5], ["pretest_fail", 20]), s)).toBe(true);
  });

  it("the events come from the learner's words, newest first; placement words are not new words", () => {
    const at = (days: number) => plusDays(NOW, -days).toISOString();
    const items = [
      { itemType: "word" as const, itemId: 1, source: "i_know" as const, introducedAt: at(5) },
      { itemType: "word" as const, itemId: 2, source: "pretest" as const, introducedAt: at(4) },
      { itemType: "word" as const, itemId: 3, source: "normal" as const, introducedAt: at(3) },
      { itemType: "word" as const, itemId: 4, source: "normal" as const, introducedAt: at(2) },
      { itemType: "word" as const, itemId: 5, source: "placement" as const, introducedAt: at(1) },
      { itemType: "grammar_unit" as const, itemId: 6, source: "i_know" as const, introducedAt: at(1) },
    ];
    expect(newWordEvents(items, new Set([3]))).toEqual(["word", "pretest_fail", "pretest_ok", "iknow"]);
  });
});

describe("a session in the pretest mode (PRD §11.5)", () => {
  const mode = (over: Partial<SimLearner> = {}): SimLearner => {
    const base = learner(over);
    return { ...base, enrollment: { ...base.enrollment, pretestMode: true } };
  };

  it("a new word comes first as W1a, then its intro card without «این را بلدم», then its exercise", () => {
    const p = plan(mode(), on);
    const [first, second, third] = p.queue;
    expect(first.t).toBe("pretest");
    expect(shownEx(p, first, false)!.code).toBe("W1a");
    expect(second).toMatchObject({ t: "intro", item: first.item });
    expect(second.probationStep).toBeUndefined();
    expect(third).toMatchObject({ t: "ex", item: first.item });
    expect(new Set([first.block, second.block, third.block]).size).toBe(1);
  });

  it("no pretest with the switch off, outside the mode, for a word from the queue or a new meaning", () => {
    expect(plan(mode(), s).queue.some((card) => card.t === "pretest")).toBe(false);
    expect(plan(learner(), on).queue.some((card) => card.t === "pretest")).toBe(false);
    const tapped = plan(mode({ queue: [{ wordId: 70, source: "tap", addedAt: NOW.toISOString() }] }), on);
    expect(tapped.queue[0]).toMatchObject({ t: "intro", item: "w:70", probationStep: 5 });
    const sense = syntheticContent({ perLevel: { words: [80, 40, 40, 40], units: [8, 4, 4, 4] }, textsPerLevel: 0 });
    sense.words.get(1)!.senseOf = sense.words.get(2)!.code;
    const built = buildSession(sense, mode({ items: [{ ...probationState("word", 2, 5, "none" as never, "normal", plusDays(NOW, -30), s), probation: "none", introducedAt: plusDays(NOW, -30).toISOString() }] }), on, NOW, TODAY, opts());
    const p = (built as { plan: SessionPlan }).plan;
    expect(p.queue.some((card) => card.t === "pretest" && card.item === "w:1")).toBe(false);
  });

  it("right: a single probation card (source pretest), the intro card and exercise leave, counted as passed, not as a new word", () => {
    const who = mode();
    const p = plan(who, on);
    const card = p.queue[0];
    const result = play(p, rightAnswer(shownEx(p, card, false)!), on);
    expect(result.log).toMatchObject({ kind: "pretest", result: "correct" });
    expect(result.state).toMatchObject({ probation: "single", source: "pretest", step: 5 });
    expect(result.advanced.plan.queue.some((other) => other.item === card.item)).toBe(false);
    const after = record(who, result, on, NOW, TODAY, 3000);
    expect(after.today).toMatchObject({ pretestPassed: 1, newWords: 0 });
  });

  it("wrong or «نمی‌دانم»: nothing written, the intro card and the normal path, a new word today", () => {
    const who = mode();
    const p = plan(who, on);
    const card = p.queue[0];
    const result = play(p, { idk: true }, on);
    expect(result.log).toMatchObject({ kind: "pretest", result: "idk" });
    expect(result.state).toBeNull();
    expect(result.advanced.plan.queue[0]).toMatchObject({ t: "intro", item: card.item });
    let after = record(who, result, on, NOW, TODAY, 3000);
    expect(after.pretestFailed).toEqual([Number(card.item.slice(2))]);
    const rest = until(result.advanced.plan, after, (other) => other.item !== card.item, on);
    after = rest.learner;
    expect(after.items.find((item) => itemKey(item.itemType, item.itemId) === card.item)).toMatchObject({ source: "normal", probation: "none" });
    expect(after.today).toMatchObject({ newWords: 1, pretestPassed: 0 });
  });

  it("at most pretest.daily passed a day: with 29 passed, one pretest in the session", () => {
    const who = mode({ today: { ...learner().today, pretestPassed: 29 } });
    const p = plan(who, on);
    expect(p.queue.filter((card) => card.t === "pretest")).toHaveLength(1);
    const full = plan(mode({ today: { ...learner().today, pretestPassed: 30 } }), on);
    expect(full.queue.filter((card) => card.t === "pretest")).toHaveLength(0);
    expect(full.queue.find((card) => card.t === "intro")?.probationStep).toBe(5);
  });

  it("five presses in a session turn it on, and the next session starts with pretests", () => {
    let who = learner();
    let p = plan(who, on, { lengthMin: 30 });
    for (let i = 0; i < 300 && p.queue.length > 0; i++) {
      const card = p.queue[0];
      const ex = isEx(card) ? shownEx(p, card, false) : null;
      const answer: RawAnswer = card.t === "intro" && card.probationStep && who.today.iKnow < 5 ? { iknow: true } : ex ? rightAnswer(ex) : { seen: true };
      const result = play(p, answer, on);
      who = record(who, result, on, NOW, TODAY, 3000);
      p = result.advanced.plan;
    }
    expect(who.today.iKnow).toBe(5);
    expect(who.enrollment.pretestMode).toBe(true);
    const next = buildSession(content, who, on, new Date(NOW.getTime() + 3_600_000), TODAY, opts({ seed: "next", cap: "more" }));
    expect(next.kind).toBe("plan");
    expect((next as { plan: SessionPlan }).plan.queue.some((card) => card.t === "pretest")).toBe(true);
  });
});

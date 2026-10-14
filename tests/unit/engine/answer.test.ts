import { describe, expect, it } from "vitest";
import { applyConfusion, applyRound, applySingle, newItemState, type AnswerCtx, type AnswerKind, type RoundAnswer } from "@/engine/answer";
import { emptyCard, isNewCard, rateCard, retrievability } from "@/engine/fsrs";
import type { Graded } from "@/engine/grade";
import { applyNotebook } from "@/engine/notebook";
import { updatePace } from "@/engine/pace";
import type { ConfusionE, ItemStateE, NotebookE } from "@/engine/state";
import { tehranDate, tehranDayStart, addDays } from "@/engine/time";
import { defaults, settings, word } from "./kit";

const NOW = new Date("2026-10-14T08:00:00Z");
const ctx = (over: Partial<AnswerCtx> = {}): AnswerCtx => ({ settings: defaults, now: NOW, today: tehranDate(NOW), latency: {}, ...over });
const days = (from: Date, to: string) => Math.round((Date.parse(to) - from.getTime()) / 86_400_000);
const g = (result: Graded["result"], reason: Graded["reason"] = null): Graded => ({ result, reason, chosenWordId: null, raw: "" });

/** A word that has been reviewed before and is now at `step`. */
function seasoned(step: number, extra: Partial<ItemStateE> = {}): ItemStateE {
  const start = new Date("2026-09-01T08:00:00Z");
  let state = newItemState("word", 1, start);
  state = { ...state, fsrs: rateCard(state.fsrs, "good", start, defaults), firstReviewDone: true, step, typedOnce: step > 5, ...extra };
  return state;
}

const single = (state: ItemStateE, kind: AnswerKind, code: string, graded: Graded, extra: { last?: number; gender?: boolean; latencyMs?: number; c?: AnswerCtx } = {}) =>
  applySingle({ state, kind, code, graded, latencyMs: extra.latencyMs ?? 4000, last: extra.last ?? 6, gender: extra.gender ?? false }, extra.c ?? ctx());

describe("single-exercise items (PRD §9.2)", () => {
  it("T01: a new word's first W1a right: review, Good, step 2, due in one day", () => {
    const out = single(newItemState("word", 1, NOW), "review", "W1a", g("correct"));
    expect(out).toMatchObject({ rating: "good", stepAfter: 2, followup: true, followupFormOnly: false });
    expect(days(NOW, out.state.fsrs.due)).toBe(1);
  });

  it("T02: the followup right moves the step, not FSRS", () => {
    const first = single(newItemState("word", 1, NOW), "review", "W1a", g("correct"));
    const out = single(first.state, "followup", "W2a", g("correct"));
    expect(out).toMatchObject({ rating: null, stepAfter: 3 });
    expect(out.state.fsrs).toEqual(first.state.fsrs);
  });

  it("T03: a new word's first exercise wrong: no rating, step 1, no notebook, intro again, due tomorrow; tomorrow wrong again is Again", () => {
    const out = single(newItemState("word", 1, NOW), "review", "W1a", g("wrong"));
    expect(out).toMatchObject({ rating: null, stepAfter: 1, notebook: [], introAgain: true, practice: true });
    expect(out.state.failCount).toBe(0);
    expect(isNewCard(out.state.fsrs)).toBe(true);
    expect(out.state.fsrs.due).toBe(tehranDayStart(addDays(tehranDate(NOW), 1)).toISOString());
    const tomorrow = new Date(Date.parse(out.state.fsrs.due) + 3_600_000);
    const again = single(out.state, "review", "W1a", g("wrong"), { c: ctx({ now: tomorrow, today: tehranDate(tomorrow) }) });
    expect(again).toMatchObject({ rating: "again", stepAfter: 1, introAgain: false, notebook: [{ op: "wrong", refType: "word", refId: 1 }] });
    expect(again.state.failCount).toBe(1);
  });

  it("T04: W5a wrong at step 5: Again, step 4, notebook, practice", () => {
    const out = single(seasoned(5, { typedOnce: true }), "review", "W5a", g("wrong"));
    expect(out).toMatchObject({ rating: "again", stepAfter: 4, practice: true, notebook: [{ op: "wrong", refType: "word", refId: 1 }] });
  });

  it("T05: near (accent) at step 5: Hard, step 5, no followup, near streak 1", () => {
    const out = single(seasoned(5, { typedOnce: true }), "review", "W5a", g("near", "accent"));
    expect(out).toMatchObject({ rating: "hard", stepAfter: 5, followup: false });
    expect(out.state.nearStreak).toBe(1);
  });

  it("T06: wrong at step 5: Again, step 4", () => {
    expect(single(seasoned(5, { typedOnce: true }), "review", "W5a", g("wrong"))).toMatchObject({ rating: "again", stepAfter: 4 });
  });

  it("T07: «نمی‌دانم» at step 3: idk, Again, step 2, notebook", () => {
    const out = single(seasoned(3), "review", "W3b", g("idk"));
    expect(out).toMatchObject({ result: "idk", rating: "again", stepAfter: 2, notebook: [{ op: "wrong", refType: "word", refId: 1 }] });
  });

  it("T08: W6a right at step 6: Good, step 6, a form followup", () => {
    const out = single(seasoned(6, { typedOnce: true }), "review", "W6a", g("correct"));
    expect(out).toMatchObject({ rating: "good", stepAfter: 6, followup: true, followupFormOnly: true });
  });

  it("T09: right word, wrong gender: near, Hard, same step, W2d practice, word_gender notebook, near streak unchanged", () => {
    const out = single(seasoned(5, { typedOnce: true, nearStreak: 1 }), "review", "W5a", g("near", "gender"), { gender: true });
    expect(out).toMatchObject({ rating: "hard", stepAfter: 5, genderPractice: true, practice: false, notebook: [{ op: "wrong", refType: "word_gender", refId: 1 }] });
    expect(out.state.nearStreak).toBe(1);
  });

  it("T12: a wrong followup: step − 1, notebook, FSRS unchanged", () => {
    const state = seasoned(3);
    const out = single(state, "followup", "W3a", g("wrong"));
    expect(out).toMatchObject({ rating: null, stepAfter: 2, notebook: [{ op: "wrong", refType: "word", refId: 1 }] });
    expect(out.state.fsrs).toEqual(state.fsrs);
  });

  it("T53 (step): a right review borrowed from step 3 still moves step 4 to 5", () => {
    expect(single(seasoned(4), "review", "W3b", g("correct"))).toMatchObject({ stepAfter: 5, followup: true, followupFormOnly: false });
  });

  it("T54: the third accent slip in a row is wrong and resets the streak", () => {
    let state = seasoned(5, { typedOnce: true });
    state = single(state, "review", "W5a", g("near", "accent")).state;
    state = single(state, "followup", "W5b", g("near", "accent")).state;
    const third = single(state, "review", "W5a", g("near", "accent"));
    expect(third).toMatchObject({ result: "wrong", reason: "accent", nearStreakHit: true, rating: "again", stepAfter: 4 });
    expect(third.state.nearStreak).toBe(0);
  });

  it("T56: the fourth failed review makes a leech: a week of rest, notebook entries and practice gone, intro again", () => {
    const out = single(seasoned(3, { failCount: 3 }), "review", "W3b", g("wrong"));
    expect(out).toMatchObject({ leech: true, practice: false, introAgain: true });
    expect(out.notebook).toEqual([
      { op: "remove", refType: "word", refId: 1 },
      { op: "remove", refType: "word_gender", refId: 1 },
    ]);
    expect(days(NOW, out.state.deferredUntil!)).toBe(7);
  });

  it("T83: the first typing wrong is Hard, a step down, notebook, no fail count; the next one is Again", () => {
    const first = single(seasoned(5), "review", "W5a", g("wrong"));
    expect(first).toMatchObject({ rating: "hard", stepAfter: 4, firstTyping: true, paceSample: false, notebook: [{ op: "wrong", refType: "word", refId: 1 }] });
    expect(first.state).toMatchObject({ failCount: 0, typedOnce: true });
    const second = single({ ...first.state, step: 5 }, "review", "W5a", g("wrong"));
    expect(second).toMatchObject({ rating: "again", firstTyping: false });
    expect(second.state.failCount).toBe(1);
  });

  it("the third near on a first typing: wrong first, then the first-typing rule (PRD §9.11)", () => {
    const out = single(seasoned(5, { nearStreak: 2 }), "review", "W5a", g("near", "case"));
    expect(out).toMatchObject({ result: "wrong", rating: "hard", stepAfter: 4, firstTyping: true });
  });

  it("a fast right typed answer is Easy; a fast right choice stays Good", () => {
    const latency = { W5a: { median: 10_000, count: 25 }, W3b: { median: 10_000, count: 25 } };
    expect(single(seasoned(5, { typedOnce: true }), "review", "W5a", g("correct"), { latencyMs: 5000, c: ctx({ latency }) }).rating).toBe("easy");
    expect(single(seasoned(3), "review", "W3b", g("correct"), { latencyMs: 2000, c: ctx({ latency }) }).rating).toBe("good");
    // Fewer than 20 earlier answers: never fast.
    expect(single(seasoned(5, { typedOnce: true }), "review", "W5a", g("correct"), { latencyMs: 1000, c: ctx({ latency: { W5a: { median: 10_000, count: 5 } } }) }).rating).toBe(
      "good",
    );
  });

  it("a conjugation card on its last step has no followup", () => {
    const state = { ...seasoned(4), itemType: "conjugation" as const };
    expect(single(state, "review", "C4", g("correct"), { last: 4 })).toMatchObject({ followup: false, notebook: [{ op: "correct", refType: "conjugation", refId: 1 }] });
  });
});

describe("probation cards (PRD §9.7, §9.11)", () => {
  const probation = (step = 5) => ({ ...seasoned(step), probation: "single" as const, source: "i_know" as const, typedOnce: false });

  it("T26: the first real review right ends probation: Good, step 6", () => {
    const out = single(probation(), "review", "W5a", g("correct"));
    expect(out).toMatchObject({ rating: "good", stepAfter: 6, firstTyping: false });
    expect(out.state.probation).toBe("none");
  });

  it("T27 and T108: the first real review wrong: step 1, Again, notebook, intro again, no «این را بلدم», no fail count, typed once", () => {
    const out = single(probation(), "review", "W5a", g("wrong"));
    expect(out).toMatchObject({ rating: "again", stepAfter: 1, introAgain: true, noIKnow: true, firstTyping: false, notebook: [{ op: "wrong", refType: "word", refId: 1 }] });
    expect(out.state).toMatchObject({ probation: "none", failCount: 0, typedOnce: true });
  });
});

describe("grammar rounds (PRD §9.2)", () => {
  const unitState = (step: number, extra: Partial<ItemStateE> = {}) => ({ ...seasoned(step), itemType: "grammar_unit" as const, typedOnce: step > 5, ...extra });
  const answers = (results: Graded["result"][], code = "G1a", latencyMs = 4000): RoundAnswer[] => results.map((result, i) => ({ code, result, latencyMs, targetId: 100 + i }));
  const fast = { G5a: { median: 10_000, count: 30 }, G2a: { median: 10_000, count: 30 } };

  it("T13: 5 of 5 fast on a typed step is Easy; on step 2 it is Good", () => {
    const typed = applyRound(unitState(5, { typedOnce: true }), 5, answers(["correct", "correct", "correct", "correct", "correct"], "G5a", 3000), ctx({ latency: fast }), 6);
    expect(typed).toMatchObject({ rating: "easy", stepAfter: 6 });
    const choice = applyRound(unitState(2), 2, answers(["correct", "correct", "correct", "correct", "correct"], "G2a", 3000), ctx({ latency: fast }), 6);
    expect(choice).toMatchObject({ rating: "good", stepAfter: 3 });
  });

  it("T14 and T15: 4 of 5 is Good and a step up; 3 of 5 is Hard and no change", () => {
    expect(applyRound(unitState(2), 2, answers(["correct", "near", "correct", "correct", "wrong"]), ctx(), 6)).toMatchObject({ s: 0.8, rating: "good", stepAfter: 3 });
    expect(applyRound(unitState(2), 2, answers(["correct", "idk", "correct", "correct", "wrong"]), ctx(), 6)).toMatchObject({ s: 0.6, rating: "hard", stepAfter: 2 });
  });

  it("T16: 2 of 5 on an old unit is Again, a step down, and three notebook sentences", () => {
    const out = applyRound(unitState(3), 3, answers(["correct", "wrong", "idk", "wrong", "correct"]), ctx(), 6);
    expect(out).toMatchObject({ rating: "again", stepAfter: 2 });
    expect(out.notebook.filter((op) => op.op === "wrong").map((op) => op.refId)).toEqual([101, 102, 103]);
    expect(out.state.roundsCount).toBe(1);
  });

  it("a new unit's first round below 0.6: no rating, no notebook, back tomorrow with the lesson", () => {
    const out = applyRound(newItemState("grammar_unit", 1, NOW), 1, answers(["wrong", "wrong", "correct", "wrong", "correct"]), ctx(), 6);
    expect(out).toMatchObject({ scored: true, rating: null, lessonAgain: true, notebook: [{ op: "correct" }, { op: "correct" }] });
    expect(out.state.roundsCount).toBe(1);
    expect(isNewCard(out.state.fsrs)).toBe(true);
  });

  it("the first typed round below 0.6 is Hard and a step down (first typing)", () => {
    expect(applyRound(unitState(5), 5, answers(["wrong", "wrong", "correct", "wrong", "correct"], "G5a"), ctx(), 6)).toMatchObject({
      rating: "hard",
      stepAfter: 4,
      firstTyping: true,
    });
  });

  it("T57: three rounds below 0.8 leave the unit at step 1 with rounds_count 3", () => {
    let state = newItemState("grammar_unit", 1, NOW);
    for (let i = 0; i < 3; i++) state = applyRound(state, 1, answers(["correct", "correct", "correct", "wrong", "wrong"]), ctx(), 6).state;
    expect(state).toMatchObject({ step: 1, roundsCount: 3 });
  });

  it("T68 (rule): two answers are not scored; three are", () => {
    expect(applyRound(unitState(2), 2, answers(["correct", "wrong"]), ctx(), 6)).toMatchObject({ scored: false, rating: null, stepAfter: 2 });
    expect(applyRound(unitState(2), 2, answers(["correct", "correct", "correct"]), ctx(), 6)).toMatchObject({ scored: true, rating: "good" });
  });
});

describe("notebook (PRD §9.5)", () => {
  const entry = (refId: number, addedAt: string, extra: Partial<NotebookE> = {}): NotebookE => ({
    refType: "word",
    refId,
    addedAt,
    until: "2026-10-20T00:00:00Z",
    correctCount: 0,
    lastCorrectDate: null,
    ...extra,
  });

  it("T39: a second right answer on another day leaves; two in one day count once; the 31st entry replaces the oldest", () => {
    const today = tehranDate(NOW);
    const one = [entry(1, "2026-10-10T00:00:00Z", { correctCount: 1, lastCorrectDate: addDays(today, -2) })];
    expect(applyNotebook(one, [{ op: "correct", refType: "word", refId: 1 }], NOW, today, defaults)).toEqual([]);
    const fresh = applyNotebook(
      [entry(1, "2026-10-10T00:00:00Z")],
      [
        { op: "correct", refType: "word", refId: 1 },
        { op: "correct", refType: "word", refId: 1 },
      ],
      NOW,
      today,
      defaults,
    );
    expect(fresh).toMatchObject([{ correctCount: 1, lastCorrectDate: today }]);
    const full = Array.from({ length: 30 }, (_, i) => entry(i + 1, new Date(Date.parse("2026-10-01T00:00:00Z") + i * 3_600_000).toISOString()));
    const after = applyNotebook(full, [{ op: "wrong", refType: "word", refId: 99 }], NOW, today, defaults);
    expect(after).toHaveLength(30);
    expect(after.some((item) => item.refId === 1)).toBe(false);
    expect(after.some((item) => item.refId === 99)).toBe(true);
  });

  it("a wrong answer starts the count and the seven days over; an entry past its date is gone", () => {
    const today = tehranDate(NOW);
    const list = applyNotebook([entry(1, "2026-10-10T00:00:00Z", { correctCount: 1, lastCorrectDate: today })], [{ op: "wrong", refType: "word", refId: 1 }], NOW, today, defaults);
    expect(list).toMatchObject([{ correctCount: 0, lastCorrectDate: null, until: new Date(NOW.getTime() + 7 * 86_400_000).toISOString() }]);
    expect(applyNotebook([entry(2, "2026-10-01T00:00:00Z", { until: "2026-10-13T00:00:00Z" })], [], NOW, today, defaults)).toEqual([]);
  });
});

describe("confusion pairs (PRD §9.9)", () => {
  const cuisine = word(20, "cuisine", "آشپزخانه");
  const cousine = word(21, "cousine", "دخترخاله");
  const on = settings({ "feature.confusion_card": true });

  it("T55: the first time counts 1; the second makes 2 and shows the card when the feature is on", () => {
    const first = applyConfusion([], cuisine, cousine, ctx({ settings: on }), () => false);
    expect(first).toMatchObject({ showCard: false, pair: { wordId: 20, otherWordId: 21, count: 1 } });
    const second = applyConfusion(first.pairs, cuisine, cousine, ctx({ settings: on }), () => true);
    expect(second).toMatchObject({ showCard: true, pair: { count: 2 } });
    // The card waits seven days before it shows again; with the feature off it never shows.
    expect(applyConfusion(second.pairs, cousine, cuisine, ctx({ settings: on }), () => true)).toMatchObject({ showCard: false, pair: { count: 3 } });
    expect(applyConfusion(first.pairs, cuisine, cousine, ctx(), () => true).showCard).toBe(false);
  });

  it("T86 (pairs): two senses of one lemma never make a pair", () => {
    const glace = word(40, "glace", "بستنی");
    const glace2 = word(41, "glace", "آینه", { senseOf: "glace" });
    expect(applyConfusion([] as ConfusionE[], glace, glace2, ctx(), () => true)).toMatchObject({ pair: null, pairs: [] });
  });
});

describe("pace (PRD §9.10)", () => {
  const reviews = (ok: number, total: number) => Array.from({ length: total }, (_, i) => ({ ok: i < ok }));

  it("T60: 70% of 40 goes slow; 80% stays slow; 86% goes back; 20 reviews change nothing", () => {
    expect(updatePace("normal", reviews(28, 40), defaults)).toEqual({ mode: "slow", becameSlow: true });
    expect(updatePace("slow", reviews(32, 40), defaults)).toEqual({ mode: "slow", becameSlow: false });
    expect(updatePace("slow", reviews(35, 40), defaults).mode).toBe("normal");
    expect(updatePace("normal", reviews(10, 20), defaults).mode).toBe("normal");
  });

  it("T84: first typings are left out before counting (24 of 30 is 80%: not slow)", () => {
    expect(updatePace("normal", reviews(24, 30), defaults).mode).toBe("normal");
  });
});

describe("a phone clock behind the server (PRD §15.4)", () => {
  it("rating a card before its last review counts as rating it at that moment, not an error", () => {
    const reviewed = new Date("2026-03-21T08:00:00Z");
    const card = rateCard(rateCard(emptyCard(reviewed), "good", reviewed, defaults), "good", reviewed, defaults);
    const behind = new Date("2026-03-19T08:00:00Z");
    expect(() => rateCard(card, "good", behind, defaults)).not.toThrow();
    expect(rateCard(card, "good", behind, defaults)).toEqual(rateCard(card, "good", reviewed, defaults));
    expect(retrievability(card, behind, defaults)).toBe(retrievability(card, reviewed, defaults));
  });
});

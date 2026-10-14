/**
 * Building and playing sessions (PRD §10): caps, backlog, gates, order, the changes in the middle of
 * a session. Content and learners are made up (`fixtures/synthetic`); every card goes through the
 * same `playCard` the browser and the server run.
 */
import { describe, expect, it } from "vitest";
import { newItemState } from "@/engine/answer";
import type { Ex } from "@/engine/ex";
import { emptyCard, rateCard, retrievability, withDue } from "@/engine/fsrs";
import { seeded } from "@/engine/random";
import { backlogThreshold, buildSession, nextSkill, sessionCaps, type BuildOptions, type BuildResult } from "@/engine/session/build";
import { nextNewWords } from "@/engine/session/newmaterial";
import { playCard, shownEx, wantsAlt, type PlayEnv } from "@/engine/session/play";
import type { Card, SessionPlan } from "@/engine/session/types";
import type { Settings } from "@/engine/settings";
import { itemKey, type ItemStateE, type ItemType, type LearnerSnapshot, type NotebookE, type QueueE, type SkillName } from "@/engine/state";
import { addDays, plusDays, tehranDate, tehranDayStart } from "@/engine/time";
import type { Content } from "@/engine/content";
import { syntheticContent } from "../../../fixtures/synthetic";
import { always, applyEffects, playSession, rightAnswer, wrongAnswer, type Policy } from "../../../fixtures/synthetic/drive";
import { freshLearner, newDay } from "../../../fixtures/synthetic/learner";
import { content as kitContent, defaults, settings, word } from "./kit";

const NOW = new Date("2026-03-21T08:00:00Z");
const TODAY = tehranDate(NOW);

const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({ scope: "mixed", lengthMin: 10, noAudio: false, cap: null, seed: "session", ...over });

/** An item learned some days ago, at a step, due `dueInDays` from now (negative: overdue). */
function learned(type: ItemType, id: number, s: Settings, { step = 2, introDaysAgo = 5, dueInDays = -1 } = {}): ItemStateE {
  const intro = plusDays(NOW, -introDaysAgo);
  const card = rateCard(emptyCard(intro), "good", intro, s);
  return { ...newItemState(type, id, intro), step, firstReviewDone: true, fsrs: withDue(card, plusDays(NOW, dueInDays)) };
}

const cardWords = (content: Content) => [...content.words.values()].filter((item) => !item.noCard).map((item) => item.id);

function learner(sessionLength: number, over: Partial<LearnerSnapshot> = {}): LearnerSnapshot {
  return { ...newDay(freshLearner("fr", { sessionLength }), TODAY), ...over };
}

function planOf(result: BuildResult): SessionPlan {
  if (result.kind !== "plan") throw new Error(`Expected a plan, got ${result.kind}`);
  return result.plan;
}

const isScored = (card: Card) => (card.t === "ex" || card.t === "round") && (card.kind === "review" || card.kind === "followup");
const newWordsOf = (plan: SessionPlan) => plan.queue.filter((card) => card.t === "intro" && card.fresh).map((card) => card.item);
const exercises = (plan: SessionPlan) => plan.queue.map((card) => shownEx(plan, card)).filter((ex): ex is Ex => !!ex);

function playEnv(content: Content, s: Settings, now = NOW): PlayEnv {
  return { ctx: { settings: s, now, today: TODAY, latency: {} }, language: content.language, wordsWithLemma: (lemma) => content.lemmaIndex.get(lemma) ?? [] };
}

describe("new material on the first day (PRD §10.10, example 1)", () => {
  it("T22: a learner from zero, 10 minutes: ten new words, no typing and no grammar", () => {
    const content = syntheticContent();
    const s = settings();
    const played = playSession(content, learner(10), s, NOW, opts(), always(true), seeded("t22"));
    const plan = planOf(played.build);
    expect(plan.summary).toMatchObject({ newWords: 10, newUnits: 0, newConj: 0, reviews: 0 });
    expect(plan.queue[0].t).toBe("intro");
    // Each new word: its intro card, then its first exercise right after.
    plan.queue.forEach((card, i) => {
      if (card.t === "intro") expect(plan.queue[i + 1]).toMatchObject({ item: card.item, t: "ex", block: card.block });
    });
    expect(plan.queue.some((card) => ["lesson", "g0", "round", "table"].includes(card.t))).toBe(false);
    const shown = played.results.map((result) => result.ex).filter((ex): ex is Ex => !!ex);
    expect(shown.length).toBeGreaterThan(10);
    expect(shown.filter((ex) => ex.a.kind === "type" || ex.a.kind === "letters")).toEqual([]);
    expect(played.learner.today.newWords).toBe(10);
    expect(played.learner.items).toHaveLength(10);
    // Every word: its intro card, its first exercise and, after a right answer, its followup.
    expect(played.results).toHaveLength(30);
  });

  it("T82: the caps of a 30-minute learner, and of the other lengths and slow pace", () => {
    expect(sessionCaps(defaults, 30, "normal")).toMatchObject({ words: 30, wordsSoft: 30, wordsHard: 50, units: 3, unitsDaily: 3, conj: 3, conjDaily: 6 });
    expect(backlogThreshold(defaults, 30)).toBe(90);
    expect([10, 15, 20, 30].map((min) => sessionCaps(defaults, min, "normal").words)).toEqual([10, 15, 20, 30]);
    expect([10, 15, 20, 30].map((min) => sessionCaps(defaults, min, "normal").wordsSoft)).toEqual([20, 20, 20, 30]);
    expect([10, 15, 20, 30].map((min) => sessionCaps(defaults, min, "normal").units)).toEqual([1, 2, 2, 3]);
    expect([10, 15, 20, 30].map((min) => backlogThreshold(defaults, min))).toEqual([30, 45, 60, 90]);
    // Slow pace (PRD §10.5): words 5, 8, 10, 15; soft cap 10 or 15; units a day 2; conjugation cards 2 and 3.
    expect([10, 15, 20, 30].map((min) => sessionCaps(defaults, min, "slow").words)).toEqual([5, 8, 10, 15]);
    expect([10, 30].map((min) => sessionCaps(defaults, min, "slow").wordsSoft)).toEqual([10, 15]);
    expect(sessionCaps(defaults, 15, "slow")).toMatchObject({ unitsDaily: 2, conj: 2, conjDaily: 3, wordsHard: 50 });

    const plan = planOf(buildSession(syntheticContent(), learner(30), defaults, NOW, TODAY, opts({ lengthMin: 30 })));
    expect(plan.summary.newWords).toBe(30);
  });
});

describe("the daily word cap (PRD §3.7, §10.5)", () => {
  const content = syntheticContent();
  const s = settings();
  const older = cardWords(content)
    .slice(0, 25)
    .map((id, i) => learned("word", id, s, { introDaysAgo: 4, dueInDays: i < 6 ? -1 : 3 }));
  const at = (newWords: number, wordsCapToday: number | null, capPromptShown = false) => {
    const base = learner(10, { items: older });
    return { ...base, today: { ...base.today, newWords, wordsCapToday, capPromptShown } };
  };

  it("T20, T107: at the soft cap «شروع» asks first; «ادامه بدون کلمه جدید» builds a session without new words", () => {
    const ask = buildSession(content, at(20, null), s, NOW, TODAY, opts());
    expect(ask).toMatchObject({ kind: "ask_word_cap", learned: 20, canMore: true, effects: { capPromptShown: true, wordsCapToday: 20 } });
    expect(buildSession(content, at(20, null), s, NOW, TODAY, opts({ scope: "vocab" })).kind).toBe("ask_word_cap");
    expect(buildSession(content, at(20, null), s, NOW, TODAY, opts({ scope: "grammar" })).kind).not.toBe("ask_word_cap");
    expect(buildSession(content, at(20, null), s, NOW, TODAY, opts({ scope: "quick" })).kind).toBe("plan");

    const none = buildSession(content, at(20, null), s, NOW, TODAY, opts({ cap: "none" }));
    expect(none.effects).toMatchObject({ capPromptShown: true, wordsCapToday: 20 });
    const plan = planOf(none);
    expect(plan.summary.newWords).toBe(0);
    expect(plan.summary.reviews).toBeGreaterThan(0);
    // The question comes once a day for each cap.
    const again = planOf(buildSession(content, at(20, 20, true), s, NOW, TODAY, opts()));
    expect(again.summary.newWords).toBe(0);
  });

  it("T20: «۱۰ تای دیگر» raises the cap by 10 up to 50; at 50 there is no question and no new word", () => {
    const more = buildSession(content, at(20, null), s, NOW, TODAY, opts({ cap: "more" }));
    expect(more.effects).toMatchObject({ wordsCapToday: 30, capPromptShown: false });
    expect(planOf(more).summary.newWords).toBe(10);
    expect(buildSession(content, at(30, 30), s, NOW, TODAY, opts()).kind).toBe("ask_word_cap");
    expect(buildSession(content, at(40, 40), s, NOW, TODAY, opts({ cap: "more" })).effects.wordsCapToday).toBe(50);
    const full = buildSession(content, at(50, 50), s, NOW, TODAY, opts());
    expect(full.kind).toBe("plan");
    expect(planOf(full).summary.newWords).toBe(0);
    // Close to the cap the session takes only what is left.
    expect(planOf(buildSession(content, at(47, 50), s, NOW, TODAY, opts())).summary.newWords).toBe(3);
  });
});

describe("backlog (PRD §10.6)", () => {
  it("T21: 400 due cards for a 10-minute learner: 30 stay, 370 move over 14 days, once a day", () => {
    const content = syntheticContent({ words: 600 });
    const s = settings();
    const items = cardWords(content)
      .slice(0, 400)
      .map((id, i) => learned("word", id, s, { step: 1 + (i % 5), introDaysAgo: 3 + (i % 40) }));
    const before = learner(10, { items });
    const first = buildSession(content, before, s, NOW, TODAY, opts());
    const { effects } = first;
    expect(effects.backlog).toBe(true);
    expect(effects.lastSpreadDate).toBe(TODAY);
    expect(effects.spread).toHaveLength(370);
    const perDay = new Map<string, number>();
    for (const item of effects.spread) perDay.set(item.deferredUntil, (perDay.get(item.deferredUntil) ?? 0) + 1);
    expect([...perDay.keys()].sort()).toEqual(Array.from({ length: 14 }, (_, i) => tehranDayStart(addDays(TODAY, i + 1)).toISOString()));
    for (const count of perDay.values()) expect([26, 27]).toContain(count);
    // The weakest 30 stay.
    const r = (state: ItemStateE) => retrievability(state.fsrs, NOW, s);
    const moved = new Set(effects.spread.map((item) => item.key));
    const kept = items.filter((state) => !moved.has(itemKey("word", state.itemId)));
    expect(kept).toHaveLength(30);
    expect(Math.max(...kept.map(r))).toBeLessThanOrEqual(Math.min(...items.filter((state) => moved.has(itemKey("word", state.itemId))).map(r)));
    // FSRS due is never touched; new material still comes.
    const after = applyEffects(before, effects as Extract<BuildResult, { kind: "plan" }>["effects"], TODAY);
    after.items.forEach((state, i) => expect(state.fsrs).toEqual(items[i].fsrs));
    expect(planOf(first).summary.newItems).toBeGreaterThan(0);
    expect(planOf(first).queue.every((card) => !moved.has(card.item))).toBe(true);

    const second = buildSession(content, after, s, NOW, TODAY, opts({ seed: "second" }));
    expect(second.effects.spread).toEqual([]);
    expect(second.effects.backlog).toBe(true);
  });

  it("no backlog below the threshold: the normal shares and no spread", () => {
    const content = syntheticContent();
    const s = settings();
    const items = cardWords(content)
      .slice(0, 29)
      .map((id) => learned("word", id, s));
    const built = buildSession(content, learner(10, { items }), s, NOW, TODAY, opts());
    expect(built.effects).toMatchObject({ backlog: false, spread: [], lastSpreadDate: null });
  });
});

describe("skills that open later (PRD §10.3)", () => {
  const content = syntheticContent();
  const s = settings();
  const noCard = [...content.words.values()].filter((item) => item.noCard).map((item) => item.id);
  const withWords = (count: number, noCardCount = 0) =>
    learner(15, {
      items: [...cardWords(content).slice(0, count), ...noCard.slice(0, noCardCount)].map((id) => learned("word", id, s, { introDaysAgo: 1, dueInDays: 3 })),
    });
  const grammarIn = (result: BuildResult) => result.kind === "plan" && result.plan.queue.some((card) => card.t === "lesson" || card.t === "table");

  it("T23: grammar opens with 20 introduced card words; no_card words do not count", () => {
    expect(noCard.length).toBeGreaterThanOrEqual(6);
    expect(grammarIn(buildSession(content, withWords(19, 6), s, NOW, TODAY, opts({ lengthMin: 15 })))).toBe(false);
    expect(buildSession(content, withWords(19, 6), s, NOW, TODAY, opts({ scope: "grammar", lengthMin: 15 })).kind).toBe("nothing_left");
    expect(grammarIn(buildSession(content, withWords(20), s, NOW, TODAY, opts({ lengthMin: 15 })))).toBe(true);
  });

  it("T25: a learner placed at A2 with no word cards gets grammar at once: a five-question round with the Persian translation", () => {
    const placed = syntheticContent({ unitWordsLevel: "A2" });
    const plan = planOf(buildSession(placed, newDay(freshLearner("fr", { vocabLevel: "A2", knownBelow: "A2" }), TODAY), s, NOW, TODAY, opts({ scope: "grammar" })));
    expect(plan.queue.map((card) => card.t).slice(0, 4)).toEqual(["lesson", "g0", "g0", "g0"]);
    const round = plan.queue.filter((card) => card.t === "round");
    expect(round).toHaveLength(5);
    for (const card of round) expect(card.ex!.q.sentence?.translation ?? card.ex!.q.translation).toBeTruthy();
  });
});

describe("which new material (PRD §5.8, §10.2)", () => {
  it("T24: vocabulary first, then the lowest progress + 0.1 × packs (example 2)", () => {
    const skills = new Set<SkillName>(["vocab", "grammar", "listening"]);
    const progress = { vocab: 0.12, grammar: 0.1, listening: 0.05 };
    const packs: Partial<Record<SkillName, number>> = {};
    const order: string[] = [];
    // What example 2 says each pick does: grammar has no second pack, the third vocabulary pack does not fit.
    const fails = new Map<string, number>([
      ["grammar", 2],
      ["vocab", 3],
    ]);
    let first = true;
    // Nine picks fill the budget of example 2.
    while (skills.size > 0 && order.length < 9) {
      const skill = nextSkill(skills, progress, packs, first)!;
      first = false;
      order.push(skill);
      const taken = (packs[skill] ?? 0) + 1;
      if (fails.get(skill) === taken) skills.delete(skill);
      else packs[skill] = taken;
    }
    expect(order).toEqual(["vocab", "listening", "grammar", "listening", "grammar", "vocab", "listening", "vocab", "listening"]);
    // Ties go vocabulary, grammar, listening, reading; without vocabulary the first pack is the lowest.
    expect(nextSkill(new Set<SkillName>(["reading", "listening", "grammar"]), {}, {}, false)).toBe("grammar");
    expect(nextSkill(new Set<SkillName>(["reading", "listening"]), { listening: 0.2, reading: 0.1 }, {}, true)).toBe("reading");
  });

  it("T51: words from the tap queue come first, at most 5 a day, and count in the daily cap", () => {
    const content = syntheticContent();
    const s = settings();
    const ids = [160, 161, 162, 163, 164, 165, 166];
    const queue: QueueE[] = ids.map((wordId, i) => ({ wordId, source: "tap", addedAt: plusDays(NOW, -7 + i).toISOString() }));
    // One key word, added last, still comes after the taps of the same day? No: taps first, then key words.
    const played = playSession(content, learner(15, { queue }), s, NOW, opts({ lengthMin: 15 }), always(true), seeded("t51"));
    const plan = planOf(played.build);
    expect(newWordsOf(plan).slice(0, 5)).toEqual(ids.slice(0, 5).map((id) => itemKey("word", id)));
    expect(newWordsOf(plan)).not.toContain(itemKey("word", 165));
    expect(played.learner.today).toMatchObject({ queueWords: 5, newWords: 15 });
    expect(played.learner.queue.map((row) => row.wordId)).toEqual([165, 166]);

    // Three already taken from the queue today: two more.
    const later = learner(15, { queue });
    const ctx = { content, learner: { ...later, today: { ...later.today, queueWords: 3 } }, settings: s, now: NOW, taken: () => false, known: () => false };
    expect(nextNewWords(ctx, 10, []).fromQueue).toBe(2);
    // Key words come after taps, the oldest first inside each source.
    const mixed: QueueE[] = [
      { wordId: 170, source: "key_word", addedAt: plusDays(NOW, -9).toISOString() },
      { wordId: 171, source: "tap", addedAt: plusDays(NOW, -1).toISOString() },
      { wordId: 172, source: "colloquial", addedAt: plusDays(NOW, -20).toISOString() },
    ];
    expect(nextNewWords({ ...ctx, learner: { ...later, queue: mixed } }, 3, []).words.map((item) => item.id)).toEqual([171, 170, 172]);
  });

  it("T52: a learner at A2 with A1 words left gets the A1 words first", () => {
    const content = syntheticContent();
    const s = settings();
    const a1 = cardWords(content).filter((id) => content.words.get(id)!.level === "A1");
    const items = a1.slice(0, a1.length - 40).map((id) => learned("word", id, s, { dueInDays: 5 }));
    const base = learner(15, { items });
    const at = { ...base, skills: [{ skill: "vocab" as const, level: "A2", knownBelow: "A1" }, ...base.skills.filter((skill) => skill.skill !== "vocab")] };
    const plan = planOf(buildSession(content, at, s, NOW, TODAY, opts({ scope: "vocab", lengthMin: 15 })));
    const levels = newWordsOf(plan).map((key) => content.words.get(Number(key.slice(2)))!.level);
    expect(levels.length).toBe(15);
    expect(new Set(levels)).toEqual(new Set(["A1"]));
  });

  it("T109: two words of one family come at least `intro.family_gap` words apart; 0 keeps the admin order", () => {
    const lemmas = ["bleu", "rouge", "pain", "vert", "eau", "café", "lait"];
    const colours = new Set(["bleu", "rouge", "vert"]);
    const content = kitContent({ words: lemmas.map((lemma, i) => word(i + 1, lemma, `معنی ${lemma}`, { family: colours.has(lemma) ? "couleur" : null })) });
    const order = (gap: number) => {
      const ctx = { content, learner: learner(15), settings: settings({ "intro.family_gap.fr": gap }), now: NOW, taken: () => false, known: () => false };
      return nextNewWords(ctx, 7, []).words.map((item) => item.lemma);
    };
    expect(order(4)).toEqual(["bleu", "pain", "eau", "café", "lait", "rouge", "vert"]);
    expect(order(0)).toEqual(lemmas);
    // The gap also looks at words of earlier sessions.
    const ctx = { content, learner: learner(15), settings: settings(), now: NOW, taken: (id: number) => id === 1, known: () => false };
    expect(nextNewWords(ctx, 2, [1]).words.map((item) => item.lemma)).toEqual(["pain", "eau"]);
  });
});

describe("changes in the middle of a session (PRD §9.10, §10.7)", () => {
  const content = syntheticContent();
  const s = settings();
  const due = (count: number) =>
    cardWords(content)
      .slice(0, count)
      .map((id, i) => learned("word", id, s, { step: 1 + (i % 5), introDaysAgo: 6 + (i % 9) }));

  it("orders the first build: the two easiest reviews first, the easiest one left last, no two codes in a row when it can", () => {
    const plan = planOf(buildSession(content, learner(15, { items: due(20) }), s, NOW, TODAY, opts({ lengthMin: 15 })));
    const step = (card: Card) => plan.states[card.item]!.step;
    const reviews = plan.queue.filter((card) => card.t === "ex" && card.kind === "review" && !card.block);
    const firstTwo = plan.queue.slice(0, 2);
    expect(firstTwo.every((card) => card.kind === "review" && !card.block)).toBe(true);
    expect(Math.max(...firstTwo.map(step))).toBeLessThanOrEqual(Math.min(...reviews.slice(2).map(step)));
    const last = plan.queue.at(-1)!;
    expect(last.block).toBeUndefined();
    expect(step(last)).toBe(Math.min(...reviews.slice(2).map(step)));
    // New words spread over the session, never two blocks of new words in a row at the start.
    const positions = plan.queue.flatMap((card, i) => (card.t === "intro" ? [i] : []));
    expect(positions.length).toBeGreaterThan(3);
    expect(positions[0]).toBeGreaterThanOrEqual(2);
  });

  it("T49: past 1.3 times the budget the remaining followups go; practice stays; steps do not change", () => {
    const plan0 = planOf(buildSession(content, learner(10, { items: due(10) }), s, NOW, TODAY, opts()));
    const env = playEnv(content, s);
    const [first, second] = plan0.queue;
    const a = playCard(plan0, first.id, rightAnswer(shownEx(plan0, first)!), { latencyMs: 5000, elapsedSec: 5 }, env);
    if (!a.done) throw new Error("graded");
    expect(a.advanced.plan.queue.filter((card) => card.kind === "followup")).toHaveLength(1);
    const stepAfter = a.state!.step;
    const late = 1.3 * plan0.budgetSec + 1;
    const b = playCard(a.advanced.plan, second.id, wrongAnswer(shownEx(a.advanced.plan, second)!), { latencyMs: 5000, elapsedSec: late }, env);
    if (!b.done) throw new Error("graded");
    const queue = b.advanced.plan.queue;
    expect(queue.filter((card) => card.kind === "followup")).toEqual([]);
    expect(queue.filter((card) => card.kind === "practice" && card.item === second.item)).toHaveLength(1);
    expect(b.advanced.plan.states[first.item]!.step).toBe(stepAfter);
    expect(queue.length).toBe(plan0.queue.length - 2 + 1);
  });

  it("T61: three wrong in a row bring the two easiest reviews forward; under 60% new material not started leaves and is not counted", () => {
    const pattern = [false, false, false, true, true, true, true, true, true, false, false, false];
    let scored = 0;
    const policy: Policy = (card, ex) => {
      if (!ex) return { answer: { seen: true }, latencyMs: 4000 };
      const right = isScored(card) ? (pattern[scored++] ?? true) : true;
      return { answer: right ? rightAnswer(ex) : wrongAnswer(ex), latencyMs: 4000 };
    };
    const played = playSession(content, learner(15, { items: due(20) }), s, NOW, opts({ lengthMin: 15 }), policy, seeded("t61"));
    const plan = planOf(played.build);
    expect(plan.summary.newWords).toBeGreaterThan(3);

    const scoredResults = played.results.filter((result) => isScored(result.card));
    const third = scoredResults[2];
    expect(third.advanced.rescued).toBe(true);
    const after = third.advanced.plan;
    const front = after.queue.findIndex((card) => card.t !== "intro" && card.t !== "confusion");
    const moved = after.queue.slice(front, front + 2);
    const step = (card: Card) => after.states[card.item]?.step ?? 0;
    const others = after.queue.slice(front + 2).filter((card) => card.t === "ex" && card.kind === "review" && !card.block);
    expect(moved.every((card) => card.t === "ex" && card.kind === "review" && !card.block)).toBe(true);
    expect(Math.max(...moved.map(step))).toBeLessThanOrEqual(Math.min(...others.map(step)));

    // The low-accuracy rule: once it drops new material, no unstarted new card is left.
    const drop = played.results.findIndex((result) => result.advanced.droppedNew > 0);
    expect(drop).toBeGreaterThan(-1);
    const dropped = played.results[drop].advanced.plan;
    expect(dropped.queue.filter((card) => card.fresh && card.block !== played.results[drop].card.block)).toEqual([]);
    const started = new Set(played.results.filter((result) => result.card.t === "ex" && result.card.fresh).map((result) => result.card.item));
    expect(played.learner.today.newWords).toBe(started.size);
    expect(started.size).toBeLessThan(plan.summary.newWords);
  });

  it("a due grammar unit comes as one round block and is scored when the round ends", () => {
    const words = cardWords(content)
      .slice(0, 22)
      .map((id, i) => learned("word", id, s, { dueInDays: i < 5 ? -1 : 3 }));
    const items = [...words, learned("grammar_unit", 1, s, { step: 2, introDaysAgo: 4 })];
    const played = playSession(content, learner(15, { items }), s, NOW, opts({ lengthMin: 15 }), always(true), seeded("round"));
    const plan = planOf(played.build);
    const round = plan.queue.flatMap((card, i) => (card.t === "round" && card.item === "u:1" ? [i] : []));
    expect(round.length).toBeGreaterThanOrEqual(3);
    expect(round.at(-1)! - round[0]).toBe(round.length - 1);
    const end = played.results.find((result) => result.round && result.card.item === "u:1");
    expect(end?.round).toMatchObject({ scored: true, stepBefore: 2, stepAfter: 3 });
    expect(played.learner.items.find((item) => item.itemType === "grammar_unit")).toMatchObject({ step: 3, roundsCount: 1 });
  });
});

describe("other kinds of session (PRD §10.4, §10.8, §10.12)", () => {
  const content = syntheticContent();
  const s = settings();
  const items = cardWords(content)
    .slice(0, 40)
    .map((id, i) => learned("word", id, s, { step: 1 + (i % 6), dueInDays: i < 20 ? -1 : 4 }));
  const notebook: NotebookE[] = [21, 22].map((id) => ({
    refType: "word",
    refId: cardWords(content)[id],
    addedAt: plusDays(NOW, -1).toISOString(),
    until: plusDays(NOW, 20).toISOString(),
    correctCount: 0,
    lastCorrectDate: null,
  }));

  it("T81: «امروز وقت کم دارم» is 300 seconds of reviews and notebook, nothing new", () => {
    const plan = planOf(buildSession(content, learner(15, { items, notebook }), s, NOW, TODAY, opts({ scope: "quick", lengthMin: 15 })));
    expect(plan.budgetSec).toBe(300);
    expect(plan.summary.newItems).toBe(0);
    expect(plan.queue.every((card) => card.t === "ex" && (card.kind === "review" || card.kind === "practice"))).toBe(true);
    // Reviews first; the notebook gets what is left.
    const few = items.map((state, i) => (i < 3 ? state : { ...state, fsrs: withDue(state.fsrs, plusDays(NOW, 3)) }));
    const short = planOf(buildSession(content, learner(15, { items: few, notebook }), s, NOW, TODAY, opts({ scope: "quick", lengthMin: 15 })));
    expect(
      short.queue
        .filter((card) => card.note)
        .map((card) => card.item)
        .sort(),
    ).toEqual(notebook.map((entry) => itemKey("word", entry.refId)).sort());
    // With nothing due and an empty notebook there is no quick session.
    const later = items.map((state) => ({ ...state, fsrs: withDue(state.fsrs, plusDays(NOW, 3)) }));
    expect(buildSession(content, learner(15, { items: later }), s, NOW, TODAY, opts({ scope: "quick" })).kind).toBe("nothing_left");
  });

  it("the notebook button: only notebook entries, as practice; an empty notebook says so", () => {
    const plan = planOf(buildSession(content, learner(15, { items, notebook }), s, NOW, TODAY, opts({ scope: "notebook" })));
    expect(plan.queue.map((card) => card.kind)).toEqual(["practice", "practice"]);
    expect(buildSession(content, learner(15, { items }), s, NOW, TODAY, opts({ scope: "notebook" })).kind).toBe("empty_notebook");
  });

  it("«تمرین بیشتر» practises today's items and changes nothing: no FSRS, no step, no notebook", () => {
    const touched = items.slice(0, 5).map((state) => itemKey("word", state.itemId));
    const before = learner(15, { items, touchedToday: touched });
    const played = playSession(content, before, s, NOW, opts({ scope: "extra" }), always(false), seeded("extra"));
    const plan = planOf(played.build);
    expect(plan.queue.map((card) => card.item).sort()).toEqual([...touched].sort());
    expect(plan.queue.every((card) => card.kind === "practice")).toBe(true);
    expect(played.results).toHaveLength(5);
    expect(played.learner.notebook).toEqual([]);
    for (const state of items) expect(played.learner.items.find((item) => item.itemId === state.itemId)).toEqual(state);
  });

  it("vocabulary and grammar buttons keep to their skill", () => {
    const withUnit = [...items, learned("grammar_unit", 1, s, { step: 2 })];
    const vocab = planOf(buildSession(content, learner(15, { items: withUnit }), s, NOW, TODAY, opts({ scope: "vocab", lengthMin: 15 })));
    expect(vocab.queue.every((card) => card.item.startsWith("w:"))).toBe(true);
    const grammar = planOf(buildSession(content, learner(15, { items: withUnit }), s, NOW, TODAY, opts({ scope: "grammar", lengthMin: 15 })));
    expect(grammar.queue.every((card) => !card.item.startsWith("w:"))).toBe(true);
    expect(grammar.queue.some((card) => card.t === "round")).toBe(true);
  });

  it("«الان نمی‌توانم گوش بدهم»: no exercise that needs sound", () => {
    const plan = planOf(buildSession(content, learner(15, { items, notebook }), s, NOW, TODAY, opts({ lengthMin: 15, noAudio: true })));
    expect(exercises(plan).length).toBeGreaterThan(10);
    expect(exercises(plan).filter((ex) => ex.audio)).toEqual([]);
    const withSound = planOf(buildSession(content, learner(15, { items, notebook }), s, NOW, TODAY, opts({ lengthMin: 15 })));
    for (const card of withSound.queue) if (card.ex?.audio && card.t === "ex") expect(card.alt?.audio ?? false).toBe(false);
  });

  it("sound turned off in the middle: every card with sound has a version without, rounds too, and the version shown is graded", () => {
    const withUnit = [...items, learned("grammar_unit", 1, s, { step: 2, introDaysAgo: 4 })];
    const plan = planOf(buildSession(content, learner(15, { items: withUnit, notebook }), s, NOW, TODAY, opts({ lengthMin: 15 })));
    const sound = plan.queue.filter((card) => card.ex?.audio);
    expect(sound.length).toBeGreaterThan(0);
    for (const card of sound) {
      expect(card.alt, `${card.id} ${card.ex?.code}`).toBeTruthy();
      expect(card.alt!.audio).toBe(false);
      expect(card.alt!.item).toBe(card.ex!.item);
    }
    const rounds = plan.queue.filter((card) => card.t === "round");
    expect(rounds.length).toBeGreaterThan(0);
    for (const card of rounds) if (card.ex?.audio) expect(card.alt?.audio).toBe(false);

    // The browser says it showed the version without sound; the server grades that one.
    const at = plan.queue.findIndex((card) => card.ex?.audio && card.alt);
    let current = plan;
    for (let i = 0; i < at; i++) {
      const card = current.queue[0];
      const shown = shownEx(current, card);
      const result = playCard(current, card.id, shown ? rightAnswer(shown) : { seen: true }, { latencyMs: 3000, elapsedSec: 3 * (i + 1) }, playEnv(content, s));
      if (!result.done) throw new Error("not done");
      current = result.advanced.plan;
    }
    const card = current.queue[0];
    expect(card.ex?.audio).toBe(true);
    expect(shownEx(current, card, true)).toBe(card.alt);
    expect(shownEx(current, card)).toBe(card.ex);
    const silent = playCard(current, card.id, rightAnswer(card.alt!), { latencyMs: 3000, elapsedSec: 100, alt: true }, playEnv(content, s));
    expect(silent).toMatchObject({ done: true, graded: { result: "correct" }, log: { code: card.alt!.code } });
    expect(silent.done && silent.ex).toBe(card.alt);
  });

  it("T63: a sound not ready after `audio.wait_sec` brings the version without sound; the session goes on", () => {
    const plan = planOf(buildSession(content, learner(15, { items, notebook }), s, NOW, TODAY, opts({ lengthMin: 15 })));
    const card = plan.queue.find((item) => item.ex?.audio && item.alt)!;
    const ready = { muted: false, noVoice: false, waitedSec: null };
    expect(wantsAlt(plan, card, ready, s)).toBe(false);
    expect(wantsAlt(plan, card, { ...ready, waitedSec: 4.9 }, s)).toBe(false);
    expect(wantsAlt(plan, card, { ...ready, waitedSec: 5 }, s)).toBe(true);
    expect(wantsAlt(plan, card, { ...ready, waitedSec: 2 }, settings({ "audio.wait_sec": 2 }))).toBe(true);
    expect(wantsAlt(plan, card, { ...ready, muted: true }, s)).toBe(true);
    expect(wantsAlt(plan, card, { ...ready, noVoice: true }, s)).toBe(true);
    // A card without sound, or without a version without it, is shown as it is.
    const silent = plan.queue.find((item) => item.ex && !item.ex.audio)!;
    expect(wantsAlt(plan, silent, { ...ready, waitedSec: 30 }, s)).toBe(false);
    expect(wantsAlt(plan, { ...card, alt: null }, { ...ready, waitedSec: 30 }, s)).toBe(false);
  });

  it("the same seed builds the same session, and playing a card twice gives the same result", () => {
    const one = buildSession(content, learner(15, { items, notebook }), s, NOW, TODAY, opts({ lengthMin: 15 }));
    const two = buildSession(content, learner(15, { items, notebook }), s, NOW, TODAY, opts({ lengthMin: 15 }));
    expect(JSON.stringify(two)).toBe(JSON.stringify(one));
    const plan = planOf(one);
    const card = plan.queue[0];
    const answer = wrongAnswer(shownEx(plan, card)!);
    const a = playCard(plan, card.id, answer, { latencyMs: 3000, elapsedSec: 3 }, playEnv(content, s));
    const b = playCard(JSON.parse(JSON.stringify(plan)), card.id, answer, { latencyMs: 3000, elapsedSec: 3 }, playEnv(content, s));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});

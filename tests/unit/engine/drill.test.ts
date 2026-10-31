/**
 * Sentence listening (PRD §7.6) and dictation scoring (PRD §7.3): T37, T38, T69, and the drill in a
 * session (PRD §10.2–§10.4).
 */
import { describe, expect, it } from "vitest";
import { knownShare, tileWords } from "@/engine/build";
import { dictationWords, scoreDictation } from "@/engine/dictation";
import { afterDrill, buildDrillEx, drillCounts, drillGate, drillReady, drillSentences } from "@/engine/drill";
import { grade } from "@/engine/grade";
import { seeded } from "@/engine/random";
import { buildSession, type BuildOptions, type BuildResult } from "@/engine/session/build";
import { playCard } from "@/engine/session/play";
import type { SessionPlan } from "@/engine/session/types";
import type { DrillStateE } from "@/engine/state";
import { plusDays, tehranDate } from "@/engine/time";
import { newItemState } from "@/engine/answer";
import { emptyCard, rateCard, withDue } from "@/engine/fsrs";
import { syntheticContent } from "../../../fixtures/synthetic";
import { always, playSession } from "../../../fixtures/synthetic/drive";
import { freshLearner, newDay } from "../../../fixtures/synthetic/learner";
import { content as kitContent, env as kitEnv, frenchSet, sentence, settings, word } from "./kit";

const NOW = new Date("2026-03-21T08:00:00Z");
const TODAY = tehranDate(NOW);
const daysAgo = (days: number) => plusDays(NOW, -days).toISOString();
const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({ scope: "mixed", lengthMin: 10, noAudio: false, cap: null, seed: "drill", ...over });
const planOf = (result: BuildResult): SessionPlan => {
  if (result.kind !== "plan") throw new Error(`Expected a plan, got ${result.kind}`);
  return result.plan;
};
const drillsOf = (plan: SessionPlan) => plan.queue.filter((card) => card.t === "drill");

describe("dictation (PRD §7.3)", () => {
  const ten = dictationWords("Nous avons mangé une soupe chaude dans la petite cuisine.", []);

  it("T37: nine of ten words is right, eight is wrong; a skipped word costs only itself", () => {
    expect(ten).toHaveLength(10);
    expect(scoreDictation("nous avons mangé une soup chaude dans la petite cuisine", ten, "fr")).toMatchObject({ score: 0.9, ok: true });
    expect(scoreDictation("nous avons mangé une soup chaud dans la petite cuisine", ten, "fr")).toMatchObject({ score: 0.8, ok: false });
    const skipped = scoreDictation("nous avons mangé soupe chaude dans la petite cuisine", ten, "fr");
    expect(skipped).toMatchObject({ score: 0.9, ok: true });
    expect(skipped.marks).toEqual([true, true, true, false, true, true, true, true, true, true]);
  });

  it("a dash or a sign alone is not a word to write or to place", () => {
    expect(dictationWords("Il a trois ans — non, quatre.", []).map((item) => item.text)).toEqual(["Il", "a", "trois", "ans", "non", "quatre"]);
    expect(tileWords("Il a trois ans — non, quatre.")).toEqual(["Il", "a", "trois", "ans", "non", "quatre"]);
    expect(tileWords("J'aime l'école.")).toEqual(["J'", "aime", "l'", "école"]);
  });

  it("an accent or a capital never counts; extra words cost nothing", () => {
    expect(scoreDictation("Nous avons mange une soupe chaude dans la petite cuisine", ten, "fr").score).toBe(1);
    expect(scoreDictation("nous avons bien mangé une bonne soupe chaude dans la petite cuisine", ten, "fr").score).toBe(1);
    const de = dictationWords("Ich habe einen Hund.", []);
    expect(scoreDictation("ich habe einen hund", de, "de").ok).toBe(true);
  });

  it("names are not scored, also behind an elision, and only as written", () => {
    const marie = dictationWords("Marie habite à Paris.", ["Marie", "Paris"]);
    expect(marie.map((item) => item.scored)).toEqual([false, true, true, false]);
    expect(scoreDictation("Mary habite a Pari", marie, "fr")).toMatchObject({ marks: [null, true, true, null], ok: true });
    expect(dictationWords("Il aime l'Italie.", ["Italie"]).map((item) => item.scored)).toEqual([true, true, false]);
    // «Pierre» the name, «pierre» the stone.
    expect(dictationWords("Pierre a une pierre.", ["Pierre"]).map((item) => item.scored)).toEqual([false, true, true, true]);
  });

  it("grades L3 like any typed answer: Persian letters are a message, an empty answer is wrong", () => {
    const words = kitContent({ words: frenchSet().words, sentences: frenchSet().sentences });
    const ex = buildDrillEx(kitEnv(words), words.sentences.get(1)!, "L3")!;
    expect(grade(ex, { text: "ماشین" }, { language: "fr" })).toEqual({ result: "persian" });
    expect(grade(ex, { text: "" }, { language: "fr" })).toMatchObject({ result: "wrong" });
    expect(grade(ex, { text: "la voiture est rouge" }, { language: "fr" })).toMatchObject({ result: "correct" });
  });
});

describe("a sentence heard alone (PRD §7.6)", () => {
  const set = frenchSet();
  const data = kitContent({ words: set.words, sentences: set.sentences });
  const env = kitEnv(data);
  const voiture = data.sentences.get(1)!;
  const state = (count: number, lastDaysAgo: number): DrillStateE => ({ sentenceId: 1, count, lastAt: daysAgo(lastDaysAgo) });

  it("T38: L1, then L2, then L3, then never; not again within three days", () => {
    expect(drillReady(env, voiture, undefined, NOW)).toBe("L1");
    expect(drillReady(env, voiture, state(1, 4), NOW)).toBe("L2");
    expect(drillReady(env, voiture, state(2, 4), NOW)).toBe("L3");
    expect(drillReady(env, voiture, state(3, 30), NOW)).toBeNull();
    expect(drillReady(env, voiture, state(1, 2), NOW)).toBeNull();
    // A showing counts whatever the answer.
    expect(afterDrill(1, state(1, 4), NOW)).toEqual({ sentenceId: 1, count: 2, lastAt: NOW.toISOString() });
    expect(afterDrill(1, null, NOW)).toEqual({ sentenceId: 1, count: 1, lastAt: NOW.toISOString() });
  });

  it("T69: a name and a digit are outside the known share, and a sentence with a digit never comes as L3", () => {
    const habiter = [word(30, "habite", "زندگی می‌کند", { pos: "verb" }), word(31, "à", "در", { pos: "prep" }), word(32, "depuis", "از", { pos: "prep" }), word(33, "ans", "سال", { gender: "m" })];
    const made = sentence(20, "Marie habite à Paris depuis 3 ans.", "ماری از سه سال پیش در پاریس زندگی می‌کند.", habiter);
    // The tokens of the PRD §14.2 sample: «Marie» is a name at the start too.
    const marie = { ...made, tokens: made.tokens.map((token, i) => (i === 0 ? { ...token, kind: "name" as const } : token)) };
    expect(marie.tokens.map((token) => token.kind)).toEqual(["name", "word", "word", "name", "word", "number", "word"]);
    // Four word tokens; «Marie», «Paris» and «3» are neither known nor unknown.
    expect(knownShare(marie, (id) => id !== 33, null)).toBe(0.75);
    const known = kitEnv(kitContent({ words: habiter, sentences: [marie] }));
    expect(drillReady(known, marie, undefined, NOW)).toBe("L1");
    expect(drillReady(known, marie, { sentenceId: 20, count: 1, lastAt: daysAgo(5) }, NOW)).toBe("L2");
    expect(drillReady(known, marie, { sentenceId: 20, count: 2, lastAt: daysAgo(5) }, NOW)).toBeNull();
  });

  it("only a published bank sentence of at most `drill.max_words` words, every word known, with its exercise on", () => {
    expect(drillReady({ ...env, known: (id) => id !== 19 }, voiture, undefined, NOW)).toBeNull();
    expect(drillReady(env, { ...voiture, bank: false }, undefined, NOW)).toBeNull();
    expect(drillReady({ ...env, settings: settings({ "drill.max_words": 3 }) }, voiture, undefined, NOW)).toBeNull();
    expect(drillReady({ ...env, settings: settings({ "exercise.L2.enabled": false }) }, voiture, state(1, 4), NOW)).toBeNull();
    // «grande» is not a word of the list: the sentence is not readable.
    expect(drillReady(env, data.sentences.get(3)!, undefined, NOW)).toBeNull();
  });

  it("sentences further along come first, then the oldest last showing", () => {
    const drills = new Map<number, DrillStateE>([
      [1, { sentenceId: 1, count: 1, lastAt: daysAgo(5) }],
      [2, { sentenceId: 2, count: 2, lastAt: daysAgo(4) }],
      [4, { sentenceId: 4, count: 1, lastAt: daysAgo(9) }],
    ]);
    const order = drillSentences(env, drills, NOW).map(({ sentence: item, code }) => `${item.id}:${code}`);
    expect(order.slice(0, 3)).toEqual(["2:L3", "4:L2", "1:L2"]);
    expect(order.slice(3).every((entry) => entry.endsWith(":L1"))).toBe(true);
  });

  it("builds each showing: the translation among four, the heard words as tiles, the sentence written", () => {
    const l1 = buildDrillEx(env, voiture, "L1")!;
    expect(l1).toMatchObject({ code: "L1", item: "l:1", sentenceId: 1, audio: true, listen: voiture.speak });
    const choice = l1.a;
    if (choice.kind !== "choice") throw new Error("L1 is a choice");
    expect(choice.options).toHaveLength(4);
    expect(choice.options.every((option) => option.lang === "fa")).toBe(true);
    expect(choice.options.find((option) => option.id === choice.correct)?.text).toBe("ماشین قرمز است.");
    const l2 = buildDrillEx(env, voiture, "L2")!;
    expect(l2.a).toMatchObject({ kind: "tiles", orders: [["la", "voiture", "est", "rouge"]] });
    const l3 = buildDrillEx(env, voiture, "L3")!;
    expect(l3).toMatchObject({ typed: true, a: { kind: "dictation", words: [{ text: "La" }, { text: "voiture" }, { text: "est" }, { text: "rouge" }] } });
    // The sentence and its translation are in the question, for after the answer.
    expect(l3.q.sentence).toMatchObject({ text: voiture.text, translation: voiture.translationFa });
  });

  it("counts what the listening button shows", () => {
    const drills: DrillStateE[] = [
      { sentenceId: 1, count: 3, lastAt: daysAgo(10) },
      { sentenceId: 2, count: 1, lastAt: daysAgo(1) },
    ];
    expect(drillCounts(env, drills, NOW)).toEqual({ heard: 2, done: 1, playable: true });
    // Every sentence heard three times, or waiting for its gap: nothing to hear now.
    const all: DrillStateE[] = [...data.sentences.keys()].map((sentenceId) => ({ sentenceId, count: sentenceId % 2 ? 3 : 1, lastAt: daysAgo(1) }));
    expect(drillCounts(env, all, NOW)).toMatchObject({ playable: false });
  });
});

describe("sentence listening in a session (PRD §10.2–§10.4)", () => {
  const content = syntheticContent();
  const s = settings();
  const cardWords = [...content.words.values()].filter((item) => !item.noCard).map((item) => item.id);
  const withWords = (count: number) => {
    const intro = plusDays(NOW, -3);
    const items = cardWords.slice(0, count).map((id) => ({
      ...newItemState("word", id, intro),
      step: 2,
      firstReviewDone: true,
      fsrs: withDue(rateCard(emptyCard(intro), "good", intro, s), plusDays(NOW, 5)),
    }));
    return { ...newDay(freshLearner("fr", { sessionLength: 15 }), TODAY), items };
  };

  it("T23: opens with 30 introduced card words for a learner from zero, at once for one placed higher", () => {
    expect(drillGate(true, 29, s)).toEqual({ need: 30, left: 1 });
    expect(drillGate(true, 30, s)).toBeNull();
    expect(drillGate(false, 0, s)).toBeNull();
    expect(drillsOf(planOf(buildSession(content, withWords(29), s, NOW, TODAY, opts({ lengthMin: 15 }))))).toHaveLength(0);
    expect(buildSession(content, withWords(29), s, NOW, TODAY, opts({ scope: "listening" })).kind).toBe("nothing_left");
    expect(drillsOf(planOf(buildSession(content, withWords(30), s, NOW, TODAY, opts({ lengthMin: 15 })))).length).toBeGreaterThan(0);
  });

  it("the listening button fills its time with drills only; without sound there are none", () => {
    const listening = planOf(buildSession(content, withWords(40), s, NOW, TODAY, opts({ scope: "listening" })));
    expect(listening.queue.length).toBeGreaterThan(3);
    expect(listening.queue.every((card) => card.t === "drill")).toBe(true);
    expect(listening.queue.every((card) => card.ex?.code === "L1")).toBe(true);
    // No sentence twice in one session.
    const ids = listening.queue.map((card) => card.ex!.sentenceId);
    expect(new Set(ids).size).toBe(ids.length);
    const mixed = buildSession(content, withWords(40), s, NOW, TODAY, opts({ lengthMin: 15, noAudio: true }));
    expect(mixed.kind === "plan" ? drillsOf(mixed.plan) : []).toHaveLength(0);
    expect(buildSession(content, withWords(40), s, NOW, TODAY, opts({ scope: "listening", noAudio: true })).kind).toBe("nothing_left");
    // Vocabulary and grammar sessions keep to their skill.
    expect(drillsOf(planOf(buildSession(content, withWords(40), s, NOW, TODAY, opts({ scope: "vocab" }))))).toHaveLength(0);
  });

  it("a drill never uses a sentence another exercise of the session uses", () => {
    const plan = planOf(buildSession(content, withWords(60), s, NOW, TODAY, opts({ lengthMin: 20 })));
    const drilled = new Set(drillsOf(plan).map((card) => card.ex!.sentenceId));
    expect(drilled.size).toBeGreaterThan(0);
    for (const card of plan.queue) {
      if (card.t === "drill") continue;
      for (const ex of [card.ex, card.alt]) if (ex?.sentenceId) expect(drilled.has(ex.sentenceId)).toBe(false);
    }
  });

  it("a played drill changes no item and no notebook; the sentence comes back as L2 after three days", () => {
    const learner = withWords(40);
    const plan = planOf(buildSession(content, learner, s, NOW, TODAY, opts({ scope: "listening" })));
    const card = plan.queue[0];
    const wrong = playCard(plan, card.id, { idk: true }, { latencyMs: 4000, elapsedSec: 4 }, { ctx: { settings: s, now: NOW, today: TODAY, latency: {} }, language: "fr", wordsWithLemma: () => [] });
    if (!wrong.done) throw new Error("idk is graded");
    expect(wrong).toMatchObject({ drill: card.ex!.sentenceId, state: null, notebook: [], single: null });
    expect(wrong.log).toMatchObject({ kind: "drill", result: "idk", itemType: null, itemId: null, code: "L1", sentenceId: card.ex!.sentenceId });

    const played = playSession(content, learner, s, NOW, opts({ scope: "listening" }), always(true), seeded("drill"));
    expect(played.learner.items).toEqual(learner.items);
    expect(played.learner.notebook).toEqual([]);
    const first = played.results[0].card.ex!.sentenceId!;
    expect(played.learner.drills.find((drill) => drill.sentenceId === first)).toMatchObject({ count: 1 });
    // Two days later the sentence waits; four days later it is heard again, as L2, before new sentences.
    const soon = planOf(buildSession(content, played.learner, s, plusDays(NOW, 2), tehranDate(plusDays(NOW, 2)), opts({ scope: "listening" })));
    expect(soon.queue.some((item) => item.ex!.sentenceId === first)).toBe(false);
    const later = planOf(buildSession(content, played.learner, s, plusDays(NOW, 4), tehranDate(plusDays(NOW, 4)), opts({ scope: "listening" })));
    expect(later.queue[0].ex!.code).toBe("L2");
    expect(later.queue.find((item) => item.ex!.sentenceId === first)?.ex!.code).toBe("L2");
  });

  it("counts drills among the reviews of the start button", () => {
    const plan = planOf(buildSession(content, withWords(40), s, NOW, TODAY, opts({ scope: "listening" })));
    expect(plan.summary.reviews).toBe(plan.queue.length);
    expect(plan.summary.newItems).toBe(0);
  });
});

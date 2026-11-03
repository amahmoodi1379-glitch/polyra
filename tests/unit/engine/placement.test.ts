/**
 * Placement (PRD §11): the blocks, grammar, the texts, «ادامه نمی‌دهم», the result and what it writes;
 * the sample after it (PRD §11.4) with its one-letter allowance (PRD §5.6), and what `known_below`
 * means for new material afterwards. Content is made up (`fixtures/synthetic`).
 */
import { describe, expect, it } from "vitest";
import type { Content } from "@/engine/content";
import type { RawAnswer } from "@/engine/ex";
import { grade } from "@/engine/grade";
import { grammarLevel, indexItems } from "@/engine/levels";
import {
  applySampleAnswer,
  blockMarks,
  grammarSampleDue,
  placementAnswer,
  placementNext,
  placementOutcome,
  placementReadiness,
  placementResult,
  placementStop,
  sampleMarks,
  startPlacement,
  typoForms,
  type PlacementAsk,
  type PlacementState,
  type SampleState,
} from "@/engine/placement";
import { buildSession, type BuildOptions } from "@/engine/session/build";
import { conjCandidates, nextUnit } from "@/engine/session/newmaterial";
import { playCard, shownEx, type PlayEnv } from "@/engine/session/play";
import type { SessionPlan } from "@/engine/session/types";
import type { Settings } from "@/engine/settings";
import { itemKey, type ItemStateE, type LearnerSnapshot } from "@/engine/state";
import { addDays, tehranDate, tehranDayStart } from "@/engine/time";
import { syntheticContent } from "../../../fixtures/synthetic";
import { rightAnswer, wrongAnswer } from "../../../fixtures/synthetic/drive";
import { freshLearner, newDay } from "../../../fixtures/synthetic/learner";
import { defaults, settings } from "./kit";
import { buildWordEx } from "@/engine/build";
import { content as kitContent, env as kitEnv, frenchSet } from "./kit";

const NOW = new Date("2026-03-21T08:00:00Z");
const TODAY = tehranDate(NOW);
const LEVELS = ["A1", "A2", "B1", "B2"];
const s = defaults;

function made(open = LEVELS, over: Parameters<typeof syntheticContent>[0] = {}): Content {
  const content = syntheticContent({ levels: LEVELS, openLevels: open, perLevel: { words: [60, 60, 60, 60], units: [10, 10, 10, 10] }, textsPerLevel: 2, ...over });
  return content;
}

/** Both texts of every level may be used in the test, so each track gets its own. */
function bothTextsOk(content: Content): Content {
  return { ...content, texts: content.texts.map((text) => ({ ...text, placementOk: true })) };
}

type Answer = "correct" | "wrong" | "idk";
type Question = Extract<PlacementAsk, { kind: "question" }>;

/** Takes the test: `answer` for each question, `score` for each text; `stopWhen` presses «ادامه نمی‌دهم». */
function take(content: Content, answer: (ask: Question) => Answer, score: (ask: Extract<PlacementAsk, { kind: "text" }>) => number = () => 1, stopWhen?: (ask: PlacementAsk) => boolean, set: Settings = s) {
  let state: PlacementState = startPlacement(content, set, "test");
  const asked: PlacementAsk[] = [];
  for (let i = 0; i < 200; i++) {
    const next = placementNext(content, set, state);
    state = next.state;
    if (!next.ask) break;
    if (stopWhen?.(next.ask)) {
      state = placementStop(content, set, state);
      break;
    }
    asked.push(next.ask);
    if (next.ask.kind === "text") state = placementAnswer(content, set, state, { score: score(next.ask) });
    else state = placementAnswer(content, set, state, answer(next.ask));
  }
  return { state, asked, result: placementResult(content, set, state) };
}

const questions = (asked: PlacementAsk[], part: "vocab" | "grammar", level: string) => asked.filter((ask): ask is Question => ask.kind === "question" && ask.part === part && ask.level === level);

describe("placement test (PRD §11.2)", () => {
  it("T28: A1 9/10, A2 8/10, B1 out at the third wrong on question 5; grammar A2 passed; listening 0.8, reading 0.5", () => {
    const content = bothTextsOk(made());
    const wrongAt: Record<string, number[]> = { A1: [3], A2: [2, 7], B1: [2, 4, 5] };
    const { asked, result, state } = take(
      content,
      (ask) => (ask.part === "vocab" && wrongAt[ask.level]?.includes(ask.number) ? "wrong" : "correct"),
      (ask) => (ask.track === "listening" ? 0.8 : 0.5),
    );
    expect(questions(asked, "vocab", "A1")).toHaveLength(10);
    expect(questions(asked, "vocab", "A2")).toHaveLength(10);
    expect(questions(asked, "vocab", "B1")).toHaveLength(5);
    expect(questions(asked, "vocab", "B2")).toHaveLength(0);
    // Grammar: one block at P_v, passed.
    expect(questions(asked, "grammar", "A2")).toHaveLength(10);
    expect(asked.filter((ask) => ask.kind === "question" && ask.part === "grammar")).toHaveLength(10);
    expect(result).toMatchObject({ pv: "A2", fv: "B1", fg: "B1", listening: "B1", reading: "A2", above: null, phonicsAuto: false, stopped: false });
    // Two different texts of A2, one per track, both used.
    const texts = asked.filter((ask) => ask.kind === "text");
    expect(texts.map((ask) => ask.level)).toEqual(["A2", "A2"]);
    expect(new Set(result.texts.map((text) => text.textId)).size).toBe(2);
    expect(result.texts.map((text) => text.track).sort()).toEqual(["listening", "reading"]);

    const outcome = placementOutcome(content, s, result, state.seed, NOW, TODAY);
    expect(outcome.skills.find((row) => row.skill === "vocab")).toEqual({ skill: "vocab", level: "B1", knownBelow: "B1" });
    expect(outcome.skills.find((row) => row.skill === "reading")).toEqual({ skill: "reading", level: "A2", knownBelow: "A2" });
    // The sample: 30 words of A2 due 10 today, 10 tomorrow, 10 the day after; 10 grammar sentences of A2.
    expect(outcome.cards).toHaveLength(30);
    for (const card of outcome.cards) {
      expect(content.words.get(card.itemId)!.level).toBe("A2");
      expect(card).toMatchObject({ probation: "sample", source: "placement", step: 5 });
    }
    const dues = outcome.cards.map((card) => tehranDate(new Date(card.fsrs.due)));
    expect([TODAY, addDays(TODAY, 1), addDays(TODAY, 2)].map((day) => dues.filter((due) => due === day).length)).toEqual([10, 10, 10]);
    expect(outcome.sample.vocab).toMatchObject({ level: "A2", result: "open" });
    expect(outcome.sample.grammar).toMatchObject({ level: "A2", result: "open", days: [TODAY, addDays(TODAY, 1)] });
    expect(outcome.sample.grammar!.targetIds).toHaveLength(10);
    for (const id of outcome.sample.grammar!.targetIds) expect(content.units.find((unit) => unit.id === content.targets.get(id)!.targetId)!.level).toBe("A2");
  });

  it("T29: three «نمی‌دانم» in the first block end the test after three questions: every skill A1, phonics on", () => {
    const content = made();
    const { asked, result, state } = take(content, () => "idk");
    expect(asked).toHaveLength(3);
    expect(result).toMatchObject({ pv: null, fv: "A1", fg: "A1", listening: "A1", reading: "A1", phonicsAuto: true, texts: [] });
    const outcome = placementOutcome(content, s, result, state.seed, NOW, TODAY);
    expect(outcome.cards).toEqual([]);
    expect(outcome.sample).toEqual({ vocab: null, grammar: null });
    expect(outcome.skills.every((row) => row.level === "A1" && row.knownBelow === "A1")).toBe(true);
  });

  it("T30: only A1 open and its block passed: F_v A1, above today's content; everything passed with every level open: above the path", () => {
    const onlyA1 = made(["A1"]);
    const first = take(onlyA1, () => "correct");
    expect(first.result).toMatchObject({ pv: "A1", fv: "A1", fg: "A1", above: "content" });
    expect(first.asked.every((ask) => ask.kind === "question" && ask.level === "A1")).toBe(true);
    const all = take(bothTextsOk(made()), () => "correct");
    expect(all.result).toMatchObject({ pv: "B2", fv: "B2", fg: "B2", listening: "B2", reading: "B2", above: "path" });
  });

  it("a question has no help: no meaning to touch and no translation under a grammar sentence; «نمی‌دانم» is there", () => {
    const content = made();
    const { asked } = take(content, () => "correct");
    for (const ask of asked) {
      if (ask.kind !== "question") continue;
      expect(ask.ex.idk).toBe(true);
      expect(ask.ex.code).toBe(ask.part === "vocab" ? "W1a" : "G1a");
      if (ask.ex.q.sentence) {
        expect(ask.ex.q.sentence.glosses).toEqual([]);
        expect(ask.ex.q.sentence.translation).toBeNull();
      }
    }
  });

  it("a vocabulary block takes one word from each tenth of the level, by intro order", () => {
    const content = made();
    const { asked } = take(content, () => "correct");
    const words = [...content.words.values()].filter((word) => word.level === "A1" && !word.noCard).sort((a, b) => a.introOrder - b.introOrder);
    const ids = questions(asked, "vocab", "A1").map((ask) => Number(ask.ex.item.slice(2)));
    ids.forEach((id, i) => {
      const at = words.findIndex((word) => word.id === id);
      expect(at).toBeGreaterThanOrEqual(Math.floor((i * words.length) / 10));
      expect(at).toBeLessThan(Math.floor(((i + 1) * words.length) / 10));
    });
  });

  it("grammar: a failed first block asks the level below; passing it gives P_v, failing it the level below", () => {
    const content = made();
    // Vocabulary passes A1, A2 and B1 (P_v = B1), fails B2.
    const vocab = (ask: Question): Answer => (ask.level === "B2" ? "wrong" : "correct");
    const passSecond = take(content, (ask) => (ask.part === "vocab" ? vocab(ask) : ask.level === "B1" ? "wrong" : "correct"));
    expect(passSecond.state.blocks.filter((block) => block.part === "grammar").map((block) => [block.level, block.passed])).toEqual([
      ["B1", false],
      ["A2", true],
    ]);
    expect(passSecond.result).toMatchObject({ pv: "B1", fv: "B2", fg: "B1" });
    const failBoth = take(content, (ask) => (ask.part === "vocab" ? vocab(ask) : "wrong"));
    expect(failBoth.result).toMatchObject({ pv: "B1", fv: "B2", fg: "A2" });
    // A first block at A1 that fails leaves grammar at A1 with no second block.
    const atA1 = take(content, (ask) => (ask.part === "vocab" ? (ask.level === "A1" ? "correct" : "wrong") : "wrong"));
    expect(atA1.state.blocks.filter((block) => block.part === "grammar")).toHaveLength(1);
    expect(atA1.result).toMatchObject({ pv: "A1", fv: "A2", fg: "A1" });
  });

  it("F_g is never above F_v, and texts come from the level below the lower of the two", () => {
    const content = bothTextsOk(made());
    const { result, asked } = take(content, (ask) => (ask.part === "vocab" ? (ask.level === "A1" ? "correct" : "wrong") : "correct"));
    expect(result).toMatchObject({ pv: "A1", fv: "A2", fg: "A2" });
    expect(asked.filter((ask) => ask.kind === "text").map((ask) => ask.level)).toEqual(["A1", "A1"]);
    expect(result).toMatchObject({ listening: "A2", reading: "A2" });
  });

  it("a track with no suitable text gets the level below L; a text below 0.75 keeps that level", () => {
    // Only one placement text per level: listening takes it, reading has none.
    const content = made();
    const { result, asked } = take(content, (ask) => (ask.level === "A1" ? "correct" : "wrong"), () => 0.7);
    expect(asked.filter((ask) => ask.kind === "text")).toHaveLength(1);
    expect(result).toMatchObject({ fv: "A2", fg: "A2", listening: "A1", reading: "A1" });
    const passed = take(content, (ask) => (ask.level === "A1" ? "correct" : "wrong"), () => 0.75);
    expect(passed.result).toMatchObject({ listening: "A2", reading: "A1" });
  });

  it("«ادامه نمی‌دهم»: the block on screen fails and the parts not started keep the lowest level", () => {
    const content = bothTextsOk(made());
    const midVocab = take(content, () => "correct", undefined, (ask) => ask.kind === "question" && ask.level === "A2" && ask.number === 4);
    expect(midVocab.result).toMatchObject({ pv: "A1", fv: "A2", fg: "A1", listening: "A1", reading: "A1", stopped: true });
    expect(midVocab.state.blocks.map((block) => [block.part, block.level, block.passed])).toEqual([
      ["vocab", "A1", true],
      ["vocab", "A2", false],
    ]);
    // Stopped in grammar: the block fails and no second one follows.
    const midGrammar = take(content, (ask) => (ask.part === "vocab" && ask.level === "B1" ? "wrong" : "correct"), undefined, (ask) => ask.kind === "question" && ask.part === "grammar" && ask.number === 2);
    expect(midGrammar.state.blocks.filter((block) => block.part === "grammar")).toHaveLength(1);
    expect(midGrammar.result).toMatchObject({ pv: "A2", fv: "B1", fg: "A1", listening: "A1", reading: "A1", stopped: true });
    // Stopped at the texts: vocabulary and grammar stand, the tracks keep the lowest level.
    const atText = take(content, (ask) => (ask.part === "vocab" && ask.level === "B1" ? "wrong" : "correct"), undefined, (ask) => ask.kind === "text");
    expect(atText.result).toMatchObject({ pv: "A2", fv: "B1", fg: "B1", listening: "A1", reading: "A1", stopped: true, texts: [] });
  });

  it("a small level: the pass mark is scaled to the words it has (DECISIONS.md)", () => {
    expect(blockMarks(s, 10)).toEqual({ need: 8, failAt: 3 });
    expect(blockMarks(s, 5)).toEqual({ need: 4, failAt: 2 });
    expect(blockMarks(s, 4)).toEqual({ need: 4, failAt: 1 });
    expect(blockMarks(s, 1)).toEqual({ need: 1, failAt: 1 });
    // A1 has four card words: a block of four, all of them needed.
    const content = made(LEVELS, { perLevel: { words: [4, 60, 60, 60], units: [10, 10, 10, 10] } });
    const { asked } = take(content, (ask) => (ask.level === "A1" && ask.number === 4 ? "wrong" : "correct"));
    const a1 = questions(asked, "vocab", "A1");
    expect(a1.map((ask) => ask.size)).toEqual([4, 4, 4, 4]);
    expect(questions(asked, "vocab", "A2")).toHaveLength(0);
  });

  it("a level with no grammar to ask is not held against the learner (DECISIONS.md)", () => {
    const content = made();
    const noA2 = { ...content, units: content.units.filter((unit) => unit.level !== "A2") };
    const { state, result } = take(noA2, (ask) => (ask.level === "B1" ? "wrong" : "correct"));
    expect(state.blocks.find((block) => block.part === "grammar")).toMatchObject({ level: "A2", size: 0, passed: true });
    expect(result).toMatchObject({ pv: "A2", fv: "B1", fg: "B1" });
  });

  it("the readiness counts are the test's own: words, grammar questions, sample sentences and suitable texts", () => {
    const content = made(["A1", "A2"]);
    const rows = placementReadiness(content, s);
    expect(rows.map((row) => [row.level, row.open])).toEqual([
      ["A1", true],
      ["A2", true],
      ["B1", false],
      ["B2", false],
    ]);
    expect(rows[0]).toMatchObject({ grammar: 10, sample: 10, blockSize: 10, sampleSize: 10, texts: { listening: 1, reading: 1 } });
    expect(rows[0].words).toBeGreaterThan(50);
  });
});

describe("the sample after placement (PRD §11.4)", () => {
  const content = bothTextsOk(made());
  const { result, state } = take(content, (ask) => (ask.part === "vocab" && ask.level === "B1" ? "wrong" : "correct"));
  const outcome = placementOutcome(content, s, result, state.seed, NOW, TODAY);

  it("the marks: 24 of 30 and the seventh wrong; 8 of 10 and the third wrong", () => {
    expect(sampleMarks(s, 30)).toEqual({ need: 24, failAt: 7 });
    expect(sampleMarks(s, 10)).toEqual({ need: 8, failAt: 3 });
  });

  it("T31: the 24th right answer passes the vocabulary sample; the level stays", () => {
    let sample: SampleState = outcome.sample;
    const ids = sample.vocab!.wordIds;
    for (let i = 0; i < 24; i++) {
      const done = applySampleAnswer(sample, { kind: "vocab", wordId: ids[i], ok: i >= 6 || i % 2 === 0 }, outcome.skills, outcome.cards, s);
      sample = done.sample;
      expect(done.skills).toBeNull();
    }
    expect(sample.vocab).toMatchObject({ ok: 21, wrong: 3, result: "open" });
    for (let i = 24; i < 27; i++) sample = applySampleAnswer(sample, { kind: "vocab", wordId: ids[i], ok: true }, outcome.skills, outcome.cards, s).sample;
    expect(sample.vocab).toMatchObject({ ok: 24, wrong: 3, result: "passed", notice: false });
    // Later answers change nothing.
    expect(applySampleAnswer(sample, { kind: "vocab", wordId: ids[27], ok: false }, outcome.skills, outcome.cards, s).sample).toEqual(sample);
  });

  it("T32: the seventh wrong answer: level and known_below go to P_v, the sample cards not asked yet go", () => {
    let sample: SampleState = outcome.sample;
    const ids = sample.vocab!.wordIds;
    let last: ReturnType<typeof applySampleAnswer> | null = null;
    // Answered so far: the first seven, all wrong. Cards still waiting: the other 23.
    const items: ItemStateE[] = outcome.cards;
    for (let i = 0; i < 7; i++) {
      last = applySampleAnswer(sample, { kind: "vocab", wordId: ids[i], ok: false }, outcome.skills, items.filter((item) => !ids.slice(0, i).includes(item.itemId)), s);
      sample = last.sample;
      if (i < 6) expect(last.failed).toBeNull();
    }
    expect(last!.failed).toBe("vocab");
    expect(sample.vocab).toMatchObject({ result: "failed", notice: true, wrong: 7 });
    expect(last!.skills!.find((row) => row.skill === "vocab")).toEqual({ skill: "vocab", level: "A2", knownBelow: "A2" });
    expect(last!.skills!.find((row) => row.skill === "grammar")).toEqual({ skill: "grammar", level: "B1", knownBelow: "B1" });
    expect(last!.remove.sort()).toEqual(ids.slice(7).map((id) => itemKey("word", id)).sort());
  });

  it("grammar: round one today, round two from tomorrow once round one is done; the third wrong fails it and grammar goes to that level", () => {
    let sample: SampleState = outcome.sample;
    const grammar = sample.grammar!;
    const first = grammarSampleDue(grammar, TODAY);
    expect(first).toEqual(grammar.targetIds.slice(0, 5));
    for (const id of first) sample = applySampleAnswer(sample, { kind: "grammar", targetId: id, ok: true }, outcome.skills, outcome.cards, s).sample;
    expect(grammarSampleDue(sample.grammar, TODAY)).toEqual([]);
    const second = grammarSampleDue(sample.grammar, addDays(TODAY, 1));
    expect(second).toEqual(grammar.targetIds.slice(5));
    // An answer to the same target twice counts once.
    expect(applySampleAnswer(sample, { kind: "grammar", targetId: first[0], ok: false }, outcome.skills, outcome.cards, s).sample).toEqual(sample);
    let done: ReturnType<typeof applySampleAnswer> | null = null;
    for (const id of second.slice(0, 3)) {
      done = applySampleAnswer(sample, { kind: "grammar", targetId: id, ok: false }, outcome.skills, outcome.cards, s);
      sample = done.sample;
    }
    expect(done!.failed).toBe("grammar");
    expect(sample.grammar).toMatchObject({ result: "failed", notice: true, ok: 5, wrong: 3 });
    expect(done!.skills!.find((row) => row.skill === "grammar")).toEqual({ skill: "grammar", level: "A2", knownBelow: "A2" });
    expect(done!.remove).toEqual([]);
    expect(grammarSampleDue(sample.grammar, addDays(TODAY, 1))).toEqual([]);
  });

  it("round one waits for its day, and the grammar sample passes at the eighth right answer", () => {
    let sample: SampleState = outcome.sample;
    expect(grammarSampleDue(sample.grammar, addDays(TODAY, -1))).toEqual([]);
    const ids = sample.grammar!.targetIds;
    ids.slice(0, 8).forEach((id, i) => {
      sample = applySampleAnswer(sample, { kind: "grammar", targetId: id, ok: i !== 1 }, outcome.skills, outcome.cards, s).sample;
    });
    expect(sample.grammar!.result).toBe("open");
    sample = applySampleAnswer(sample, { kind: "grammar", targetId: ids[8], ok: true }, outcome.skills, outcome.cards, s).sample;
    expect(sample.grammar).toMatchObject({ result: "passed", ok: 8, wrong: 1 });
  });

  it("no grammar sample when F_g is the lowest level; a recognize word is a step-3 card, a produce word step 5", () => {
    const low = placementOutcome(content, s, { ...result, fg: "A1" }, "x", NOW, TODAY);
    expect(low.sample.grammar).toBeNull();
    const word = [...content.words.values()].find((item) => item.level === "A2")!;
    const mixed = { ...content, words: new Map([...content.words].map(([id, item]) => [id, item.id === word.id ? { ...item, mastery: "recognize" as const } : item])) };
    const cards = placementOutcome(mixed, s, result, state.seed, NOW, TODAY).cards;
    const card = cards.find((item) => item.itemId === word.id);
    if (card) expect(card.step).toBe(3);
    expect(cards.filter((item) => item.step === 5)).toHaveLength(cards.length - (card ? 1 : 0));
  });
});

describe("the one-letter allowance of the sample (PRD §5.6)", () => {
  function w5a(lemma: string, typo: string[] | null) {
    const data = kitContent(frenchSet());
    const item = [...data.words.values()].find((entry) => entry.lemma === lemma)!;
    const ex = buildWordEx(kitEnv(data), item, "W5a")!;
    if (ex.a.kind !== "type") throw new Error("W5a types");
    return { ...ex, a: { ...ex.a, typo } };
  }

  it("T71: «voitur» for «voiture» is near (typo); «sur» for «sud» is wrong (shorter than 5); «allé» for «allée» in the grammar sample is wrong", () => {
    const voiture = w5a("voiture", []);
    expect(grade(voiture, { text: "voitur", gender: "une" }, { language: "fr" })).toMatchObject({ result: "near", reason: "typo" });
    // Outside the sample the same answer stays wrong (T06).
    expect(grade(w5a("voiture", null), { text: "voitur", gender: "une" }, { language: "fr" })).toMatchObject({ result: "wrong" });
    const sud = { ...voiture, a: { ...voiture.a, accepted: ["sud"], gender: null, noun: false } } as typeof voiture;
    expect(grade(sud, { text: "sur" }, { language: "fr" })).toMatchObject({ result: "wrong" });
    // The grammar sample's G5b has no allowance.
    const allee = { ...voiture, code: "G5b", a: { ...voiture.a, accepted: ["allée"], gender: null, noun: false, typo: null } } as typeof voiture;
    expect(grade(allee, { text: "allé" }, { language: "fr" })).toMatchObject({ result: "wrong" });
  });

  it("another word's form one letter away stays wrong", () => {
    const voiture = w5a("voiture", ["voitura"]);
    expect(grade(voiture, { text: "voitura", gender: "une" }, { language: "fr" })).toMatchObject({ result: "wrong" });
    const data = kitContent(frenchSet());
    const target = [...data.words.values()].find((entry) => entry.lemma === "voiture")!;
    const twin = { ...target, id: 999, lemma: "voitura", code: "voitura" };
    const withTwin = { ...data, words: new Map([...data.words, [999, twin]]) };
    expect(typoForms(withTwin, target)).toContain("voitura");
    expect(typoForms(data, target)).not.toContain("voiture");
  });
});

describe("after placement (PRD §11.3, §11.4)", () => {
  const content = bothTextsOk(made());
  const { result, state } = take(content, (ask) => (ask.part === "vocab" && ask.level === "B1" ? "wrong" : "correct"));
  const outcome = placementOutcome(content, s, result, state.seed, NOW, TODAY);

  function placed(): LearnerSnapshot {
    const fresh = freshLearner("fr", { sessionLength: 15 });
    return newDay({ ...fresh, enrollment: { ...fresh.enrollment, startMode: "placement" }, skills: outcome.skills, items: outcome.cards, sample: outcome.sample }, TODAY);
  }
  const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({ scope: "mixed", lengthMin: 15, noAudio: false, cap: null, seed: "placed", ...over });

  it("units below known_below count as known: the first new unit is the first of F_g, and conjugations of known units open", () => {
    const below = outcome.skills.find((row) => row.skill === "grammar")!.knownBelow;
    expect(below).toBe("B1");
    expect(nextUnit(content, new Map(), s, below)?.level).toBe("B1");
    expect(nextUnit(content, new Map(), s, null)?.level).toBe("A1");
    const known = () => true;
    const withKnown = conjCandidates(content, new Map(), new Map(), known, below);
    const without = conjCandidates(content, new Map(), new Map(), known, null);
    expect(withKnown.length).toBeGreaterThanOrEqual(without.length);
    // The grammar level never drops below known_below.
    expect(grammarLevel(content, indexItems([]), below)).toBe("B1");
  });

  it("today's session starts with the sample: the due sample words as W5a with the allowance, then the grammar sample as G5b with its translation", () => {
    const built = buildSession(content, placed(), s, NOW, TODAY, opts());
    expect(built.kind).toBe("plan");
    const plan = (built as { plan: SessionPlan }).plan;
    const due = new Set(outcome.cards.filter((card) => tehranDate(new Date(card.fsrs.due)) <= TODAY).map((card) => itemKey("word", card.itemId)));
    expect(due.size).toBe(10);
    const sampleWords = plan.queue.filter((card) => due.has(card.item));
    expect(sampleWords.length).toBeGreaterThan(0);
    for (const card of sampleWords) {
      const ex = shownEx(plan, card, false)!;
      expect(ex.code).toBe("W5a");
      expect(ex.a.kind === "type" && Array.isArray(ex.a.typo)).toBe(true);
    }
    const grammar = plan.queue.filter((card) => card.item.startsWith("g:"));
    expect(grammar.map((card) => Number(card.item.slice(2))).sort((a, b) => a - b)).toEqual([...outcome.sample.grammar!.targetIds.slice(0, 5)].sort((a, b) => a - b));
    for (const card of grammar) {
      const ex = shownEx(plan, card, false)!;
      expect(ex.code).toBe("G5b");
      expect(ex.a.kind === "type" && !ex.a.typo).toBe(true);
      // G5b keeps its Persian translation (PRD §6.3); only the meanings to touch go.
      expect(ex.q.sentence?.translation).toBeTruthy();
      expect(ex.q.sentence?.glosses).toEqual([]);
    }
    // Reviews come before new material: the first card is a sample card.
    expect(due.has(plan.queue[0].item) || plan.queue[0].item.startsWith("g:")).toBe(true);
  });

  it("playing a sample card reports the answer for the sample; a grammar sample answer logs kind placement", () => {
    const built = buildSession(content, placed(), s, NOW, TODAY, opts());
    const plan = (built as { plan: SessionPlan }).plan;
    const env: PlayEnv = { ctx: { settings: s, now: NOW, today: TODAY, latency: plan.latency }, language: "fr", wordsWithLemma: (lemma) => content.lemmaIndex.get(lemma) ?? [] };
    const timing = { latencyMs: 4000, elapsedSec: 10, alt: false };
    const sampleIds = new Set(outcome.sample.vocab!.wordIds);
    let current = plan;
    let grammar: unknown = null;
    let vocab: unknown = null;
    for (let i = 0; i < 200 && current.queue.length > 0 && (!grammar || !vocab); i++) {
      const card = current.queue[0];
      const ex = card.t === "intro" || card.t === "lesson" || card.t === "table" || card.t === "confusion" || card.t === "textwords" || card.t === "text" ? null : shownEx(current, card, false);
      const isGrammar = card.item.startsWith("g:");
      const answer: RawAnswer = ex ? (isGrammar ? wrongAnswer(ex) : rightAnswer(ex)) : { seen: true };
      const played = playCard(current, card.id, answer, timing, env);
      if (!played.done) {
        const again = playCard(current, card.id, { idk: true }, timing, env);
        if (!again.done) break;
        current = again.advanced.plan;
        continue;
      }
      if (isGrammar && !grammar) {
        expect(played.log.kind).toBe("placement");
        grammar = played.sample;
        expect(grammar).toEqual({ kind: "grammar", targetId: Number(card.item.slice(2)), ok: false });
      }
      if (card.item.startsWith("w:") && sampleIds.has(Number(card.item.slice(2))) && played.log.kind === "review" && !vocab) {
        vocab = played.sample;
        expect(vocab).toEqual({ kind: "vocab", wordId: Number(card.item.slice(2)), ok: true });
      }
      current = played.advanced.plan;
    }
    expect(grammar).not.toBeNull();
    expect(vocab).not.toBeNull();
  });

  it("the sample's later days come due on their day (a third each)", () => {
    const later = newDay(placed(), addDays(TODAY, 2));
    const at = tehranDayStart(addDays(TODAY, 2));
    const built = buildSession(content, later, settings({ "session.overrun": 600 }), new Date(at.getTime() + 8 * 3_600_000), addDays(TODAY, 2), opts({ lengthMin: 30 }));
    const plan = (built as { plan: SessionPlan }).plan;
    const ids = new Set(outcome.cards.map((card) => itemKey("word", card.itemId)));
    expect(plan.queue.filter((card) => ids.has(card.item)).length).toBeGreaterThan(10);
  });
});

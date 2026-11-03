/**
 * «پرش از این سطح» (PRD §11.6, T33): when the button shows, what each skill's exam asks, the pass
 * mark, the wait after a fail and what a pass changes. Content is made up (`fixtures/synthetic`).
 */
import { describe, expect, it } from "vitest";
import type { Content } from "@/engine/content";
import { examAnswer, examNext, examOffer, examOver, examResult, examSkills, startExam, type ExamLearner, type ExamState } from "@/engine/exam";
import { grade } from "@/engine/grade";
import { grammarLevel, indexItems } from "@/engine/levels";
import { probationState, newItemState } from "@/engine/answer";
import { nextUnit } from "@/engine/session/newmaterial";
import type { SkillLevelE } from "@/engine/state";
import { plusDays } from "@/engine/time";
import { syntheticContent } from "../../../fixtures/synthetic";
import { rightAnswer, wrongAnswer } from "../../../fixtures/synthetic/drive";
import { settings } from "./kit";

const NOW = new Date("2026-03-21T08:00:00Z");
const s = settings();
const content: Content = syntheticContent({ perLevel: { words: [60, 40, 40, 40], units: [16, 16, 4, 4] }, textsPerLevel: 4 });
const skills = (level = "A1", knownBelow = "A1"): SkillLevelE[] => (["vocab", "grammar", "listening", "reading"] as const).map((skill) => ({ skill, level, knownBelow }));
const fresh = (over: Partial<ExamLearner> = {}): ExamLearner => ({ skills: skills(), items: [], texts: [], ...over });

/** Answers every question: right for the first `right`, then wrong; texts get `score`. */
function take(state: ExamState, right: number, score = 1): ExamState {
  let current = state;
  let given = 0;
  for (let i = 0; i < 100; i++) {
    const next = examNext(content, s, current);
    current = next.state;
    if (!next.ask) break;
    if (next.ask.kind === "text") {
      current = examAnswer(current, { textId: next.ask.textId, score, questions: 4 });
      continue;
    }
    const ex = next.ask.ex;
    const answer = given++ < right ? rightAnswer(ex) : wrongAnswer(ex);
    const graded = grade(ex, answer, { language: "fr", wordsWithLemma: (lemma) => content.lemmaIndex.get(lemma) ?? [] });
    current = examAnswer(current, { result: graded.result as "correct" | "near" | "wrong" | "idk" });
  }
  return current;
}

describe("the button (PRD §3.3, §11.6)", () => {
  it("is ready at A1 with A2 published; shows «سطح بعد به‌زودی» when A2 is not; nothing at the last level", () => {
    expect(examOffer(content, fresh(), "vocab", s, null, NOW)).toEqual({ kind: "ready", level: "A1", next: "A2" });
    const closed = { ...content, openLevels: ["A1"] };
    expect(examOffer(closed, fresh(), "vocab", s, null, NOW)).toEqual({ kind: "soon", next: "A2" });
    expect(examOffer(content, fresh({ skills: skills("B2", "B2") }), "vocab", s, null, NOW)).toEqual({ kind: "top" });
    // Open (as for a tester) but empty: «به‌زودی» too.
    const empty = { ...content, words: new Map([...content.words].filter(([, word]) => word.level !== "A2")) };
    expect(examOffer(empty, fresh(), "vocab", s, null, NOW)).toEqual({ kind: "soon", next: "A2" });
  });

  it("is hidden with fewer than 15 unknown words, 15 unopened units or 2 untouched texts left", () => {
    const a1 = [...content.words.values()].filter((word) => word.level === "A1" && !word.noCard);
    const almost = fresh({ items: a1.slice(0, a1.length - 14).map((word) => newItemState("word", word.id, NOW)) });
    expect(examOffer(content, almost, "vocab", s, null, NOW).kind).toBe("few");
    const units = content.units.filter((unit) => unit.level === "A1");
    const opened = fresh({ items: units.slice(0, 2).map((unit) => newItemState("grammar_unit", unit.id, NOW)) });
    expect(examOffer(content, opened, "grammar", s, null, NOW).kind).toBe("few");
    expect(examOffer(content, fresh(), "grammar", s, null, NOW).kind).toBe("ready");
    const texts = content.texts.filter((text) => text.level === "A1");
    const touched = fresh({ texts: texts.slice(0, texts.length - 1).map((text) => ({ textId: text.id, track: "reading" as const, attemptsDone: 1, firstScore: 1, scores: [], lastAttemptAt: null, nextAttemptAt: null, partial: null, partialUntil: null, usedInTest: false })) });
    // A text touched in the other track does not count for listening either.
    expect(examOffer(content, touched, "listening", s, null, NOW).kind).toBe("few");
  });

  it("after a fail: the date of the next try, seven days on; ready again on that day", () => {
    const failed = plusDays(NOW, -2);
    const offer = examOffer(content, fresh(), "vocab", s, failed, NOW);
    expect(offer).toMatchObject({ kind: "wait", level: "A1", next: "A2" });
    expect(examOffer(content, fresh(), "vocab", s, failed, plusDays(failed, 7)).kind).toBe("ready");
    expect(startExam(content, fresh(), "vocab", s, "x", failed, NOW)).toBeNull();
  });
});

describe("vocabulary (T33)", () => {
  it("15 typed W5a of produce card words of the level not known yet, with the one-letter allowance, no word to touch", () => {
    const known = [...content.words.values()].filter((word) => word.level === "A1" && !word.noCard).slice(0, 10);
    const learner = fresh({ items: known.map((word) => newItemState("word", word.id, NOW)) });
    const state = startExam(content, learner, "vocab", s, "seed", null, NOW)!;
    expect(state.items).toHaveLength(15);
    const ids = new Set(known.map((word) => word.id));
    for (const item of state.items) {
      expect(item.kind).toBe("word");
      if (item.kind !== "word") continue;
      expect(ids.has(item.id)).toBe(false);
      expect(content.words.get(item.id)!.level).toBe("A1");
      expect(item.code).toBe("W5a");
    }
    const ask = examNext(content, s, state).ask!;
    expect(ask.kind).toBe("question");
    if (ask.kind !== "question") return;
    expect(ask.ex.code).toBe("W5a");
    expect(ask.ex.a.kind === "type" && Array.isArray(ask.ex.a.typo)).toBe(true);
    expect(ask.ex.idk).toBe(true);
    expect(ask.ex.q.sentence?.glosses ?? []).toEqual([]);
  });

  it("recognize words fill in with W3b when the produce words are short", () => {
    const mixed = syntheticContent({ perLevel: { words: [60, 40, 40, 40], units: [16, 16, 4, 4] }, textsPerLevel: 4 });
    const a1 = [...mixed.words.values()].filter((word) => word.level === "A1" && !word.noCard);
    for (const word of a1.slice(10)) word.mastery = "recognize";
    const state = startExam(mixed, fresh(), "vocab", s, "seed", null, NOW)!;
    const codes = state.items.map((item) => (item.kind === "word" ? item.code : ""));
    expect(codes.filter((code) => code === "W5a").length).toBeLessThanOrEqual(10);
    expect(codes).toContain("W3b");
    expect(codes).toHaveLength(15);
  });

  it("12 of 15 passes: level and known_below go to A2; 11 of 15 fails and nothing changes", () => {
    const passed = take(startExam(content, fresh(), "vocab", s, "a", null, NOW)!, 12);
    expect(examResult(s, passed)).toEqual({ passed: true, score: 12, size: 15 });
    expect(examSkills(skills(), passed, examResult(s, passed)).find((row) => row.skill === "vocab")).toEqual({ skill: "vocab", level: "A2", knownBelow: "A2" });
    const failed = take(startExam(content, fresh(), "vocab", s, "b", null, NOW)!, 11);
    expect(examResult(s, failed)).toEqual({ passed: false, score: 11, size: 15 });
    expect(examSkills(skills(), failed, examResult(s, failed))).toEqual(skills());
  });

  it("ends once the result cannot change: at the twelfth right answer, or the fourth wrong one", () => {
    const allRight = take(startExam(content, fresh(), "vocab", s, "c", null, NOW)!, 15);
    expect(allRight.asked).toBe(12);
    const allWrong = take(startExam(content, fresh(), "vocab", s, "d", null, NOW)!, 0);
    expect(allWrong.asked).toBe(4);
    expect(examOver(s, allWrong)).toBe(true);
  });

  it("«نمی‌دانم» is wrong; the question on screen stays until it is answered", () => {
    const state = startExam(content, fresh(), "vocab", s, "e", null, NOW)!;
    const first = examNext(content, s, state);
    expect(examNext(content, s, first.state).ask).toEqual(first.ask);
    const after = examAnswer(first.state, { result: "idk" });
    expect(after).toMatchObject({ asked: 1, right: 0, current: null });
  });
});

describe("grammar (PRD §11.6)", () => {
  it("15 G5b of the level's unopened units, one each, evenly spaced, no allowance", () => {
    const state = startExam(content, fresh(), "grammar", s, "g", null, NOW)!;
    expect(state.items).toHaveLength(15);
    const units = state.items.map((item) => (item.kind === "target" ? content.targets.get(item.id)!.targetId : -1));
    expect(new Set(units).size).toBe(15);
    for (const id of units) expect(content.units.find((unit) => unit.id === id)!.level).toBe("A1");
    const ask = examNext(content, s, state).ask!;
    if (ask.kind !== "question") throw new Error("a question");
    expect(ask.ex.code).toBe("G5b");
    expect(ask.ex.a.kind === "type" && !ask.ex.a.typo).toBe(true);
  });

  it("a pass: A1's unopened units count as known and the next new unit is A2's first", () => {
    const state = take(startExam(content, fresh(), "grammar", s, "g2", null, NOW)!, 15);
    const result = examResult(s, state);
    expect(result.passed).toBe(true);
    const after = examSkills(skills(), state, result).find((row) => row.skill === "grammar")!;
    expect(after).toEqual({ skill: "grammar", level: "A2", knownBelow: "A2" });
    expect(grammarLevel(content, indexItems([]), after.knownBelow)).toBe("A2");
    expect(nextUnit(content, new Map(), s, after.knownBelow)?.id).toBe(content.units.find((unit) => unit.level === "A2")!.id);
  });
});

describe("listening and reading (PRD §11.6)", () => {
  it("two texts of the level no track touched, under their last attempt's conditions", () => {
    const state = startExam(content, fresh(), "listening", s, "t", null, NOW)!;
    expect(state.items).toHaveLength(2);
    const ask = examNext(content, s, state).ask!;
    if (ask.kind !== "text") throw new Error("a text");
    const text = content.texts.find((item) => item.id === ask.textId)!;
    expect(text.level).toBe("A1");
    expect(ask).toMatchObject(text.band === 1 ? { attempt: 2, set: "B" } : { attempt: 3, set: "A" });
    expect(ask.track).toBe("listening");
  });

  it("overall 0.8 passes and the track's level moves; 0.75 fails", () => {
    const passed = take(startExam(content, fresh(), "reading", s, "r", null, NOW)!, 0, 0.8);
    expect(examResult(s, passed)).toMatchObject({ passed: true, score: 80 });
    expect(examSkills(skills(), passed, examResult(s, passed)).find((row) => row.skill === "reading")).toEqual({ skill: "reading", level: "A2", knownBelow: "A1" });
    const failed = take(startExam(content, fresh(), "reading", s, "r2", null, NOW)!, 0, 0.75);
    expect(examResult(s, failed)).toMatchObject({ passed: false, score: 75 });
  });
});

describe("cards are not touched (PRD §11.6)", () => {
  it("a probation card stays as it was: the exam only reads the learner", () => {
    const word = [...content.words.values()].find((item) => item.level === "A1" && !item.noCard)!;
    const card = probationState("word", word.id, 5, "single", "i_know", NOW, s);
    const learner = fresh({ items: [card] });
    const state = take(startExam(content, learner, "vocab", s, "p", null, NOW)!, 12);
    expect(examResult(s, state).passed).toBe(true);
    expect(learner.items).toEqual([card]);
  });
});

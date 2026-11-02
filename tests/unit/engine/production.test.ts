/**
 * Speaking and writing (PRD §8b): «بگو، بعد بشنو», situational dialogues, find the mistake and the weekly
 * writing card; their gates (§10.3), their place in a mixed session (§8b.1, §10.2 step 6, §10.7) and what
 * an answer writes.
 */
import { describe, expect, it } from "vitest";
import { newItemState } from "@/engine/answer";
import { seeded } from "@/engine/random";
import {
  afterDialogue,
  afterErrorfix,
  afterSpeak,
  dialogueScore,
  errorfixPieces,
  gradeDialogue,
  gradeErrorfix,
  nextDialogue,
  nextErrorfix,
  speakDone,
  speakOrder,
  weeklyWriting,
  writingMinToFinish,
  writingWords,
  type WritingTaskC,
} from "@/engine/production";
import { indexItems } from "@/engine/levels";
import { buildSession, type BuildOptions, type BuildResult } from "@/engine/session/build";
import { needsSound, playCard, type PlayEnv } from "@/engine/session/play";
import type { SessionPlan } from "@/engine/session/types";
import { makeEnv } from "@/engine/session/views";
import type { LearnerSnapshot } from "@/engine/state";
import { addDays, tehranDate, tehranDayStart } from "@/engine/time";
import { syntheticContent } from "../../../fixtures/synthetic";
import { freshLearner, newDay } from "../../../fixtures/synthetic/learner";
import { settings } from "./kit";

const NOW = new Date("2026-03-21T08:00:00Z");
const TODAY = tehranDate(NOW);
const s = settings();
const content = syntheticContent({ dialoguesPerLevel: 2, errorfixPerLevel: 2 });

/** A learner with the first `count` card words of the content introduced `daysAgo` days ago, none due. */
function withWords(count: number, daysAgo = 30, over: Partial<LearnerSnapshot> = {}): LearnerSnapshot {
  const at = new Date(NOW.getTime() - daysAgo * 86_400_000);
  const ids = [...content.words.values()].filter((word) => !word.noCard).slice(0, count).map((word) => word.id);
  const items = ids.map((id) => {
    const state = newItemState("word", id, at);
    return { ...state, fsrs: { ...state.fsrs, due: new Date(NOW.getTime() + 20 * 86_400_000).toISOString() } };
  });
  return { ...newDay(freshLearner("fr", { sessionLength: 20 }), TODAY), items, ...over };
}
const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({ scope: "mixed", lengthMin: 20, noAudio: false, cap: "none", seed: "prod", ...over });
const planOf = (result: BuildResult): SessionPlan => {
  if (result.kind !== "plan") throw new Error(`Expected a plan, got ${result.kind}`);
  return result.plan;
};
const playEnv = (now = NOW): PlayEnv => ({ ctx: { settings: s, now, today: tehranDate(now), latency: {} }, language: "fr", wordsWithLemma: () => [] });

describe("«بگو، بعد بشنو» (PRD §8b.2)", () => {
  it("rates a showing and spaces the next one 2, 4 or 10 days later; done after two «درست گفتم» or four showings", () => {
    const no = afterSpeak(null, 7, "no", TODAY, s);
    expect(no).toEqual({ sentenceId: 7, count: 1, correctCount: 0, lastRating: "no", nextAt: tehranDayStart(addDays(TODAY, 2)).toISOString() });
    expect(afterSpeak(no, 7, "near", TODAY, s).nextAt).toBe(tehranDayStart(addDays(TODAY, 4)).toISOString());
    const ok = afterSpeak(afterSpeak(null, 7, "ok", TODAY, s), 7, "ok", TODAY, s);
    expect(ok.nextAt).toBe(tehranDayStart(addDays(TODAY, 10)).toISOString());
    expect(speakDone(ok, s)).toBe(true);
    expect(speakDone({ count: 4, correctCount: 1 }, s)).toBe(true);
    expect(speakDone({ count: 3, correctCount: 1 }, s)).toBe(false);
  });

  it("takes due sentences first, then new ones with a word of the last seven days; never a text's sentence, a dialogue's wrong answer or an unknown word", () => {
    const learner = withWords(60, 30);
    // Ten words of the sixty introduced yesterday.
    const recentIds = new Set(learner.items.slice(50).map((item) => item.itemId));
    learner.items = learner.items.map((item) => (recentIds.has(item.itemId) ? { ...item, introducedAt: new Date(NOW.getTime() - 86_400_000).toISOString() } : item));
    const env = makeEnv(content, learner, s, seeded("speak"));
    const fresh = [...speakOrder(env, [], learner.items, NOW)];
    expect(fresh.length).toBeGreaterThan(0);
    const known = new Set(learner.items.map((item) => item.itemId));
    for (const sentence of fresh) {
      expect(sentence.inText).toBeFalsy();
      expect(sentence.wrongChoice).toBeFalsy();
      for (const token of sentence.tokens) if (token.kind === "word") expect(known.has(token.wordId!) || content.words.get(token.wordId!)?.noCard).toBe(true);
    }
    const hasRecent = (id: number) => content.sentences.get(id)!.tokens.some((token) => token.wordId !== null && recentIds.has(token.wordId));
    const firstOld = fresh.findIndex((sentence) => !hasRecent(sentence.id));
    expect(fresh.slice(0, firstOld).length).toBeGreaterThan(0);
    expect(fresh.slice(firstOld).some((sentence) => hasRecent(sentence.id))).toBe(false);
    // A sentence due again comes first; one not due yet, or done, does not come.
    const [a, b, c] = fresh.slice(-3);
    const states = [
      { sentenceId: a.id, count: 1, correctCount: 0, lastRating: "no" as const, nextAt: new Date(NOW.getTime() - 1000).toISOString() },
      { sentenceId: b.id, count: 1, correctCount: 1, lastRating: "ok" as const, nextAt: new Date(NOW.getTime() + 86_400_000).toISOString() },
      { sentenceId: c.id, count: 4, correctCount: 0, lastRating: "no" as const, nextAt: null },
    ];
    const again = [...speakOrder(env, states, learner.items, NOW)];
    expect(again[0].id).toBe(a.id);
    expect(again.some((sentence) => sentence.id === b.id || sentence.id === c.id)).toBe(false);
  });
});

describe("situational dialogue (PRD §8b.4)", () => {
  it("opens after gate.dialogue_words introduced words, at the learner's vocabulary level or below", () => {
    const few = withWords(60);
    expect(nextDialogue(makeEnv(content, few, s, seeded("d")), [], 60, NOW)).toBeNull();
    const many = withWords(200);
    const pick = nextDialogue(makeEnv(content, many, s, seeded("d")), [], 200, NOW)!;
    expect(pick).toMatchObject({ attempt: 1, before: null });
    expect(pick.dialogue.level).toBe("A1");
  });

  it("needs 90% of its words known, or 80% when no dialogue reaches 90%", () => {
    const many = withWords(200);
    const dialogue = content.dialogues[0];
    const words = new Set(dialogue.turns.flatMap((turn) => [turn.sentenceId, ...turn.choices]).flatMap((id) => content.sentences.get(id)!.tokens.map((token) => token.wordId!)));
    // Every dialogue word unknown: nothing; the gate counts introduced words, not these.
    const env = makeEnv(content, { ...many, items: many.items.filter((item) => !words.has(item.itemId)) }, s, seeded("d"));
    expect(nextDialogue(env, [{ dialogueId: content.dialogues[1].id, attemptsDone: 2, scores: [1, 1], nextAttemptAt: null }], 200, NOW)).toBeNull();
  });

  it("brings attempt 2 seven days later, before a new one, then the dialogue is over", () => {
    const many = withWords(200);
    const env = makeEnv(content, many, s, seeded("d"));
    const first = afterDialogue(null, content.dialogues[0].id, 0.6, TODAY, s);
    expect(first.nextAttemptAt).toBe(tehranDayStart(addDays(TODAY, 7)).toISOString());
    expect(nextDialogue(env, [first], 200, NOW)?.dialogue.id).not.toBe(content.dialogues[0].id);
    const later = new Date(NOW.getTime() + 7 * 86_400_000);
    expect(nextDialogue(env, [first], 200, later)).toMatchObject({ attempt: 2, before: first });
    const second = afterDialogue(first, content.dialogues[0].id, 1, TODAY, s);
    expect(second).toMatchObject({ attemptsDone: 2, scores: [0.6, 1], nextAttemptAt: null });
  });

  it("scores the share of turns right at the first choice", () => {
    const view = { turns: [{ correct: 0 }, { correct: 2 }, { correct: 1 }] } as Parameters<typeof gradeDialogue>[0];
    const right = gradeDialogue(view, [0, 1, 1]);
    expect(right).toEqual([true, false, true]);
    expect(dialogueScore(right)).toBeCloseTo(2 / 3);
    expect(gradeDialogue(view, [])).toEqual([false, false, false]);
  });
});

describe("find the mistake (PRD §8b.5)", () => {
  const marked = "Hier, j'{{suis|ai}} mangé avec {{mon|mes}} amis.";
  const { pieces, marks } = errorfixPieces(marked);
  const view = { pieces, marks: marks.map((mark) => ({ ...mark, whyFa: "" })) };
  const at = (text: string) => pieces.findIndex((piece) => piece.text === text);

  it("shows the wrong forms as tappable words", () => {
    expect(pieces.map((piece) => piece.text).join("")).toBe("Hier, j'suis mangé avec mon amis.");
    expect(pieces.filter((piece) => piece.mark !== null).map((piece) => piece.text)).toEqual(["suis", "mon"]);
    expect(marks).toEqual([
      { wrong: "suis", right: "ai" },
      { wrong: "mon", right: "mes" },
    ]);
  });

  it("is right only with every mistake fixed and no right word changed; an accent is nearly right and counts", () => {
    expect(gradeErrorfix(view, { [at("suis")]: "ai", [at("mon")]: "mes" }, "fr").result).toEqual({ fixed: 2, of: 2, wrongTaps: 0, ok: true });
    const one = gradeErrorfix(view, { [at("suis")]: "ai" }, "fr");
    expect(one.marks).toEqual(["fixed", "missed"]);
    expect(one.result.ok).toBe(false);
    const tapped = gradeErrorfix(view, { [at("suis")]: "ai", [at("mon")]: "mes", [at("amis")]: "ami" }, "fr");
    expect(tapped.result).toEqual({ fixed: 2, of: 2, wrongTaps: 1, ok: false });
    // Typing a right word as it was is not a change.
    expect(gradeErrorfix(view, { [at("suis")]: "ai", [at("mon")]: "mes", [at("amis")]: "amis" }, "fr").result.ok).toBe(true);
    expect(gradeErrorfix(view, { [at("suis")]: "aï", [at("mon")]: "MES" }, "fr").marks).toEqual(["near", "fixed"]);
    expect(gradeErrorfix(view, { [at("suis")]: "as", [at("mon")]: "mes" }, "fr").marks).toEqual(["wrong", "fixed"]);
  });

  it("opens at grammar B1 with the text's units opened, and comes again seven days later", () => {
    const low = withWords(300);
    const env = makeEnv(content, low, s, seeded("e"));
    expect(nextErrorfix(env, [], indexItems(low.items), low.skills.find((skill) => skill.skill === "grammar"), NOW)).toBeNull();
    // Every unit up to B1 opened.
    const units = content.units.filter((unit) => ["A1", "A2", "B1"].includes(unit.level)).map((unit) => newItemState("grammar_unit", unit.id, NOW));
    const high = { ...low, items: [...low.items, ...units] };
    const pick = nextErrorfix(makeEnv(content, high, s, seeded("e")), [], indexItems(high.items), undefined, NOW);
    expect(pick?.attempt).toBe(1);
    expect(["A1", "A2", "B1"]).toContain(pick!.item.level);
    const first = afterErrorfix(null, pick!.item.id, { fixed: 1, of: 2, wrongTaps: 0, ok: false }, TODAY, s);
    expect(first.nextAttemptAt).toBe(tehranDayStart(addDays(TODAY, 7)).toISOString());
    expect(nextErrorfix(env, [first], indexItems(high.items), undefined, new Date(NOW.getTime() + 7 * 86_400_000))).toMatchObject({ attempt: 2 });
  });
});

describe("weekly writing (PRD §8b.6)", () => {
  const task = (id: number, level: string): WritingTaskC => ({
    id,
    level,
    promptFa: "بنویس",
    minWords: 60,
    maxWords: 120,
    checklist: [],
    phrases: [],
    modelAnswer: "",
    modelAnswerFa: "",
  });
  const tasks = [task(3, "B2"), task(2, "B1"), task(1, "B1")];

  it("opens at vocabulary B1, one task a week in level order and never above the learner's level", () => {
    expect(weeklyWriting(content, tasks, [], "A2", TODAY, s)).toEqual({ state: "closed" });
    expect(weeklyWriting(content, tasks, [], "B1", TODAY, s)).toEqual({ state: "open", task: tasks[2] });
    const thisWeek = [{ taskId: 1, at: NOW.toISOString() }];
    expect(weeklyWriting(content, tasks, thisWeek, "B1", TODAY, s)).toEqual({ state: "done" });
    const nextWeek = addDays(TODAY, 7);
    expect(weeklyWriting(content, tasks, thisWeek, "B1", nextWeek, s)).toEqual({ state: "open", task: tasks[1] });
    expect(weeklyWriting(content, tasks, [...thisWeek, { taskId: 2, at: NOW.toISOString() }], "B1", addDays(TODAY, 14), s)).toEqual({ state: "none" });
    expect(weeklyWriting(content, tasks, [], "B1", TODAY, settings({ "writing.per_week": 0 }))).toEqual({ state: "closed" });
  });

  it("counts words and lets the learner finish at half the smallest count", () => {
    expect(writingWords("Salut Léa, j'ai passé un bon week-end !")).toBe(7);
    expect(writingMinToFinish({ minWords: 60 })).toBe(30);
  });
});

describe("speaking in a mixed session (PRD §8b.1, §10.2 step 6, §10.7)", () => {
  const learner = () => {
    const base = withWords(200);
    const units = content.units.filter((unit) => ["A1", "A2", "B1"].includes(unit.level)).map((unit) => newItemState("grammar_unit", unit.id, new Date(NOW.getTime() - 30 * 86_400_000)));
    return { ...base, items: [...base.items, ...units.map((unit) => ({ ...unit, fsrs: { ...unit.fsrs, due: new Date(NOW.getTime() + 20 * 86_400_000).toISOString() } }))] };
  };

  it("brings one dialogue, one find-the-mistake text and «بگو، بعد بشنو», never «بگو» among the first three", () => {
    const plan = planOf(buildSession(content, learner(), s, NOW, TODAY, opts({ lengthMin: 30 })));
    const kinds = plan.queue.map((card) => card.t);
    expect(kinds.filter((kind) => kind === "dialogue")).toHaveLength(1);
    expect(kinds.filter((kind) => kind === "errorfix")).toHaveLength(1);
    expect(kinds).toContain("speak");
    expect(kinds.slice(0, 3)).not.toContain("speak");
  });

  it("has none in a single-skill session, in backlog mode's zero share or without sound for «بگو»", () => {
    for (const scope of ["vocab", "grammar", "quick", "listening"] as const) {
      const result = buildSession(content, learner(), s, NOW, TODAY, opts({ scope }));
      if (result.kind === "plan") expect(result.plan.queue.some((card) => card.prod)).toBe(false);
    }
    const silent = planOf(buildSession(content, learner(), s, NOW, TODAY, opts({ noAudio: true, lengthMin: 30 })));
    expect(silent.queue.some((card) => card.t === "speak")).toBe(false);
    expect(silent.queue.some((card) => card.t === "dialogue")).toBe(true);
    const none = planOf(buildSession(content, learner(), settings({ "share.production": 0 }), NOW, TODAY, opts({ lengthMin: 10 })));
    expect(none.queue.some((card) => card.t === "dialogue" || card.t === "errorfix")).toBe(false);
  });

  it("writes only the card's own row and moves no counter of the session", () => {
    const plan = planOf(buildSession(content, learner(), s, NOW, TODAY, opts({ lengthMin: 30 })));
    let current = plan;
    while (current.queue.length > 0 && !current.queue[0].prod) {
      const result = playCard(current, current.queue[0].id, current.queue[0].ex ? { idk: true } : { seen: true }, { latencyMs: 4000, elapsedSec: 10 }, playEnv());
      if (!result.done) throw new Error("not done");
      current = result.advanced.plan;
    }
    const card = current.queue[0];
    const prod = card.prod!;
    const answer =
      prod.kind === "speak"
        ? { self: "near" as const }
        : prod.kind === "dialogue"
          ? { turns: prod.view.turns.map((turn) => turn.correct) }
          : { fixes: Object.fromEntries(prod.view.pieces.flatMap((piece, i) => (piece.mark === null ? [] : [[String(i), prod.view.marks[piece.mark].right]]))) };
    const result = playCard(current, card.id, answer, { latencyMs: 20_000, elapsedSec: 60 }, playEnv());
    if (!result.done) throw new Error("not done");
    expect(result.state).toBeNull();
    expect(result.notebook).toEqual([]);
    expect(result.advanced.plan.counters).toEqual(current.counters);
    expect(result.production?.kind).toBe(prod.kind);
    if (result.production?.kind === "dialogue") expect(result.production.score).toBe(1);
    if (result.production?.kind === "errorfix") expect(result.production.graded.result.ok).toBe(true);
    if (result.production?.kind === "speak") expect(result.log).toMatchObject({ kind: "self", result: "self_near", code: "S1" });
    expect(needsSound(current, card)).toBe(card.t === "speak");
  });
});

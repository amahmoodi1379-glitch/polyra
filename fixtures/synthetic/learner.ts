/**
 * A learner kept in memory, for engine tests and the simulator: what the server keeps in the
 * database, changed the same way after every card.
 */
import type { Content } from "../../src/engine/content";
import { indexItems, levelsAfter } from "../../src/engine/levels";
import { applyNotebook } from "../../src/engine/notebook";
import { closeRounds, type PlayResult } from "../../src/engine/session/play";
import type { SessionPlan } from "../../src/engine/session/types";
import { afterDrill } from "../../src/engine/drill";
import { textLevelsAfter } from "../../src/engine/texts";
import { isItemKey, itemKey, type DailyE, type ItemHistory, type LearnerSnapshot, type SkillName } from "../../src/engine/state";
import type { Settings } from "../../src/engine/settings";

/** A day's counters before any session. */
export const emptyDay = (date: string): DailyE => ({
  date,
  newWords: 0,
  wordsCapToday: null,
  capPromptShown: false,
  queueWords: 0,
  newUnits: 0,
  newConj: 0,
  activeSec: 0,
  newTextSec: { listening: 0, reading: 0 },
  textSessionDone: false,
});

export function freshLearner(language: string, opts: { sessionLength?: number; vocabLevel?: string; knownBelow?: string } = {}): LearnerSnapshot {
  const level = opts.vocabLevel ?? "A1";
  return {
    userId: 1,
    sessionLength: opts.sessionLength ?? 15,
    enrollment: {
      language,
      startMode: "zero",
      paceMode: "normal",
      lastSpreadDate: null,
      phonicsAuto: false,
      streakCount: 0,
      streakLastDate: null,
      streakForgivenWeek: null,
      streakForgivenCount: 0,
      freezeCount: 0,
      freezeCheckedWeek: null,
      textPromptDate: null,
    },
    skills: [
      { skill: "vocab", level, knownBelow: opts.knownBelow ?? "A1" },
      { skill: "grammar", level, knownBelow: opts.knownBelow ?? "A1" },
      { skill: "listening", level, knownBelow: opts.knownBelow ?? "A1" },
      { skill: "reading", level, knownBelow: opts.knownBelow ?? "A1" },
    ],
    items: [],
    notebook: [],
    queue: [],
    today: emptyDay(""),
    confusions: [],
    drills: [],
    texts: [],
    mixedWithoutText: 0,
    history: new Map(),
    sentenceSeen: new Map(),
    latency: {},
    paceReviews: [],
    recentIntroWordIds: [],
    touchedToday: [],
  };
}

/** A new calendar day: the daily counters start again. */
export function newDay(learner: LearnerSnapshot, today: string): LearnerSnapshot {
  if (learner.today.date === today) return learner;
  return { ...learner, today: emptyDay(today), touchedToday: [] };
}

/** Writes one finished card into the learner, as the server does in the database. */
export function record(learner: LearnerSnapshot, result: Extract<PlayResult, { done: true }>, settings: Settings, now: Date, today: string, latencyMs: number): LearnerSnapshot {
  const next: LearnerSnapshot = {
    ...learner,
    history: new Map(learner.history),
    sentenceSeen: new Map(learner.sentenceSeen),
    latency: { ...learner.latency },
    today: { ...learner.today },
  };
  const key = result.card.item;
  const upsert = (state: NonNullable<typeof result.state>) => {
    const exists = next.items.some((item) => item.itemType === state.itemType && item.itemId === state.itemId);
    if (!exists) {
      if (state.itemType === "word") {
        next.today.newWords++;
        if (result.advanced.plan.items[itemKey("word", state.itemId)]?.queued) next.today.queueWords++;
        next.queue = next.queue.filter((row) => row.wordId !== state.itemId);
        next.recentIntroWordIds = [state.itemId, ...next.recentIntroWordIds].slice(0, 20);
      } else if (state.itemType === "grammar_unit") next.today.newUnits++;
      else next.today.newConj++;
    }
    next.items = [...next.items.filter((item) => !(item.itemType === state.itemType && item.itemId === state.itemId)), state];
  };
  // Today's items, as the server reads them from today's review log (cards of items, not a notebook sentence or a drill).
  if (isItemKey(key) && !next.touchedToday.includes(key)) next.touchedToday = [...next.touchedToday, key];
  if (result.state) upsert(result.state);
  if (result.roundState) upsert(result.roundState);
  if (result.notebook.length) next.notebook = applyNotebook(next.notebook, result.notebook, now, today, settings);
  if (result.pair) {
    const pair = result.pair;
    next.confusions = [...next.confusions.filter((item) => !(item.wordId === pair.wordId && item.otherWordId === pair.otherWordId)), pair];
  }
  if (result.text) {
    const { state, track, newSec } = result.text;
    next.texts = [...next.texts.filter((item) => !(item.textId === state.textId && item.track === state.track)), state];
    next.today.newTextSec = { ...next.today.newTextSec, [track]: next.today.newTextSec[track] + newSec };
  }
  // «کلمه‌های این متن»: the key words wait in the queue (PRD §7.5, source `key_word`).
  for (const wordId of result.keyWords) {
    if (next.items.some((item) => item.itemType === "word" && item.itemId === wordId) || next.queue.some((row) => row.wordId === wordId)) continue;
    next.queue = [...next.queue, { wordId, source: "key_word", addedAt: now.toISOString() }];
  }
  if (result.drill !== null) {
    const sentenceId = result.drill;
    const before = next.drills.find((drill) => drill.sentenceId === sentenceId) ?? null;
    next.drills = [...next.drills.filter((drill) => drill.sentenceId !== sentenceId), afterDrill(sentenceId, before, now)];
  }
  const ex = result.ex;
  // Like the server's queries: every answer counts its sentence as seen; history and answer times are the items' own.
  if (ex && result.log.kind !== "intro" && ex.sentenceId) next.sentenceSeen.set(ex.sentenceId, (next.sentenceSeen.get(ex.sentenceId) ?? 0) + 1);
  if (ex && (result.log.kind === "review" || result.log.kind === "followup" || result.log.kind === "practice")) {
    if (isItemKey(key)) {
      const history: ItemHistory = next.history.get(key) ?? { codeCounts: {}, lastCode: null, recentSentences: [] };
      next.history.set(key, {
        codeCounts: { ...history.codeCounts, [ex.code]: (history.codeCounts[ex.code] ?? 0) + 1 },
        lastCode: ex.code,
        recentSentences: ex.sentenceId ? [ex.sentenceId, ...history.recentSentences].slice(0, 15) : history.recentSentences,
      });
    }
    const known = next.latency[ex.code] ?? { median: latencyMs, count: 0 };
    next.latency[ex.code] = { median: (known.median * known.count + latencyMs) / (known.count + 1), count: known.count + 1 };
  }
  if (result.log.kind === "review" && result.log.rating !== null) {
    next.paceReviews = [...next.paceReviews, { ok: result.log.result === "correct" || result.log.result === "near", firstTyping: result.log.firstTyping }].slice(-200);
  }
  if (result.round?.scored && !result.round.firstTyping && result.round.rating) {
    next.paceReviews = [...next.paceReviews, { ok: result.round.s >= 0.6, firstTyping: false }].slice(-200);
  }
  return next;
}

/** A session left before its end, closed as the server closes it (`closeSession`): rounds left half-way are scored or noted. */
export function closeLeft(learner: LearnerSnapshot, plan: SessionPlan, settings: Settings, at: Date, today: string): LearnerSnapshot {
  let next = learner;
  for (const outcome of closeRounds(plan, { settings, now: at, today, latency: plan.latency })) {
    if (outcome.scored) {
      const state = outcome.state;
      const isNew = !next.items.some((item) => item.itemType === state.itemType && item.itemId === state.itemId);
      next = {
        ...next,
        items: [...next.items.filter((item) => !(item.itemType === state.itemType && item.itemId === state.itemId)), state],
        today: isNew ? { ...next.today, newUnits: next.today.newUnits + 1 } : next.today,
      };
    }
    if (outcome.notebook.length) next = { ...next, notebook: applyNotebook(next.notebook, outcome.notebook, at, today, settings) };
  }
  return next;
}

/** A finished session moves the skill levels up, as `finishSession` does. */
export function finishLevels(learner: LearnerSnapshot, content: Content, settings: Settings, now: Date): LearnerSnapshot {
  const moved = levelsAfter(content, indexItems(learner.items), learner.skills, settings);
  const levelOf = (skill: SkillName) => learner.skills.find((row) => row.skill === skill)?.level ?? null;
  const texts = textLevelsAfter(content, learner.texts, levelOf, settings, now);
  const up: Partial<Record<SkillName, string | null>> = { ...moved, ...texts };
  if (!Object.values(up).some(Boolean)) return learner;
  return { ...learner, skills: learner.skills.map((skill) => ({ ...skill, level: up[skill.skill] ?? skill.level })) };
}

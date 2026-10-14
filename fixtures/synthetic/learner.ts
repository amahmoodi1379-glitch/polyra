/**
 * A learner kept in memory, for engine tests and the simulator: what the server keeps in the
 * database, changed the same way after every card.
 */
import { applyNotebook } from "../../src/engine/notebook";
import type { PlayResult } from "../../src/engine/session/play";
import type { ItemHistory, LearnerSnapshot } from "../../src/engine/state";
import type { Settings } from "../../src/engine/settings";

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
    },
    skills: [
      { skill: "vocab", level, knownBelow: opts.knownBelow ?? "A1" },
      { skill: "grammar", level, knownBelow: opts.knownBelow ?? "A1" },
    ],
    items: [],
    notebook: [],
    queue: [],
    today: { date: "", newWords: 0, wordsCapToday: null, capPromptShown: false, queueWords: 0, newUnits: 0, newConj: 0, activeSec: 0 },
    confusions: [],
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
  return { ...learner, today: { date: today, newWords: 0, wordsCapToday: null, capPromptShown: false, queueWords: 0, newUnits: 0, newConj: 0, activeSec: 0 }, touchedToday: [] };
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
        if (next.queue.some((row) => row.wordId === state.itemId)) next.today.queueWords++;
        next.queue = next.queue.filter((row) => row.wordId !== state.itemId);
        next.recentIntroWordIds = [state.itemId, ...next.recentIntroWordIds].slice(0, 20);
      } else if (state.itemType === "grammar_unit") next.today.newUnits++;
      else next.today.newConj++;
    }
    next.items = [...next.items.filter((item) => !(item.itemType === state.itemType && item.itemId === state.itemId)), state];
    if (!next.touchedToday.includes(key)) next.touchedToday = [...next.touchedToday, key];
  };
  if (result.state) upsert(result.state);
  if (result.roundState) upsert(result.roundState);
  if (result.notebook.length) next.notebook = applyNotebook(next.notebook, result.notebook, now, today, settings);
  if (result.pair) {
    const pair = result.pair;
    next.confusions = [...next.confusions.filter((item) => !(item.wordId === pair.wordId && item.otherWordId === pair.otherWordId)), pair];
  }
  const ex = result.ex;
  if (ex && result.log.kind !== "intro") {
    const history: ItemHistory = next.history.get(key) ?? { codeCounts: {}, lastCode: null, recentSentences: [] };
    next.history.set(key, {
      codeCounts: { ...history.codeCounts, [ex.code]: (history.codeCounts[ex.code] ?? 0) + 1 },
      lastCode: ex.code,
      recentSentences: ex.sentenceId ? [ex.sentenceId, ...history.recentSentences].slice(0, 15) : history.recentSentences,
    });
    if (ex.sentenceId) next.sentenceSeen.set(ex.sentenceId, (next.sentenceSeen.get(ex.sentenceId) ?? 0) + 1);
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

import { levelIndex, TRACKS, type Content, type QuestionC, type QuestionSetName, type TextC, type Track } from "./content";
import { num, type Settings } from "./settings";
import type { TextPartialE, TextStage, TextStateE } from "./state";

/**
 * Listening and reading texts (PRD §7.4, §7.5, §9.6, §10.1): which text comes next in a track, its
 * attempts and what each allows, what it costs in a session, the track's score, bar and level.
 * Pure functions over the visible content and the learner's `text_state` rows.
 */

/** Numbers fixed by PRD §7.4, §7.5 and §9.6 (DECISIONS.md: formula numbers are named, not settings). */
export const TEXT_RULE = {
  /** When no text reaches `known.threshold`, a track already started lowers it to these (§7.5). */
  relaxedShares: [0.8, 0.7],
  /** `track_score` is defined from three first rounds (§7.5). */
  minScores: 3,
  /** Level rule 2: texts of the level with a first round in the track (§7.5). */
  levelUpRest: 4,
  /** The bar is 70% texts with a first round and 30% the track score (§9.6). */
  barTexts: 0.7,
  barScore: 0.3,
  /** Plays of the whole recording: first round and attempt 2 twice, attempt 3 once (§7.4). */
  playsFirst: 2,
  playsSecond: 2,
  playsThird: 1,
  /** Timed reading of attempt 3: a minute per hundred words and twenty seconds per question (§7.4). */
  timedSecPer100Words: 60,
  timedSecPerQuestion: 20,
  /** A band 1 text has two attempts, the others three (§7.4). */
  band1Attempts: 2,
  attempts: 3,
  /** How fast the device voice reads a text without a recording, for its time in the session (DECISIONS.md). */
  deviceWordsPerSec: 2.5,
} as const;

export const otherTrack = (track: Track): Track => (track === "listening" ? "reading" : "listening");
/** A text's key in a session plan; it comes in one track only. */
export const textKey = (textId: number) => `x:${textId}`;
export const textStateKey = (textId: number, track: Track) => `${textId}:${track}`;

/** The learner's text states by `textStateKey`. */
export function indexTextStates(states: readonly TextStateE[]): Map<string, TextStateE> {
  return new Map(states.map((state) => [textStateKey(state.textId, state.track), state]));
}

// ───────────────────────────── attempts ─────────────────────────────

export type Attempt = { attempt: number; set: QuestionSetName };

/** The next attempt of a text in a track: 1 with set A, 2 with set B, 3 with set A again; none after the last (PRD §7.4, T34). */
export function nextAttempt(text: Pick<TextC, "band">, state: TextStateE | undefined): Attempt | null {
  const done = state?.attemptsDone ?? 0;
  const last = text.band === 1 ? TEXT_RULE.band1Attempts : TEXT_RULE.attempts;
  if (done >= last) return null;
  return { attempt: done + 1, set: done === 1 ? "B" : "A" };
}

/** The stages of an attempt: the first one without help, then with help; later attempts have one (PRD §7.4). */
export const stagesOf = (attempt: number): TextStage[] => (attempt === 1 ? ["first", "help"] : ["again"]);

/** What a stage allows (PRD §7.4). Null `plays`: no limit; null `timedSec`: no clock. */
export type StageRules = {
  plays: number | null;
  slow: boolean;
  /** Play one sentence at a time (listening, with help). */
  bySentence: boolean;
  /** Each sentence's Persian translation with a touch (reading, with help). */
  translations: boolean;
  /** A word's meaning with a touch (reading, with help). */
  wordTap: boolean;
  timedSec: number | null;
  /** The answers of the first round come back and can be changed. */
  revise: boolean;
};

export function stageRules(text: TextC, track: Track, attempt: number, stage: TextStage): StageRules {
  const help = stage === "help";
  const none = { slow: false, bySentence: false, translations: false, wordTap: false, timedSec: null, revise: false };
  if (track === "listening") {
    if (help) return { ...none, plays: null, slow: true, bySentence: true, revise: true };
    return { ...none, plays: attempt === 3 ? TEXT_RULE.playsThird : attempt === 2 ? TEXT_RULE.playsSecond : TEXT_RULE.playsFirst };
  }
  if (help) return { ...none, plays: null, translations: true, wordTap: true, revise: true };
  if (attempt !== 3) return { ...none, plays: null };
  const questions = text.questions[track].A.length;
  return { ...none, plays: null, timedSec: Math.round((text.wordCount / 100) * TEXT_RULE.timedSecPer100Words + questions * TEXT_RULE.timedSecPerQuestion) };
}

export const questionsOf = (text: TextC, track: Track, set: QuestionSetName): QuestionC[] => text.questions[track][set];

/** Seconds of sound: the recording, or the device voice reading it (DECISIONS.md). */
export const durationOf = (text: TextC) => text.audio?.durationSec ?? text.wordCount / TEXT_RULE.deviceWordsPerSec;

/** Time of an attempt in a session (PRD §10.1). */
export function attemptCost(text: TextC, track: Track, attempt: Attempt, settings: Settings): number {
  const questions = questionsOf(text, track, attempt.set).length;
  if (track === "listening") {
    if (attempt.attempt === 1) return durationOf(text) * num(settings, "time.listen1_audio_factor") + questions * num(settings, "time.listen1_per_question");
    const plays = num(settings, attempt.attempt === 2 ? "time.listen2_plays" : "time.listen3_plays");
    return durationOf(text) * plays + questions * num(settings, "time.listen23_per_question");
  }
  const reading = (text.wordCount / num(settings, "time.read_words_per_min")) * 60;
  if (attempt.attempt === 1) return reading * num(settings, "time.read1_factor") + questions * num(settings, "time.read1_per_question");
  return reading + questions * num(settings, "time.read23_per_question");
}

/** What is left of an attempt left half-way: its cost times the share of answers still to give (PRD §10.1, DECISIONS.md). */
export function remainingCost(text: TextC, track: Track, partial: TextPartialE, settings: Settings): number {
  const attempt = { attempt: partial.attempt, set: (partial.attempt === 2 ? "B" : "A") as QuestionSetName };
  const questions = questionsOf(text, track, attempt.set).length;
  const stages = stagesOf(partial.attempt);
  const total = questions * stages.length;
  const done = stages.indexOf(partial.stage) * questions + (partial.stage === "help" ? 0 : Object.keys(partial.answers).length);
  return total === 0 ? 0 : attemptCost(text, track, attempt, settings) * Math.max(0, 1 - done / total);
}

/** A text whose attempt is waiting: started half-way, due again, or new. */
export type TextPick = {
  text: TextC;
  track: Track;
  attempt: number;
  set: QuestionSetName;
  /** Tried in the other track first (PRD §7.5, «قرض»): its first round stays out of `track_score`. */
  borrowed: boolean;
  /** Where an attempt left half-way goes on from. */
  resume: TextPartialE | null;
};

export type TextEnv = {
  content: Content;
  settings: Settings;
  now: Date;
  /** A known word (PRD §5.7). */
  known: (wordId: number) => boolean;
  states: ReadonlyMap<string, TextStateE>;
  /** The learner's level in each track. */
  levelOf: (track: Track) => string;
};

const visible = (env: TextEnv, textId: number) => env.content.texts.find((text) => text.id === textId);
const at = (iso: string | null) => (iso ? Date.parse(iso) : null);

/** A first round, an attempt or an attempt left half-way: the learner has started the text in this track. */
export const touched = (state: TextStateE | undefined) => !!state && (state.attemptsDone > 0 || state.scores.length > 0 || state.partial !== null);
const usedInTest = (env: TextEnv, textId: number) => TRACKS.some((track) => env.states.get(textStateKey(textId, track))?.usedInTest);
const openPartial = (state: TextStateE | undefined, now: Date) => !!state?.partial && (at(state.partialUntil) ?? 0) > now.getTime();
export const wasBorrowed = (state: TextStateE | undefined) => !!state?.scores.find((score) => score.attempt === 1)?.borrowed || !!state?.partial?.borrowed;
/**
 * The other track borrowed the text: it is that track's now, and this track's attempts left are
 * dropped, so a text never comes in both tracks within `text.cross_gap_days` (PRD §16.3 rule 7).
 */
const takenOver = (env: TextEnv, textId: number, track: Track) => wasBorrowed(env.states.get(textStateKey(textId, otherTrack(track))));

/** A stage of the text finished in a session: the text is open in «متن‌های من» for good (PRD §7.9, DECISIONS.md). */
export const stageDone = (state: TextStateE | undefined) => !!state && (state.attemptsDone > 0 || state.scores.length > 0);

/**
 * An attempt of the text is still to come in a track (a first round given up included), unless the
 * other track borrowed it. In listening, «متن‌های من» then shows the words only after a full play (PRD §7.9).
 */
export function attemptLeft(text: Pick<TextC, "id" | "band">, states: ReadonlyMap<string, TextStateE>, track: Track): boolean {
  const state = states.get(textStateKey(text.id, track));
  return !!state && nextAttempt(text, state) !== null && !wasBorrowed(states.get(textStateKey(text.id, otherTrack(track))));
}

/** When the learner last worked on the text in a track. */
export function lastTouch(state: TextStateE | undefined): number | null {
  if (!state) return null;
  const times = [at(state.lastAttemptAt), ...state.scores.map((score) => at(score.at))].filter((time): time is number => time !== null);
  return times.length ? Math.max(...times) : null;
}

/** The attempt left half-way and still open (PRD §7.4: `text.resume_hours`), in one of `tracks`. */
export function partialText(env: TextEnv, tracks: readonly Track[]): TextPick | null {
  let best: { pick: TextPick; until: number } | null = null;
  for (const state of env.states.values()) {
    if (!tracks.includes(state.track) || !openPartial(state, env.now) || takenOver(env, state.textId, state.track)) continue;
    const text = visible(env, state.textId);
    const partial = state.partial!;
    if (!text || questionsOf(text, state.track, partial.attempt === 2 ? "B" : "A").length === 0) continue;
    const until = at(state.partialUntil)!;
    if (!best || until > best.until) {
      best = { pick: { text, track: state.track, attempt: partial.attempt, set: partial.attempt === 2 ? "B" : "A", borrowed: wasBorrowed(state), resume: partial }, until };
    }
  }
  return best?.pick ?? null;
}

/** Attempts 2 and 3 whose time has come, the oldest first (PRD §10.2 step 4). */
export function dueTexts(env: TextEnv, tracks: readonly Track[]): TextPick[] {
  const out: { pick: TextPick; due: number }[] = [];
  for (const state of env.states.values()) {
    if (!tracks.includes(state.track) || state.attemptsDone === 0 || openPartial(state, env.now) || takenOver(env, state.textId, state.track)) continue;
    const due = at(state.nextAttemptAt);
    if (due === null || due > env.now.getTime()) continue;
    const text = visible(env, state.textId);
    const next = text && nextAttempt(text, state);
    if (!text || !next || questionsOf(text, state.track, next.set).length === 0) continue;
    out.push({ pick: { text, track: state.track, ...next, borrowed: wasBorrowed(state), resume: null }, due });
  }
  return out.sort((a, b) => a.due - b.due || a.pick.text.id - b.pick.text.id).map((item) => item.pick);
}

const wordIdsCache = new WeakMap<TextC, (number | null)[]>();
/** The word tokens of a text, with repeats: names, numbers and other tokens do not count (PRD §5.7). */
function textWordIds(content: Content, text: TextC): (number | null)[] {
  let ids = wordIdsCache.get(text);
  if (!ids) {
    ids = text.sentenceIds.flatMap((id) => (content.sentences.get(id)?.tokens ?? []).filter((token) => token.kind === "word").map((token) => token.wordId));
    wordIdsCache.set(text, ids);
  }
  return ids;
}

/** Share of a text's words the learner knows, its key words counting as known (PRD §7.5 condition 4). */
export function textKnownShare(content: Content, text: TextC, known: (wordId: number) => boolean): number {
  const ids = textWordIds(content, text);
  if (ids.length === 0) return 1;
  const keys = new Set(text.keyWordIds);
  return ids.filter((id) => id !== null && (keys.has(id) || known(id))).length / ids.length;
}

/** The track has had a first round or an attempt: it does not close again and lowers the known share when it must (PRD §10.3). */
export const trackStarted = (states: ReadonlyMap<string, TextStateE>, track: Track) => [...states.values()].some((state) => state.track === track && touched(state));

/**
 * The text of a new attempt 1 in a track (PRD §7.5). An attempt 1 begun and given up comes back
 * first, from the start (§7.4). Otherwise texts of the learner's level that neither track has
 * touched and no test used, with `known.threshold` known words, the easiest first, or the middle
 * one for a learner whose track score reaches `text.jump_score`. Borrowing a text of the other track
 * comes only when no untouched text is left; a started track lowers the share to 80% and 70%, then
 * takes the easiest. `planned` are texts already in this session, in either track.
 */
export function newText(env: TextEnv, track: Track, planned: ReadonlySet<number>): TextPick | null {
  const { content, settings, now } = env;
  const stateOf = (text: TextC, which: Track) => env.states.get(textStateKey(text.id, which));
  const usable = (text: TextC) => questionsOf(text, track, "A").length > 0 && !planned.has(text.id) && !usedInTest(env, text.id);

  for (const text of content.texts) {
    const state = stateOf(text, track);
    if (state && state.attemptsDone === 0 && touched(state) && !openPartial(state, now) && usable(text) && !takenOver(env, text.id, track)) {
      return { text, track, attempt: 1, set: "A", borrowed: wasBorrowed(state), resume: null };
    }
  }

  const level = env.levelOf(track);
  const ofLevel = content.texts.filter((text) => text.level === level && usable(text) && !touched(stateOf(text, track)));
  const fresh = ofLevel.filter((text) => !touched(stateOf(text, otherTrack(track))));
  const gapMs = num(settings, "text.cross_gap_days") * 86_400_000;
  const pool = fresh.length
    ? fresh
    : ofLevel.filter((text) => {
        const last = lastTouch(stateOf(text, otherTrack(track)));
        return last !== null && now.getTime() - last >= gapMs && !openPartial(stateOf(text, otherTrack(track)), now);
      });
  const borrowed = fresh.length === 0;
  const pick = (text: TextC): TextPick => ({ text, track, attempt: 1, set: "A", borrowed, resume: null });

  const score = trackScore(env.states.values(), track, settings);
  const strong = score !== null && score >= num(settings, "text.jump_score");
  const started = trackStarted(env.states, track);
  for (const share of [num(settings, "known.threshold"), ...TEXT_RULE.relaxedShares]) {
    const allowed = pool.filter((text) => textKnownShare(content, text, env.known) >= share);
    if (allowed.length) return pick(strong ? allowed[Math.floor(allowed.length / 2)] : allowed[0]);
    if (!started) return null;
  }
  return pool.length ? pick(pool[0]) : null;
}

/**
 * What a track's own session would bring first (PRD §10.4): an attempt left half-way, a due attempt,
 * or a new text allowed today (within `new.text_sec_daily`, the day's first always). Null: none, and
 * the button says nothing about texts. `todaySec` is today's new text time of the track.
 */
export function textWaiting(env: TextEnv, track: Track, todaySec: number): "resume" | "due" | "new" | null {
  if (partialText(env, [track])) return "resume";
  if (dueTexts(env, [track]).length > 0) return "due";
  const pick = newText(env, track, new Set());
  if (!pick) return null;
  return withinTextTime(env.settings, todaySec, attemptCost(pick.text, track, pick, env.settings)) ? "new" : null;
}

/**
 * Today's new text time of a track (PRD §10.5) leaves room for a text of `cost` seconds. The day's
 * first new text always may come, so a text longer than the cap is not locked away (DECISIONS.md).
 */
export const withinTextTime = (settings: Settings, todaySec: number, cost: number) => todaySec === 0 || todaySec + cost <= num(settings, "new.text_sec_daily");

// ───────────────────────────── results ─────────────────────────────

/** First rounds of a track, newest first: the scores `track_score` is made of. */
function firstRounds(states: Iterable<TextStateE>, track: Track) {
  const out: { textId: number; score: number; at: number; borrowed: boolean }[] = [];
  for (const state of states) {
    if (state.track !== track) continue;
    const first = state.scores.find((score) => score.attempt === 1);
    if (first) out.push({ textId: state.textId, score: first.score, at: Date.parse(first.at), borrowed: !!first.borrowed });
  }
  return out.sort((a, b) => b.at - a.at || b.textId - a.textId);
}

/** The mean first-round score of the track's last `text.track_window` texts, borrowed ones left out; null below three (PRD §7.5, T89). */
export function trackScore(states: Iterable<TextStateE>, track: Track, settings: Settings): number | null {
  const own = firstRounds(states, track).filter((round) => !round.borrowed);
  if (own.length < TEXT_RULE.minScores) return null;
  const window = own.slice(0, num(settings, "text.track_window"));
  return window.reduce((sum, round) => sum + round.score, 0) / window.length;
}

export type TextProgress = { level: string; total: number; firstRounds: number; score: number | null; progress: number };

/** The bar of a track (PRD §9.6): texts of the level with a first round out of eight (or the level's texts), and the track score. */
export function textProgress(content: Content, states: ReadonlyMap<string, TextStateE>, track: Track, level: string, settings: Settings): TextProgress {
  const ofLevel = new Set(content.texts.filter((text) => text.level === level).map((text) => text.id));
  const rounds = firstRounds(states.values(), track).filter((round) => ofLevel.has(round.textId)).length;
  const score = trackScore(states.values(), track, settings);
  const need = Math.min(num(settings, "text.levelup_min"), ofLevel.size);
  const progress = need ? TEXT_RULE.barTexts * Math.min(rounds / need, 1) + TEXT_RULE.barScore * Math.min((score ?? 0) / num(settings, "text.levelup_score"), 1) : 0;
  return { level, total: ofLevel.size, firstRounds: rounds, score, progress };
}

/**
 * Whether a track moves up from its level (PRD §7.5, T36): eight first rounds of the level and a track
 * score of 0.8, or every text of the level touched in some track, the track's due attempts of the
 * level done and four first rounds. The next level must be open.
 */
export function textLevelUp(content: Content, states: ReadonlyMap<string, TextStateE>, track: Track, level: string, settings: Settings, now: Date): string | null {
  const next = content.levels[levelIndex(content, level) + 1];
  if (!next || !content.openLevels.includes(next)) return null;
  const ofLevel = content.texts.filter((text) => text.level === level);
  const ids = new Set(ofLevel.map((text) => text.id));
  const rounds = firstRounds(states.values(), track).filter((round) => ids.has(round.textId)).length;
  const score = trackScore(states.values(), track, settings);
  if (rounds >= num(settings, "text.levelup_min") && score !== null && score >= num(settings, "text.levelup_score")) return next;
  const untouched = ofLevel.some((text) => TRACKS.every((which) => !touched(states.get(textStateKey(text.id, which)))));
  const dueLeft = ofLevel.some((text) => {
    const state = states.get(textStateKey(text.id, track));
    const due = at(state?.nextAttemptAt ?? null);
    return !!state && nextAttempt(text, state) !== null && state.attemptsDone > 0 && due !== null && due <= now.getTime();
  });
  return !untouched && !dueLeft && rounds >= TEXT_RULE.levelUpRest ? next : null;
}

/** The new level of each text track after a session, or null where it stays (PRD §7.5). */
export function textLevelsAfter(content: Content, states: readonly TextStateE[], levelOf: (track: Track) => string | null, settings: Settings, now: Date): Record<Track, string | null> {
  const index = indexTextStates(states);
  const up = (track: Track) => {
    const level = levelOf(track);
    return level ? textLevelUp(content, index, track, level, settings, now) : null;
  };
  return { listening: up("listening"), reading: up("reading") };
}

// ───────────────────────────── writing a stage ─────────────────────────────

/**
 * The text's state after one stage (PRD §7.4): the first round sets `first_score` once and waits for
 * the round with help (kept as a half-way attempt), the round with help finishes attempt 1, attempts
 * 2 and 3 finish themselves. The next attempt comes `text.gap2_days` and `text.gap3_days` later.
 */
export function afterStage(
  before: TextStateE | null,
  done: { text: Pick<TextC, "id" | "band">; track: Track; attempt: number; stage: TextStage; set: QuestionSetName; borrowed: boolean; score: number; answers: Record<string, unknown> },
  now: Date,
  settings: Settings,
): TextStateE {
  const state: TextStateE = before ?? {
    textId: done.text.id,
    track: done.track,
    attemptsDone: 0,
    firstScore: null,
    scores: [],
    lastAttemptAt: null,
    nextAttemptAt: null,
    partial: null,
    partialUntil: null,
    usedInTest: false,
  };
  const iso = now.toISOString();
  const day = 86_400_000;
  if (done.stage === "first") {
    return {
      ...state,
      firstScore: state.firstScore ?? done.score,
      scores: [...state.scores, { attempt: 1, set: done.set, score: done.score, at: iso, ...(done.borrowed ? { borrowed: true } : {}) }],
      partial: { attempt: 1, stage: "help", answers: done.answers, plays: 0, positionMs: 0, ...(done.borrowed ? { borrowed: true } : {}) },
      partialUntil: new Date(now.getTime() + num(settings, "text.resume_hours") * 3_600_000).toISOString(),
    };
  }
  const attemptsDone = Math.max(state.attemptsDone, done.attempt);
  const scores = done.stage === "again" ? [...state.scores, { attempt: done.attempt, set: done.set, score: done.score, at: iso }] : state.scores;
  const finished = nextAttempt(done.text, { ...state, attemptsDone }) === null;
  const gap = num(settings, attemptsDone === 1 ? "text.gap2_days" : "text.gap3_days") * day;
  return {
    ...state,
    attemptsDone,
    scores,
    lastAttemptAt: iso,
    nextAttemptAt: finished ? null : new Date(now.getTime() + gap).toISOString(),
    partial: null,
    partialUntil: null,
  };
}

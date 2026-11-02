import type { FsrsCard } from "./fsrs";
import type { SampleState } from "./placement";

/**
 * The learner's state as the engine sees it (PRD §4.2). The server loads it from the database and
 * writes back whatever the engine returns. Dates are ISO strings so the same shape travels to the
 * browser; calendar days are Tehran dates as YYYY-MM-DD.
 */

export type ItemType = "word" | "grammar_unit" | "conjugation";
export type ItemSource = "normal" | "tap" | "key_word" | "colloquial" | "i_know" | "pretest" | "placement";

export type ItemStateE = {
  itemType: ItemType;
  itemId: number;
  step: number;
  fsrs: FsrsCard;
  probation: "none" | "single" | "sample";
  source: ItemSource;
  introducedAt: string | null;
  firstReviewDone: boolean;
  typedOnce: boolean;
  deferredUntil: string | null;
  nearStreak: number;
  failCount: number;
  roundsCount: number;
};

export type NotebookRef = "word" | "word_gender" | "conjugation" | "grammar_target";

export type NotebookE = {
  refType: NotebookRef;
  refId: number;
  addedAt: string;
  until: string;
  correctCount: number;
  lastCorrectDate: string | null;
};

export type QueueE = { wordId: number; source: "tap" | "key_word" | "colloquial"; addedAt: string };

export type DailyE = {
  date: string;
  newWords: number;
  wordsCapToday: number | null;
  capPromptShown: boolean;
  queueWords: number;
  newUnits: number;
  newConj: number;
  activeSec: number;
  /** Seconds of new text today in each track (PRD §10.5) and whether a text session was built (§10.11). */
  newTextSec: { listening: number; reading: number };
  textSessionDone: boolean;
};

export type SkillName = "vocab" | "grammar" | "listening" | "reading";
export type SkillLevelE = { skill: SkillName; level: string; knownBelow: string | null };

/** A bank sentence's listening drill (PRD §7.6, `sentence_drill_state`). */
export type DrillStateE = { sentenceId: number; count: number; lastAt: string | null };

/** The three attempts of a text in one track (PRD §7.4) and the stage of each: attempt 1 is a first round without help, then with help. */
export type TextStage = "first" | "help" | "again";

/** One scored round of a text: the first round of attempt 1, or attempt 2 or 3. A borrowed text's first round is not in `track_score` (PRD §7.5). */
export type TextScoreE = { attempt: number; set: "A" | "B"; score: number; at: string; borrowed?: boolean };

/**
 * An attempt left half-way (PRD §7.4, `text_state.partial`): where it was, the answers given and the
 * plays used. `borrowed` keeps a borrowed text's mark before its first round has a score (PRD §7.5).
 */
export type TextPartialE = { attempt: number; stage: TextStage; answers: Record<string, unknown>; plays: number; positionMs: number; borrowed?: boolean };

/** A text in one track (PRD §4.2, `text_state`). */
export type TextStateE = {
  textId: number;
  track: "listening" | "reading";
  attemptsDone: number;
  firstScore: number | null;
  scores: TextScoreE[];
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  partial: TextPartialE | null;
  partialUntil: string | null;
  usedInTest: boolean;
};

/**
 * A phonics lesson (PRD §8.3, `phonics_state`): rounds finished (1 after round 1, 2 after round 2, 3
 * after its one repeat), the last round's score, when the next round may come and whether the lesson is over.
 */
export type PhonicsStateE = { lessonId: number; roundsDone: number; lastScore: number | null; nextAt: string | null; done: boolean };

/** «بگو، بعد بشنو» of one sentence (PRD §8b.2, `speak_state`): showings, «درست گفتم»s, the last rating and when it may come again. */
export type SpeakRating = "ok" | "near" | "no";
export type SpeakStateE = { sentenceId: number; count: number; correctCount: number; lastRating: SpeakRating | null; nextAt: string | null };

/** A situational dialogue's two attempts (PRD §8b.4, `dialogue_state`): each attempt's share of turns right at the first choice. */
export type DialogueStateE = { dialogueId: number; attemptsDone: number; scores: number[]; nextAttemptAt: string | null };

/** One find-the-mistake attempt (PRD §8b.5): mistakes fixed of all, words changed that were right, and the result. */
export type ErrorfixResultE = { fixed: number; of: number; wrongTaps: number; ok: boolean };
export type ErrorfixStateE = { itemId: number; attemptsDone: number; results: ErrorfixResultE[]; nextAttemptAt: string | null };

export type ConfusionE = { wordId: number; otherWordId: number; count: number; lastAt: string; cardShownAt: string | null };

export type EnrollmentE = {
  language: string;
  startMode: "zero" | "placement" | null;
  paceMode: "normal" | "slow";
  lastSpreadDate: string | null;
  /** A round of phonics in every mixed and vocabulary session (PRD §8.4). */
  phonicsAuto: boolean;
  /** «بعداً» pressed on the phonics round in a row (PRD §8.4). */
  phonicsSkips: number;
  streakCount: number;
  streakLastDate: string | null;
  streakForgivenWeek: string | null;
  /** Forgiveness days used in `streakForgivenWeek` (`streak.forgive_per_week` may be more than one). */
  streakForgivenCount: number;
  freezeCount: number;
  freezeCheckedWeek: string | null;
  /** The day «بعداً» was pressed on the text session prompt (PRD §10.11). */
  textPromptDate: string | null;
};

/** What happened to one item before, for exercise choice (PRD §9.3) and sentence choice (§5.7, §6.5). */
export type ItemHistory = {
  /** How many times each exercise code was used for this item. */
  codeCounts: Record<string, number>;
  /** The code of the item's last exposure. */
  lastCode: string | null;
  /** Sentence ids of the item's last exposures, newest first (words: last 5; units: last 3 rounds). */
  recentSentences: number[];
};

export type LearnerSnapshot = {
  userId: number;
  sessionLength: number;
  enrollment: EnrollmentE;
  skills: SkillLevelE[];
  items: ItemStateE[];
  notebook: NotebookE[];
  queue: QueueE[];
  today: DailyE;
  confusions: ConfusionE[];
  /** Sentences drilled before (PRD §7.6). */
  drills: DrillStateE[];
  /** Texts in each track (PRD §7.4). */
  texts: TextStateE[];
  /** Phonics lessons started (PRD §8.3). */
  phonics: PhonicsStateE[];
  /** Speaking and writing (PRD §8b): sentences said, dialogues and find-the-mistake texts tried. */
  speaks: SpeakStateE[];
  dialogues: DialogueStateE[];
  errorfixes: ErrorfixStateE[];
  /** Finished mixed sessions in a row, newest first, without a text attempt (PRD §10.11 condition 3). */
  mixedWithoutText: number;
  history: Map<string, ItemHistory>;
  /** How often the learner has seen each sentence in any exercise. */
  sentenceSeen: Map<number, number>;
  /** Median answer time per exercise code and how many answers it is based on (PRD §9.2, "سریع"). */
  latency: Record<string, { median: number; count: number }>;
  /** Scored reviews of the pace window (PRD §9.10). */
  paceReviews: { ok: boolean; firstTyping: boolean }[];
  /** Words introduced most recently, newest first, for the family gap (PRD §5.8). */
  recentIntroWordIds: number[];
  /** Items introduced or reviewed today, for «تمرین بیشتر» (PRD §10.8). */
  touchedToday: string[];
  /** The typed sample after placement (PRD §11.4), while a placement run has one. */
  sample?: SampleState | null;
};

export const itemKey = (type: ItemType, id: number) => `${type === "word" ? "w" : type === "grammar_unit" ? "u" : "c"}:${id}`;

const KEY_TYPES: Record<string, ItemType> = { w: "word", u: "grammar_unit", c: "conjugation" };

/** The plan key of a grammar sample sentence (PRD §11.4): a target asked with no card. */
export const sampleKey = (targetId: number) => `g:${targetId}`;

/** A plan key of an item with a card (`w:`, `u:`, `c:`); other keys are a grammar target (`t:`) or a drilled sentence (`l:`). */
export const isItemKey = (key: string) => key.split(":")[0] in KEY_TYPES;

export function parseItemKey(key: string): { type: ItemType; id: number } {
  const [prefix, id] = key.split(":");
  const type = KEY_TYPES[prefix];
  if (!type) throw new Error(`${key} is not the key of an item with a card`);
  return { type, id: Number(id) };
}

import type { FsrsCard } from "./fsrs";

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
  frozen: boolean;
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
};

export type SkillName = "vocab" | "grammar" | "listening" | "reading";
export type SkillLevelE = { skill: SkillName; level: string; knownBelow: string | null };

export type ConfusionE = { wordId: number; otherWordId: number; count: number; lastAt: string; cardShownAt: string | null };

export type EnrollmentE = {
  language: string;
  startMode: "zero" | "placement" | null;
  paceMode: "normal" | "slow";
  lastSpreadDate: string | null;
  phonicsAuto: boolean;
  streakCount: number;
  streakLastDate: string | null;
  streakForgivenWeek: string | null;
  /** Forgiveness days used in `streakForgivenWeek` (`streak.forgive_per_week` may be more than one). */
  streakForgivenCount: number;
  freezeCount: number;
  freezeCheckedWeek: string | null;
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
};

export const itemKey = (type: ItemType, id: number) => `${type === "word" ? "w" : type === "grammar_unit" ? "u" : "c"}:${id}`;

export function parseItemKey(key: string): { type: ItemType; id: number } {
  const [prefix, id] = key.split(":");
  const type: ItemType = prefix === "w" ? "word" : prefix === "u" ? "grammar_unit" : "conjugation";
  return { type, id: Number(id) };
}

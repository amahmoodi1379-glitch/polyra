import type { Speak } from "../content";
import type { Ex, SentenceView, WordView } from "../ex";
import type { RoundAnswer } from "../answer";
import type { ConfusionE, ItemStateE, NotebookRef } from "../state";

/**
 * The saved session (`session.plan`, PRD §10.7 "بسته جلسه"). The server builds it once; the browser
 * and the server then change it with the same function (`advance`) after every answer, so both
 * always agree on what comes next. Every card the learner finishes is one numbered event (`seq`).
 */

export type Scope = "mixed" | "quick" | "vocab" | "grammar" | "notebook" | "extra";

export type CardKind =
  /** Intro card of a new word (step 0), or the same card shown again. */
  | "intro"
  /** One scored or practice exercise of a word or a conjugation card, or a notebook sentence. */
  | "ex"
  /** Grammar lesson (step 0 of a unit). */
  | "lesson"
  /** One of the three two-option warm-ups after a new lesson. */
  | "g0"
  /** One question of a grammar round. */
  | "round"
  /** A new conjugation card: the whole table with sound (PRD §6.6). */
  | "table"
  /** «این دو را قاطی می‌کنی» (PRD §9.9). */
  | "confusion";

export type PlayKind = "review" | "followup" | "practice";

export type Card = {
  id: string;
  t: CardKind;
  /** Item key (`w:12`, `u:3`, `c:5`); a confusion card names its first word. */
  item: string;
  kind?: PlayKind;
  ex?: Ex;
  /** The same exercise without sound, for «الان نمی‌توانم گوش بدهم» (PRD §10.12). */
  alt?: Ex | null;
  /** Cards of one block stay together: a round, a new unit, a new word with its first exercise. */
  block?: string;
  /** The notebook entry a practice card serves (PRD §9.5). */
  note?: { refType: NotebookRef; refId: number };
  /** Why an intro card comes again. */
  reason?: "again" | "leech";
  pair?: [number, number];
  /** New material not started yet; the low-accuracy rule may drop it (PRD §9.10). */
  fresh?: boolean;
  /** Round questions: the step of the round. */
  step?: number;
  /** The last card of a round: the round is scored after it. */
  roundEnd?: boolean;
};

/** Exercises made in advance for one single-exercise item (PRD §10.7). */
export type PlanItem = {
  key: string;
  /** The item was new when the session was built. */
  isNew: boolean;
  last: number;
  followup: Ex | null;
  followupAlt: Ex | null;
  /** Followup on the last step: a form exercise of that step (PRD §9.3). */
  followupForm: Ex | null;
  followupFormAlt: Ex | null;
  /** Practice after a wrong answer, one step lower; up to two of them. */
  fallback: Ex[];
  fallbackAlt: (Ex | null)[];
  /** W2d after a wrong gender. */
  gender: Ex | null;
};

export type WordCard = {
  word: WordView;
  example: SentenceView | null;
  /** «این کلمه را با معنی … می‌شناسی» for a new sense (PRD §5.2). */
  knownMeaning: string | null;
  collocations: { text: string; translation_fa: string }[];
  /** Conjugation tables of a verb, for the «صرف» link. */
  tables: TableView[];
};

export type TableView = { id: number; verb: string; tense: string; rows: { pronoun: string; form: string }[]; speak: Speak | null };

export type LessonView = {
  unitId: number;
  title: string;
  lesson: string;
  buildTable: string[][] | null;
  examples: SentenceView[];
  ruleLine: string;
  commonMistake: string | null;
  canDo: string | null;
};

export type Counters = {
  /** Scored answers (review and followup) and how many were right or nearly right (PRD §9.10). */
  answered: number;
  ok: number;
  /** Wrong or «نمی‌دانم» answers in a row (PRD §9.10, rescue). */
  wrongStreak: number;
  /** Rescue waiting for the end of the current round (DECISIONS.md). */
  rescuePending: boolean;
  /** Practice cards added per item (PRD §9.2, `practice.max_per_item`). */
  practice: Record<string, number>;
  correct: number;
  wrong: number;
};

export type SessionPlan = {
  version: 1;
  scope: Scope;
  budgetSec: number;
  noAudio: boolean;
  /** Seed for every random choice made after the build. */
  seed: string;
  queue: Card[];
  /** How many cards were finished. */
  doneCount: number;
  /** Total cards planned at the start, for the progress bar. */
  plannedCount: number;
  nextCard: number;
  items: Record<string, PlanItem>;
  /** Item states at the start, for the browser to run the same rules (PRD §15.4). */
  states: Record<string, ItemStateE | null>;
  words: Record<number, WordCard>;
  lessons: Record<number, LessonView>;
  tables: Record<number, TableView>;
  /** The learner's confusion pairs with the plan's words, kept up to date during the session (PRD §9.9). */
  pairs: ConfusionE[];
  /** Pairs that existed when the session was built, as "a:b": only these can show their card (PRD §10.7). */
  pairsAtStart: string[];
  /** Answers of each round so far, by block. */
  rounds: Record<string, { item: string; step: number; last: number; answers: RoundAnswer[] }>;
  counters: Counters;
  /** What the end screen and the start button show (PRD §3.2, §3.9). */
  summary: { reviews: number; newItems: number; newWords: number; newUnits: number; newConj: number };
};

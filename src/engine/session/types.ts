import type { QuestionC, QuestionSetName, Speak, Track } from "../content";
import type { Ex, Gloss, SentenceView, WordView } from "../ex";
import type { RoundAnswer } from "../answer";
import type { ConfusionE, ItemStateE, NotebookRef, TextPartialE, TextStage, TextStateE } from "../state";
import type { StageRules } from "../texts";

/**
 * The saved session (`session.plan`, PRD §10.7 "بسته جلسه"). The server builds it once; the browser
 * and the server then change it with the same function (`advance`) after every answer, so both
 * always agree on what comes next. Every card the learner finishes is one numbered event (`seq`).
 */

export const SCOPES = ["mixed", "quick", "vocab", "grammar", "listening", "reading", "notebook", "extra"] as const;
export type Scope = (typeof SCOPES)[number];

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
  | "confusion"
  /** A sentence heard alone (L1–L3, PRD §7.6); its item is `l:<sentence id>`. */
  | "drill"
  /** «کلمه‌های این متن» before a text's first attempt (PRD §7.5); its item is `x:<text id>`. */
  | "textwords"
  /** One stage of a text attempt: all its questions on one screen (PRD §7.4). */
  | "text";

/** A text stage card: which attempt and stage, what it allows, and where a half-way attempt goes on (PRD §7.4). */
export type TextCard = {
  textId: number;
  track: Track;
  attempt: number;
  stage: TextStage;
  set: QuestionSetName;
  borrowed: boolean;
  rules: StageRules;
  /** The whole attempt's time, added to today's new text time after the first round of attempt 1 (PRD §10.5). */
  cost: number;
  /** Answers, plays and the place in the sound an attempt left half-way goes on from (T91). */
  resume: TextPartialE | null;
};

/** A text as its screens show it (PRD §7.4, §7.9): sentences with translation, glosses and speaker, its sound and the questions of its track. */
export type TextView = {
  id: number;
  title: string;
  level: string;
  band: number;
  track: Track;
  sentences: { id: number; text: string; translation: string; glosses: Gloss[]; speak: Speak; speaker: string | null }[];
  audio: { url: string; offsetsMs: number[]; durationSec: number } | null;
  wordCount: number;
  questions: Record<QuestionSetName, QuestionC[]>;
};

export type PlayKind = "review" | "followup" | "practice";

export type Card = {
  id: string;
  t: CardKind;
  /** Item key (`w:12`, `u:3`, `c:5`, a notebook target `t:7`, a drilled sentence `l:9`); a confusion card names its first word. */
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
  /** A text stage. */
  text?: TextCard;
  /** «کلمه‌های این متن»: the key words to show. */
  words?: number[];
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
  /** A new word taken from `new_word_queue`: it counts in today's `queue_words` (PRD §5.8). */
  queued?: boolean;
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
  /** Right (or nearly right) and wrong answers for the end screen; «نمی‌دانم» is neither. */
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
  texts: Record<number, TextView>;
  /** Text states at the start (`x:<id>`), kept up to date after each stage like `states`. */
  textStates: Record<string, TextStateE | null>;
  /** The learner's confusion pairs with the plan's words, kept up to date during the session (PRD §9.9). */
  pairs: ConfusionE[];
  /** Pairs that existed when the session was built, as "a:b": only these can show their card (PRD §10.7). */
  pairsAtStart: string[];
  /** The learner's answer times at the build, so both sides judge «fast» the same way (PRD §9.2). */
  latency: Record<string, { median: number; count: number }>;
  /** Answers of each round so far, by block. */
  rounds: Record<string, { item: string; step: number; last: number; answers: RoundAnswer[] }>;
  counters: Counters;
  /** What the end screen and the start button show (PRD §3.2, §3.9); sentence drills count as reviews (DECISIONS.md). */
  summary: { reviews: number; newItems: number; newWords: number; newUnits: number; newConj: number; newTexts: number; resumeText: boolean };
};

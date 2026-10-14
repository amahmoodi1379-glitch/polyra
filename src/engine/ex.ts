import type { Gender, Pos, Speak } from "./content";

/**
 * One exercise, fully built by the server when the session is made (PRD §10.7, "بسته جلسه"): what
 * the screen shows (`q`) and how the answer is graded (`a`). The browser grades with the same data
 * and the server grades again from the copy saved in `session.plan` (PRD §15.4).
 */

export type WordView = {
  id: number;
  lemma: string;
  /** The word as shown: a noun with its article (PRD §5.1). */
  display: string;
  article: string | null;
  gender: Gender | null;
  pos: Pos;
  meaning: string;
  meanings: string[];
  plural: string | null;
  image: string | null;
  noteFa: string | null;
  colloquial: boolean;
  speak: Speak;
};

/** A word the learner can touch in a sentence to see its meaning (PRD §5.9). */
export type Gloss = { start: number; end: number; kind: "word" | "name" | "number" | "other"; wordId: number | null; meaning: string | null };

export type Segment = { t: "text"; s: string } | { t: "blank"; i: number; first?: string; size: number };

export type SentenceView = {
  id: number;
  /** The whole correct sentence. */
  text: string;
  segments: Segment[];
  translation: string | null;
  glosses: Gloss[];
  speak: Speak;
};

export type Choice = { id: string; text: string; lang: "fa" | "target"; wordId?: number | null; image?: string | null };

export type Question = {
  word?: WordView;
  meaning?: string;
  image?: string;
  /** A noun without its article (W2d, W4c). */
  lemma?: string;
  sentence?: SentenceView;
  translation?: string;
  hint?: string;
  /** W4a: the letters, shuffled. */
  letters?: string[];
  /** W4b: the word with hidden letters as null. */
  pattern?: (string | null)[];
  /** G6: what to do and the sentence to change. */
  instruction?: string;
  source?: string;
  /** G6b: the Persian sentence to translate. */
  promptFa?: string;
  /** Conjugation: the verb, the tense and the pronoun or table rows. */
  verb?: string;
  tense?: string;
  pronoun?: string;
  rows?: { pronoun: string; given: string | null }[];
  /** G3a: the category names. */
  sets?: string[];
  /** K1, K2: the standard word whose colloquial twin is asked. */
  standard?: string;
};

export type AnswerSpec =
  | { kind: "choice"; options: Choice[]; correct: string }
  | { kind: "choice2"; groups: [Choice[], Choice[]]; correct: [string, string] }
  /** G2a: tap the wrong part of the sentence. */
  | { kind: "spot"; parts: { id: string; text: string }[]; correct: string }
  | {
      kind: "type";
      accepted: string[];
      multi: boolean;
      /** A whole sentence or phrase: German ignores the case of its first letter (PRD §5.6). */
      sentence: boolean;
      /** Gender buttons after the word, for a noun (PRD §3.5). */
      gender: { buttons: string[]; correct: string } | null;
      /** A noun typed with its article is compared without it. */
      noun: boolean;
      /** Lemmas that count as "a synonym, try again" (PRD §5.6). */
      synonyms: string[];
      /** First letter for the synonym retry message. */
      first: string;
      /** G6: the sentence before the change, for the one-typo rule (PRD §6.5). */
      transformSource: string | null;
    }
  /** W4b: the hidden letters, in order. */
  | { kind: "letters"; word: string; hidden: number[] }
  | { kind: "tiles"; tiles: string[]; orders: string[][] }
  /** W3d: five words and five meanings; only the target pair is scored. */
  | { kind: "pairs"; left: Choice[]; right: Choice[]; pairs: Record<string, string>; target: string }
  /** G3a: each item belongs to one category. */
  | { kind: "sort"; items: { id: string; text: string; set: number }[] }
  /** C2 (fill from a bank) and C4 (type every row): null accepted means the row is given. */
  | { kind: "table"; rows: { pronoun: string; accepted: string[] | null }[]; bank: string[] | null };

export type Ex = {
  id: string;
  code: string;
  item: string;
  step: number;
  /** Estimated seconds (PRD §10.1). */
  time: number;
  typed: boolean;
  recall: boolean;
  idk: boolean;
  /** The exercise cannot be answered without sound. */
  audio: boolean;
  sentenceId: number | null;
  targetId: number | null;
  /** Played when the exercise appears (listening exercises). */
  listen: Speak | null;
  /** Played on the feedback screen (PRD §3.5). */
  after: Speak | null;
  q: Question;
  a: AnswerSpec;
};

/** What the browser sends for one answer. */
export type RawAnswer =
  | { idk: true }
  | { choice: string }
  | { choices: [string, string] }
  | { text: string; gender?: string | null; retry?: boolean }
  | { letters: string[] }
  | { tiles: string[] }
  /** W3d: the meaning first joined to the target word. */
  | { firstPair: string }
  /** G3a: the category each item was first dropped on. */
  | { firstSort: Record<string, number> }
  | { rows: string[] }
  /** Cards without a score: intro card, lesson, «این دو را قاطی می‌کنی». */
  | { seen: true };

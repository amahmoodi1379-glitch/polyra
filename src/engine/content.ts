import type { Lang } from "./text";

/**
 * What the engine knows about the content of one language: only what the learner may see
 * (PRD §4.1, published or for testers approved), already loaded by the server. Nothing here reads
 * the database.
 */

export type Gender = "m" | "f" | "mf" | "der" | "die" | "das";
export type Pos = "noun" | "verb" | "adj" | "adv" | "prep" | "pron" | "det" | "conj" | "num" | "interj" | "phrase";

/** Text the device voice reads, or a teacher's file that replaces it (DECISIONS.md, device voice). */
export type Speak = { text: string; lang: Lang; url: string | null };

export type WordC = {
  id: number;
  code: string;
  lemma: string;
  pos: Pos;
  gender: Gender | null;
  number: "sg" | "pl_only" | null;
  plural: string | null;
  register: "standard" | "familier" | "argot" | "formal";
  conceptId: number | null;
  /** The Persian equivalents, the first one is the main meaning. */
  meanings: string[];
  level: string;
  introOrder: number;
  noCard: boolean;
  mastery: "produce" | "recognize";
  /** Code of the base word when this entry is a new sense of it. */
  senseOf: string | null;
  /** Codes of a phrase's parts. */
  parts: string[];
  homophones: string[];
  image: string | null;
  noteFa: string | null;
  family: string | null;
  collocations: { text: string; translation_fa: string }[];
  /** What the voice says: a noun with its article (DECISIONS.md). */
  speak: Speak;
};

export type TokenC = {
  kind: "word" | "name" | "number" | "other";
  wordId: number | null;
  surface: string;
  spans: [number, number][];
  meaningCtx: string | null;
};

export type SentenceC = {
  id: number;
  text: string;
  translationFa: string;
  level: string | null;
  speak: Speak;
  tokens: TokenC[];
  /** Part of the vocabulary and grammar bank, not of a text or a dialogue (PRD §5.7). */
  bank: boolean;
  /** A sentence of a listening or reading text: never said aloud in «بگو، بعد بشنو» (PRD §8b.2). */
  inText?: boolean;
};

/** One blank's answers: a single blank holds strings, two blanks hold one list per blank. */
export type TargetC = {
  id: number;
  sentenceId: number;
  type: "word" | "grammar";
  targetId: number;
  markedText: string;
  blanks: 1 | 2;
  accepted: string[] | string[][];
  distractors: string[] | string[][];
  hint: string | null;
  acceptedFull: string[] | null;
};

export type UnitC = {
  id: number;
  unitCode: string;
  orderNo: number;
  titleFa: string;
  level: string;
  lessonFa: string;
  buildTable: string[][] | null;
  exampleSentenceIds: number[];
  ruleLineFa: string;
  commonMistakeFa: string | null;
  canDoFa: string | null;
  categorySets: { name: string; items: string[] }[] | null;
};

export type TransformC = { id: number; unitId: number; instructionFa: string; source: string; outputs: string[] };
export type TranslateC = { id: number; unitId: number; promptFa: string; outputs: string[] };

export type ConjC = {
  id: number;
  wordId: number;
  tense: string;
  unitCode: string | null;
  /** Pronoun key to form, in the language's pronoun order. */
  forms: Record<string, string>;
  variants: Record<string, string[]>;
  reviewCard: boolean;
};

/** The two tracks a text can come in (PRD §7): each text comes to a learner in one of them only. */
export type Track = "listening" | "reading";
export const TRACKS: readonly Track[] = ["listening", "reading"];
export type QuestionSetName = "A" | "B";

type QuestionBase = {
  id: number;
  /** Empty for a dictation, which has no question text. */
  prompt: string;
  /** The Persian translation of a band 3 or 4 question, opened on request (PRD §7.3). */
  promptFa: string | null;
  explanationFa: string | null;
};

/** One question of a text (PRD §7.3, §14.3); indexes start at 0. */
export type QuestionC = QuestionBase &
  (
    | { type: "mcq"; options: string[]; correct: number }
    | { type: "tf"; correct: boolean }
    | { type: "order"; items: string[]; correctOrder: number[] }
    | { type: "match"; left: string[]; right: string[]; pairs: [number, number][] }
    | { type: "cloze"; textWithGaps: string; bank: string[]; answers: string[] }
    | { type: "find"; correctSentence: number }
    | { type: "ctx"; word: string; options: string[]; correct: number }
    | { type: "num"; answer: string; accepted: string[] }
    | { type: "dict"; sentence: number }
  );
export type QuestionType = QuestionC["type"];

/** A listening or reading text (PRD §7.2). Its sentences are in `Content.sentences`, out of the bank. */
export type TextC = {
  id: number;
  code: string;
  level: string;
  band: number;
  kind: string;
  title: string;
  sentenceIds: number[];
  /** The speaker of each sentence of a dialogue. */
  speakers: (string | null)[] | null;
  /** The whole recording and where each sentence starts in it; without it the device voice reads the sentences one by one. */
  audio: { url: string; offsetsMs: number[]; durationSec: number } | null;
  wordCount: number;
  /** Up to five key words, shown before the first attempt when the learner does not know them (PRD §7.5). */
  keyWordIds: number[];
  placementOk: boolean;
  difficulty: number;
  orderOverride: number | null;
  questions: Record<Track, Record<QuestionSetName, QuestionC[]>>;
};

/** What a phonics lesson says aloud (PRD §8.1): an example word, one side of a minimal pair or a liaison sentence. */
export type PhonicsSound = { text: string; meaningFa: string | null; speak: Speak };
export type PhonicsKind = "contrast" | "rule" | "liaison";

/** A phonics lesson (PRD §8.1). It has no FSRS card: two fixed rounds (§8.3). */
export type PhonicsC = {
  id: number;
  orderNo: number;
  kind: PhonicsKind;
  /** The lesson's name, such as «u فرانسوی». */
  label: string;
  graphemes: string[];
  tipFa: string;
  /** Example words, each with exactly two wrong spellings a Persian speaker might write on hearing it (P1). */
  words: (PhonicsSound & { wrong: string[] })[];
  /** Minimal pairs: `a` has the lesson's sound, `b` the similar one (P2–P4). */
  pairs: { a: PhonicsSound; b: PhonicsSound }[];
  /** Liaison sentences with the indexes of the words a liaison follows (P5). */
  sentences: (PhonicsSound & { liaisonAfter: number[] })[];
};

/** A situational dialogue (PRD §8b.4): every line and choice is a sentence of `Content.sentences`. */
export type DialogueC = {
  id: number;
  code: string;
  level: string;
  titleFa: string;
  situationFa: string;
  turns: { sentenceId: number; speaker: string | null; choices: number[]; correct: number; whyFa: string }[];
};

/** A find-the-mistake text (PRD §8b.5): `{{wrong|right}}` marks, one explanation each, and the words of the corrected text. */
export type ErrorfixC = {
  id: number;
  level: string;
  markedText: string;
  translationFa: string;
  unitCodes: string[];
  whyFa: string[];
  /** The word id of every word token of the corrected text (none is null: an unresolved one leaves the item out). */
  wordIds: number[];
};

export type Content = {
  language: Lang;
  /** The language's levels from lowest to highest (app_setting levels.xx). */
  levels: string[];
  /** Levels the learner may get new material from (released, or every level for a tester). */
  openLevels: string[];
  words: Map<number, WordC>;
  sentences: Map<number, SentenceC>;
  targets: Map<number, TargetC>;
  units: UnitC[];
  transforms: TransformC[];
  translates: TranslateC[];
  conjugations: ConjC[];
  /** Texts, easiest first within each level (PRD §7.5: `order_override`, else `difficulty_score`). */
  texts: TextC[];
  /** Phonics lessons in the teacher's order (PRD §8.1, §13.6). */
  phonics: PhonicsC[];
  /** Situational dialogues and find-the-mistake texts of open levels (PRD §8b.4, §8b.5). */
  dialogues: DialogueC[];
  errorfixes: ErrorfixC[];
  // Indexes the loader fills once.
  wordByCode: Map<string, WordC>;
  /** Word targets of each word, grammar targets of each unit. */
  wordTargets: Map<number, TargetC[]>;
  unitTargets: Map<number, TargetC[]>;
  /** Bank sentences each word appears in (from sentence_word). */
  wordSentences: Map<number, number[]>;
  /** Lower-case lemma to the word ids with it, for confusion and synonyms (PRD §5.6, §9.9). */
  lemmaIndex: Map<string, number[]>;
};

export const PRONOUNS: Record<Lang, { key: string; label: string }[]> = {
  fr: [
    { key: "je", label: "je" },
    { key: "tu", label: "tu" },
    { key: "il_elle_on", label: "il/elle/on" },
    { key: "nous", label: "nous" },
    { key: "vous", label: "vous" },
    { key: "ils_elles", label: "ils/elles" },
  ],
  de: [
    { key: "ich", label: "ich" },
    { key: "du", label: "du" },
    { key: "er_sie_es", label: "er/sie/es" },
    { key: "wir", label: "wir" },
    { key: "ihr", label: "ihr" },
    { key: "sie_Sie", label: "sie/Sie" },
  ],
};

/** Builds the indexes of a content snapshot from its lists. */
type Indexes = "wordByCode" | "wordTargets" | "unitTargets" | "wordSentences" | "lemmaIndex";
export function indexContent(input: Omit<Content, Indexes | "dialogues" | "errorfixes"> & Partial<Pick<Content, "dialogues" | "errorfixes">>): Content {
  const base = { ...input, dialogues: input.dialogues ?? [], errorfixes: input.errorfixes ?? [] };
  const wordByCode = new Map<string, WordC>();
  const lemmaIndex = new Map<string, number[]>();
  for (const word of base.words.values()) {
    wordByCode.set(word.code, word);
    const key = word.lemma.toLowerCase();
    lemmaIndex.set(key, [...(lemmaIndex.get(key) ?? []), word.id]);
  }
  const wordTargets = new Map<number, TargetC[]>();
  const unitTargets = new Map<number, TargetC[]>();
  for (const target of base.targets.values()) {
    if (!base.sentences.has(target.sentenceId)) continue;
    const map = target.type === "word" ? wordTargets : unitTargets;
    map.set(target.targetId, [...(map.get(target.targetId) ?? []), target]);
  }
  for (const list of [...wordTargets.values(), ...unitTargets.values()]) list.sort((a, b) => a.id - b.id);
  const wordSentences = new Map<number, number[]>();
  for (const sentence of base.sentences.values()) {
    if (!sentence.bank) continue;
    const seen = new Set<number>();
    for (const token of sentence.tokens) {
      if (token.kind !== "word" || token.wordId === null || seen.has(token.wordId)) continue;
      seen.add(token.wordId);
      wordSentences.set(token.wordId, [...(wordSentences.get(token.wordId) ?? []), sentence.id]);
    }
  }
  const units = [...base.units].sort((a, b) => a.orderNo - b.orderNo || a.id - b.id);
  const rank = (text: TextC) => text.orderOverride ?? Number.MAX_SAFE_INTEGER;
  const texts = [...base.texts].sort(
    (a, b) => base.levels.indexOf(a.level) - base.levels.indexOf(b.level) || rank(a) - rank(b) || a.difficulty - b.difficulty || a.id - b.id,
  );
  const phonics = [...base.phonics].sort((a, b) => a.orderNo - b.orderNo || a.id - b.id);
  return { ...base, units, texts, phonics, wordByCode, wordTargets, unitTargets, wordSentences, lemmaIndex };
}

export const levelIndex = (content: Pick<Content, "levels">, level: string | null | undefined) => (level ? content.levels.indexOf(level) : -1);

/**
 * Registers whose words have their own vocabulary card and sentences (PRD §9.6); the server filters on the
 * same list. A formal word is taught like any other, with «رسمی» on its card (DECISIONS.md).
 */
export const CARD_REGISTERS: readonly WordC["register"][] = ["standard", "formal"];
/** Registers of colloquial words, taught beside a card word of the same concept (PRD §5.4). */
export const COLLOQUIAL_REGISTERS: readonly WordC["register"][] = ["familier", "argot"];

export const isCardRegister = (register: string) => (CARD_REGISTERS as readonly string[]).includes(register);

/** A word with a vocabulary card: a card register and not `no_card` (PRD §9.6). */
export const hasCard = (word: WordC) => !word.noCard && isCardRegister(word.register);

/** A colloquial word (PRD §5.4). */
export const isColloquial = (word: WordC) => COLLOQUIAL_REGISTERS.includes(word.register);

/** The article and the text a noun is shown with (PRD §5.1, "نمایش اسم"). */
export function nounArticle(word: WordC, lang: Lang): string | null {
  if (word.pos !== "noun" || !word.gender) return null;
  if (word.number === "pl_only") return lang === "fr" ? "les" : "die";
  if (lang === "fr") return word.gender === "m" ? "un" : word.gender === "f" ? "une" : "un/une";
  return word.gender;
}

export function displayWord(word: WordC, lang: Lang): string {
  const article = nounArticle(word, lang);
  if (!article) return word.lemma;
  if (lang === "de" && word.number === "pl_only") return `die ${word.lemma} (Pl.)`;
  return `${article} ${word.lemma}`;
}

/** The gender buttons a typed noun gets, or null when there are none (PRD §5.1, §3.5). */
export function genderButtons(word: WordC, lang: Lang): string[] | null {
  if (word.pos !== "noun" || !word.gender || word.gender === "mf" || word.number === "pl_only") return null;
  return lang === "fr" ? ["un", "une"] : ["der", "die", "das"];
}

export function genderAnswer(word: WordC, lang: Lang): string | null {
  if (!genderButtons(word, lang)) return null;
  if (lang === "fr") return word.gender === "m" ? "un" : "une";
  return word.gender;
}

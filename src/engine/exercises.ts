/**
 * Every exercise code of the ladders (PRD §5.3, §5.4, §6.5, §6.6) and what the engine needs to know
 * about it: its step, whether it tests meaning or only form (§5.3), whether the learner types,
 * whether it needs sound, and which `time.*` estimate it costs (§10.1).
 */

export type ExerciseFamily = "word" | "colloquial" | "grammar" | "conjugation";
export type TimeKey = "time.choice" | "time.type_word" | "time.type_sentence" | "time.arrange";

export type ExerciseDef = {
  code: string;
  family: ExerciseFamily;
  step: number;
  /** Meaning exercise (PRD §5.3); only scored reviews of words care. Every grammar exercise counts as meaning. */
  meaning: boolean;
  /** The learner types the answer (keyboard). */
  typed: boolean;
  /** A recall-typing exercise: "fast" answers and the first-typing rule (PRD §9.2). */
  recall: boolean;
  /** Needs sound to be answered. */
  audio: boolean;
  time: TimeKey;
  /** Several pairs at once: no «نمی‌دانم» button (PRD §9.4). */
  multiPair?: boolean;
};

const def = (code: string, family: ExerciseFamily, step: number, meaning: boolean, time: TimeKey, extra: Partial<ExerciseDef> = {}): ExerciseDef => ({
  code,
  family,
  step,
  meaning,
  typed: false,
  recall: false,
  audio: false,
  time,
  ...extra,
});

export const exerciseDefs: ExerciseDef[] = [
  def("W1a", "word", 1, true, "time.choice"),
  def("W1b", "word", 1, true, "time.choice", { audio: true }),
  def("W2a", "word", 2, true, "time.choice"),
  def("W2b", "word", 2, true, "time.choice"),
  def("W2c", "word", 2, true, "time.choice"),
  def("W2d", "word", 2, false, "time.choice"),
  def("W3a", "word", 3, false, "time.choice", { audio: true }),
  def("W3b", "word", 3, true, "time.choice"),
  def("W3c", "word", 3, true, "time.choice"),
  def("W3d", "word", 3, true, "time.arrange", { multiPair: true }),
  def("W4a", "word", 4, false, "time.arrange"),
  def("W4b", "word", 4, false, "time.type_word", { typed: true, audio: true }),
  def("W4c", "word", 4, false, "time.choice"),
  def("W5a", "word", 5, true, "time.type_word", { typed: true, recall: true }),
  def("W5b", "word", 5, false, "time.type_word", { typed: true, audio: true }),
  def("W6a", "word", 6, true, "time.type_word", { typed: true, recall: true }),
  def("W6b", "word", 6, false, "time.type_word", { typed: true, audio: true }),
  // Colloquial words: a two-step ladder, both meaning (PRD §5.4). Codes are ours (DECISIONS.md).
  def("K1", "colloquial", 1, true, "time.choice"),
  def("K2", "colloquial", 2, true, "time.type_word", { typed: true, recall: true }),
  def("G1a", "grammar", 1, true, "time.choice"),
  def("G1b", "grammar", 1, true, "time.choice"),
  def("G2a", "grammar", 2, true, "time.choice"),
  def("G2b", "grammar", 2, true, "time.choice", { audio: true }),
  def("G2c", "grammar", 2, true, "time.choice"),
  def("G3a", "grammar", 3, true, "time.arrange", { multiPair: true }),
  def("G3b", "grammar", 3, true, "time.choice"),
  def("G3c", "grammar", 3, true, "time.choice"),
  def("G4a", "grammar", 4, true, "time.arrange"),
  def("G4b", "grammar", 4, true, "time.arrange", { audio: true }),
  def("G5a", "grammar", 5, true, "time.type_word", { typed: true }),
  def("G5b", "grammar", 5, true, "time.type_word", { typed: true }),
  def("G6", "grammar", 6, true, "time.type_sentence", { typed: true }),
  def("G6b", "grammar", 6, true, "time.type_sentence", { typed: true }),
  def("C1", "conjugation", 1, true, "time.choice"),
  def("C2", "conjugation", 2, true, "time.arrange"),
  def("C3", "conjugation", 3, true, "time.type_word", { typed: true, recall: true }),
  def("C4", "conjugation", 4, true, "time.type_sentence", { typed: true, recall: true }),
];

const byCode = new Map(exerciseDefs.map((item) => [item.code, item]));

export function exerciseDef(code: string): ExerciseDef {
  const found = byCode.get(code);
  if (!found) throw new Error(`Unknown exercise code ${code}`);
  return found;
}

export const codesAt = (family: ExerciseFamily, step: number) => exerciseDefs.filter((item) => item.family === family && item.step === step).map((item) => item.code);

/** Grammar rounds from step 5 on are typed; their first round is the unit's first typing (PRD §9.2). */
export const TYPED_ROUND_FROM_STEP = 5;

/** Exercises a phrase never gets (PRD §5.1). */
export const PHRASE_EXCLUDED = new Set(["W2d", "W3a", "W4a", "W4b", "W4c"]);
/** Typing exercises a recognize word never gets, plus W4a and W4c (PRD §5.3). */
export const RECOGNIZE_EXCLUDED = new Set(["W4a", "W4b", "W4c", "W5a", "W5b", "W6a", "W6b"]);

/**
 * Numbers that are part of an exercise's definition in PRD §5–6 rather than tuning, so they are not in
 * `engine_setting` (DECISIONS.md). Each one cites the line that fixes it.
 */
export const SHAPE = {
  /** Four-option exercises have three wrong options (§5.3). */
  wrongOptions: 3,
  /** A word does not get a sentence from its last five exposures (§5.7, rule 2). */
  recentSentences: 5,
  /** W3c: a wrong translation is at most 40% longer or shorter than the right one (§5.5). */
  translationLength: 0.4,
  /** W4b hides at least 2 and at most 5 letters (§5.3). */
  w4bMinHidden: 2,
  w4bMaxHidden: 5,
  /** W4a and W4b need a word of at least four letters (§5.3). */
  minLetters: 4,
  /** W3d: the target pair and four more (§5.3). */
  pairCompanions: 4,
  /** C2: three empty rows and two extra forms in the bank (§6.6). */
  c2EmptyRows: 3,
  c2ExtraForms: 2,
  /** G4a: up to two extra tiles from the distractors (§6.5). */
  g4aExtraTiles: 2,
  /** G1b: three wrong sentences; G2b and G2c: two (§6.5). */
  g1bWrong: 3,
  g2Wrong: 2,
  /** A grammar round asks five questions of one unit at one step; with fewer than three it is not given (§6.5). */
  roundSize: 5,
  roundMin: 3,
  /** Round score bands: Good and a step up from 0.8, Hard from 0.6, below that Again (§9.2). */
  roundGood: 0.8,
  roundHard: 0.6,
  /** Round sentences avoid the unit's last three rounds (§6.5). */
  roundRecent: 3,
  /** G0: three two-option warm-ups after the lesson (§6.5). */
  warmups: 3,
  /** A conjugation table has six persons (§6.6). */
  persons: 6,
  /** A pack of new material: up to three words, or up to three conjugation cards (§10.2). */
  packWords: 3,
  packConj: 3,
  /** Pack choice: progress bar plus 0.1 for every pack the skill already got this session (§10.2). */
  packWeight: 0.1,
  /** Reshuffles before an arrangement that still reads in order is given up. */
  shuffleTries: 10,
} as const;

/**
 * Defaults for `app_setting` (PRD §4.3, §13.2): settings that are not engine numbers.
 * The seed inserts any key that is missing and never overwrites an admin's change.
 */

export type LevelTargets = {
  words: number;
  phrases: number;
  grammar_units: number;
  texts: number;
  translations: number;
  dialogues: number;
  errorfix: number;
  writing: number;
};

/** Per-level content targets from PRD §7.8, §8b.7 and §16.6. The workbench counts against them. */
const levelTargets: Record<string, LevelTargets> = {
  A1: { words: 600, phrases: 50, grammar_units: 50, texts: 40, translations: 400, dialogues: 10, errorfix: 0, writing: 0 },
  A2: { words: 900, phrases: 100, grammar_units: 50, texts: 120, translations: 400, dialogues: 20, errorfix: 0, writing: 0 },
  B1: { words: 1500, phrases: 150, grammar_units: 50, texts: 100, translations: 400, dialogues: 25, errorfix: 60, writing: 20 },
  B2: { words: 2000, phrases: 200, grammar_units: 50, texts: 80, translations: 400, dialogues: 25, errorfix: 60, writing: 20 },
};

export const appSettingDefaults: Record<string, unknown> = {
  "levels.fr": ["A1", "A2", "B1", "B2"],
  "levels.de": ["A1", "A2", "B1", "B2"],
  /** Session length in minutes to a one-line honest estimate. Empty until the simulator fills it (PRD §3.1). */
  pace_estimate_fa: {},
  /** Chatbot names the admin picks from in step 1 of the four-step path (PRD §13.9). */
  chatbot_names: ["ChatGPT", "Claude", "Gemini"],
  /** Records per batch for each prompt (PRD §14.9); made smaller when answers keep getting cut. */
  "batch.sizes": {
    "P-C": 200,
    "P-W": 50,
    "P-S": 10,
    "P-T": 2,
    "P-X": 20,
    "P-QA": 100,
    "P-E": 5,
    "P-WR": 5,
  },
  /** Sentence length in words for vocabulary sentences (P-S), per level. */
  "prompt.sentence_length": { A1: "4 تا 10", A2: "5 تا 12", B1: "6 تا 15", B2: "6 تا 18" },
  /** How many targets, transforms and short translations one grammar unit asks for (P-G, PRD §14.6). */
  "prompt.grammar_counts": { targets: 40, transforms: 8, translations: 8 },
  /** Longest short translation in words, per level (P-G and P-TR, PRD §14.6). */
  "prompt.translation_length": { A1: 10, A2: 10, B1: 14, B2: 14 },
  /**
   * Tenses that get a conjugation table, per level (PRD §6.6, §16.2: set by the teacher). A verb gets
   * every tense of its level and below; a lower-level verb gets the higher tenses when that level comes.
   */
  "conjugation.tenses.fr": {
    A1: ["présent", "passé composé"],
    A2: ["imparfait", "futur simple"],
    B1: ["conditionnel présent", "plus-que-parfait", "subjonctif présent"],
    B2: ["conditionnel passé", "futur antérieur", "subjonctif passé"],
  },
  "conjugation.tenses.de": {
    A1: ["Präsens", "Perfekt"],
    A2: ["Präteritum"],
    B1: ["Futur I", "Plusquamperfekt", "Konjunktiv II"],
    B2: ["Konjunktiv I", "Konjunktiv II Vergangenheit"],
  },
  "targets.fr": levelTargets,
  "targets.de": levelTargets,
  terms_fa: "",
  privacy_fa: "",
};

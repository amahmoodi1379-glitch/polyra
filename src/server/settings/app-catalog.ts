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
  "targets.fr": levelTargets,
  "targets.de": levelTargets,
  terms_fa: "",
  privacy_fa: "",
};

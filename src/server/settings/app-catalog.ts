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
  /**
   * Phonics lessons in teaching order, each with its kind (PRD §8.1, §16.2: set by the teacher). The
   * label is the lesson's sound_label; P-H makes them one at a time in this order.
   */
  "phonics.lessons.fr": [
    { label: "حرف‌های خاموش: آخر کلمه و h", kind: "rule" },
    { label: "u و ou", kind: "contrast" },
    { label: "u و i", kind: "contrast" },
    { label: "é و è", kind: "contrast" },
    { label: "e خاموش", kind: "rule" },
    { label: "صداهای دماغی an، on، in", kind: "contrast" },
    { label: "r فرانسوی", kind: "rule" },
    { label: "ou، oi، au، eau، ai", kind: "rule" },
    { label: "eu و œu", kind: "rule" },
    { label: "ch، j، g، gn", kind: "rule" },
    { label: "c و ç، g نرم و سخت", kind: "rule" },
    { label: "s و z", kind: "contrast" },
    { label: "ill، ail، eil", kind: "rule" },
    { label: "liaison و enchaînement", kind: "liaison" },
  ],
  "phonics.lessons.de": [
    { label: "واکه کوتاه و بلند", kind: "contrast" },
    { label: "ei و ie", kind: "contrast" },
    { label: "ü و i", kind: "contrast" },
    { label: "ö و e", kind: "contrast" },
    { label: "ä، ö، ü در برابر a، o، u", kind: "contrast" },
    { label: "äu و eu", kind: "rule" },
    { label: "ch در ich و ach", kind: "rule" },
    { label: "sp و st در اول کلمه", kind: "rule" },
    { label: "s، z و ß", kind: "rule" },
    { label: "w و v", kind: "rule" },
    { label: "r آلمانی و -er آخر کلمه", kind: "rule" },
    { label: "h خاموش بعد از واکه", kind: "rule" },
    { label: "b، d، g آخر کلمه", kind: "rule" },
    { label: "-ig و -ng", kind: "rule" },
  ],
  /** Text length in words per band (PRD §7.1); the import refuses a text outside its band. */
  "prompt.text_bands": { "1": [30, 60], "2": [60, 120], "3": [150, 300], "4": [300, 500] },
  /** Texts per P-T batch, per band (PRD §14.9: 1 to 3); long texts go one at a time. */
  "prompt.texts_per_batch": { "1": 3, "2": 2, "3": 1, "4": 1 },
  /** Bands each level's texts use (PRD §7.1, §7.8); A2 alternates between its two bands. */
  "prompt.text_level_bands": { A1: [1], A2: [1, 2], B1: [3], B2: [4] },
  /**
   * Kinds of text per band (PRD §7.1), as code and Persian name; `speakers` marks a conversation whose
   * sentences each have a speaker. The next text takes the kind its level and band has least of.
   */
  "prompt.text_kinds": {
    "1": [
      { kind: "dialogue", name_fa: "دیالوگ دونفره", speakers: true },
      { kind: "voice_message", name_fa: "پیام صوتی", speakers: false },
      { kind: "announcement", name_fa: "اعلام ایستگاه یا فرودگاه", speakers: false },
      { kind: "menu", name_fa: "منو", speakers: false },
      { kind: "ad", name_fa: "آگهی کوتاه", speakers: false },
    ],
    "2": [
      { kind: "phone_call", name_fa: "مکالمه تلفنی", speakers: true },
      { kind: "email", name_fa: "ایمیل کوتاه", speakers: false },
      { kind: "schedule", name_fa: "برنامه زمانی", speakers: false },
    ],
    "3": [
      { kind: "long_dialogue", name_fa: "گفتگوی طولانی", speakers: true },
      { kind: "news", name_fa: "خبر ساده", speakers: false },
      { kind: "letter", name_fa: "نامه", speakers: false },
    ],
    "4": [
      { kind: "interview", name_fa: "مصاحبه", speakers: true },
      { kind: "report", name_fa: "گزارش", speakers: false },
      { kind: "article", name_fa: "مقاله کوتاه", speakers: false },
    ],
  },
  /** Everyday topics the texts rotate through, so a level does not fill up with one subject. */
  "prompt.text_topics": [
    "زندگی روزمره",
    "خانواده و دوستان",
    "غذا و رستوران",
    "خرید",
    "شهر و مسیر",
    "مسافرت",
    "کار",
    "مدرسه و دانشگاه",
    "خانه",
    "سلامت",
    "ورزش",
    "آب‌وهوا",
    "حمل‌ونقل",
    "تفریح و فرهنگ",
    "طبیعت",
  ],
  /**
   * The first A1 texts of a language use only the first words of the teaching order (PRD §7.5,
   * §14.9): 3 texts from 40 words (short dialogues of 30 to 40 words), 7 from 100, 10 from 200. Texts
   * after these use every word of their level and below.
   */
  "prompt.first_texts": [
    { texts: 3, words: 40, length: [30, 40], kind: "dialogue" },
    { texts: 7, words: 100 },
    { texts: 10, words: 200 },
  ],
  /** Texts of each level marked placement_ok (PRD §11.2); A1 starts after the first texts above. */
  "prompt.placement_texts": 4,
  "targets.fr": levelTargets,
  "targets.de": levelTargets,
  terms_fa: "",
  privacy_fa: "",
};

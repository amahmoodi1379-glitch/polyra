/**
 * Small hand-made content for engine tests: words, sentences, targets, units and tables built from
 * short literals, plus a build environment and the engine settings at their defaults.
 */
import type { BuildEnv } from "@/engine/build";
import { indexContent, type ConjC, type Content, type SentenceC, type TargetC, type TokenC, type TransformC, type TranslateC, type UnitC, type WordC } from "@/engine/content";
import { seeded } from "@/engine/random";
import type { Settings } from "@/engine/settings";
import type { ItemHistory } from "@/engine/state";
import type { Lang } from "@/engine/text";
import { engineCatalog } from "@/server/settings/engine-catalog";

export const defaults: Settings = Object.fromEntries(engineCatalog.map((item) => [item.key, item.default]));
export const settings = (over: Record<string, Settings[string]> = {}): Settings => ({ ...defaults, ...over });

export function word(id: number, lemma: string, meanings: string | string[], extra: Partial<WordC> = {}, lang: Lang = "fr"): WordC {
  return {
    id,
    code: lemma,
    lemma,
    pos: "noun",
    gender: null,
    number: null,
    plural: null,
    register: "standard",
    conceptId: null,
    meanings: Array.isArray(meanings) ? meanings : [meanings],
    level: "A1",
    introOrder: id,
    noCard: false,
    mastery: "produce",
    senseOf: null,
    parts: [],
    homophones: [],
    image: null,
    noteFa: null,
    family: null,
    collocations: [],
    speak: { text: lemma, lang, url: null },
    ...extra,
  };
}

/** Tokens found by matching each piece of the text to a word's lemma (case-insensitive). */
export function tokenize(text: string, words: WordC[]): TokenC[] {
  const byLemma = new Map(words.map((item) => [item.lemma.toLowerCase(), item]));
  const out: TokenC[] = [];
  for (const match of text.matchAll(/[\p{L}]+'?|\d+/gu)) {
    const surface = match[0];
    const span: [number, number] = [match.index, match.index + surface.length];
    const bare = surface.replace(/'$/, "");
    const found = byLemma.get(surface.toLowerCase()) ?? byLemma.get(bare.toLowerCase());
    const kind: TokenC["kind"] = /^\d+$/.test(surface) ? "number" : !found && /^\p{Lu}/u.test(surface) && match.index > 0 ? "name" : "word";
    out.push({ kind, wordId: found?.id ?? null, surface, spans: [span], meaningCtx: null });
  }
  return out;
}

export function sentence(id: number, text: string, translationFa: string, words: WordC[], extra: Partial<SentenceC> = {}, lang: Lang = "fr"): SentenceC {
  return { id, text, translationFa, level: "A1", speak: { text, lang, url: null }, tokens: tokenize(text, words), bank: true, ...extra };
}

export function target(
  id: number,
  sentenceId: number,
  type: "word" | "grammar",
  targetId: number,
  markedText: string,
  accepted: string[],
  distractors: string[],
  extra: Partial<TargetC> = {},
): TargetC {
  return { id, sentenceId, type, targetId, markedText, blanks: 1, accepted, distractors, hint: null, acceptedFull: null, ...extra };
}

export function unit(id: number, extra: Partial<UnitC> = {}): UnitC {
  return {
    id,
    unitCode: `fr-u${id}`,
    orderNo: id,
    titleFa: `واحد ${id}`,
    level: "A1",
    lessonFa: "درسنامه",
    buildTable: null,
    exampleSentenceIds: [],
    ruleLineFa: "قاعده",
    commonMistakeFa: null,
    canDoFa: null,
    categorySets: null,
    ...extra,
  };
}

export function content(
  parts: {
    words: WordC[];
    sentences?: SentenceC[];
    targets?: TargetC[];
    units?: UnitC[];
    transforms?: TransformC[];
    translates?: TranslateC[];
    conjugations?: ConjC[];
  },
  language: Lang = "fr",
): Content {
  return indexContent({
    language,
    levels: ["A1", "A2", "B1", "B2"],
    openLevels: ["A1", "A2", "B1", "B2"],
    words: new Map(parts.words.map((item) => [item.id, item])),
    sentences: new Map((parts.sentences ?? []).map((item) => [item.id, item])),
    targets: new Map((parts.targets ?? []).map((item) => [item.id, item])),
    units: parts.units ?? [],
    transforms: parts.transforms ?? [],
    translates: parts.translates ?? [],
    conjugations: parts.conjugations ?? [],
  });
}

export const emptyHistory = (): ItemHistory => ({ codeCounts: {}, lastCode: null, recentSentences: [] });

export function env(
  data: Content,
  opts: {
    introduced?: number[];
    /** Known words for sentence choice; every word by default. */
    known?: number[];
    history?: Record<string, ItemHistory>;
    seed?: string;
    settings?: Settings;
    vocabLevel?: string;
    partner?: Record<number, number>;
  } = {},
): BuildEnv {
  const introduced = new Set(opts.introduced ?? [...data.words.keys()]);
  const known = new Set(opts.known ?? [...data.words.keys()]);
  let n = 0;
  return {
    content: data,
    settings: opts.settings ?? defaults,
    vocabLevel: opts.vocabLevel ?? "A1",
    known: (id) => known.has(id) || !!data.words.get(id)?.noCard,
    introduced,
    history: (key) => opts.history?.[key] ?? emptyHistory(),
    sentenceSeen: new Map(),
    confusionPartner: (id) => opts.partner?.[id] ?? null,
    rng: seeded(opts.seed ?? "test"),
    nextId: () => `x${++n}`,
  };
}

/** A French A1 set big enough for every word exercise. */
export function frenchSet() {
  const words = [
    word(1, "voiture", "ماشین", { gender: "f", image: "/media/voiture.webp", conceptId: 1 }),
    word(2, "auto", "ماشین", { gender: "f", conceptId: 1 }),
    word(3, "école", "مدرسه", { gender: "f" }),
    word(4, "maison", "خانه", { gender: "f", image: "/media/maison.webp" }),
    word(5, "chat", "گربه", { gender: "m", image: "/media/chat.webp" }),
    word(6, "chien", "سگ", { gender: "m", image: "/media/chien.webp" }),
    word(7, "pain", "نان", { gender: "m", homophones: ["pin"] }),
    word(8, "eau", "آب", { gender: "f" }),
    word(9, "livre", "کتاب", { gender: "m", image: "/media/livre.webp" }),
    word(10, "manger", "خوردن", { pos: "verb" }),
    word(11, "je", "من", { pos: "pron" }),
    word(12, "un", "یک", { pos: "det" }),
    word(13, "une", "یک", { pos: "det" }),
    word(14, "la", "حرف تعریف", { pos: "det" }),
    word(15, "le", "حرف تعریف", { pos: "det" }),
    word(16, "est", "است", { pos: "verb" }),
    word(17, "grand", "بزرگ", { pos: "adj" }),
    word(18, "petit", "کوچک", { pos: "adj" }),
    word(19, "rouge", "قرمز", { pos: "adj" }),
    word(20, "cuisine", "آشپزخانه", { gender: "f" }),
    word(21, "cousine", "دخترخاله", { gender: "f" }),
    word(22, "il", "او", { pos: "pron" }),
    word(23, "a", "دارد", { pos: "verb" }),
  ];
  const sentences = [
    sentence(1, "La voiture est rouge.", "ماشین قرمز است.", words),
    sentence(2, "Il a une voiture.", "او یک ماشین دارد.", words),
    sentence(3, "La maison est grande.", "خانه بزرگ است.", words),
    sentence(4, "Le chat est petit.", "گربه کوچک است.", words),
    sentence(5, "Je mange le pain.", "من نان را می‌خورم.", words),
    sentence(6, "La cuisine est petite.", "آشپزخانه کوچک است.", words),
    sentence(7, "Le chien est grand.", "سگ بزرگ است.", words),
    sentence(8, "Le livre est rouge.", "کتاب قرمز است.", words),
  ];
  const targets = [
    target(1, 1, "word", 1, "La {{voiture}} est rouge.", ["voiture"], ["maison", "cuisine", "école"]),
    target(2, 2, "word", 1, "Il a une {{voiture}}.", ["voiture"], ["maison", "école", "cousine"]),
  ];
  return { words, sentences, targets };
}

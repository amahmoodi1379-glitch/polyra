/**
 * Made-up content for engine tests and the simulator (PRD §16.3): words, bank sentences with word
 * targets, grammar units with their targets and conjugation tables. Every value comes from the index,
 * so the same arguments always give the same content.
 */
import { indexContent, type ConjC, type Content, type Gender, type Pos, type SentenceC, type TargetC, type TransformC, type UnitC, type WordC } from "../../src/engine/content";
import type { Lang } from "../../src/engine/text";

export type SyntheticOptions = {
  words?: number;
  units?: number;
  language?: Lang;
  /** Levels with content, lowest first; words are spread evenly over them. */
  levels?: string[];
  openLevels?: string[];
  /** The level of the words in grammar sentences; the lowest level by default. */
  unitWordsLevel?: string;
};

const POS: Pos[] = ["noun", "noun", "verb", "adj", "noun", "adv", "noun", "verb"];
const FAMILIES = ["couleur", "jour", "nombre", null, null, null, null, null, null, null];

function lemmaOf(i: number): string {
  // Distinct, pronounceable, four letters or more, with some accents.
  const syllables = ["ba", "ce", "di", "fo", "gu", "la", "mé", "no", "pa", "ré", "si", "tu", "vo", "zè"];
  const a = syllables[i % syllables.length];
  const b = syllables[Math.floor(i / syllables.length) % syllables.length];
  const c = syllables[Math.floor(i / (syllables.length * syllables.length)) % syllables.length];
  return `${a}${b}${c}${i}`;
}

export function syntheticContent(opts: SyntheticOptions = {}): Content {
  const count = opts.words ?? 300;
  const unitCount = opts.units ?? 12;
  const language = opts.language ?? "fr";
  const levels = opts.levels ?? ["A1", "A2", "B1", "B2"];
  const perLevel = Math.ceil(count / levels.length);
  const genders: Gender[] = language === "fr" ? ["m", "f"] : ["der", "die", "das"];

  const words: WordC[] = [];
  for (let i = 1; i <= count; i++) {
    const pos = POS[i % POS.length];
    const lemma = lemmaOf(i);
    words.push({
      id: i,
      code: lemma,
      lemma,
      pos,
      gender: pos === "noun" ? genders[i % genders.length] : null,
      number: pos === "noun" ? "sg" : null,
      plural: pos === "noun" ? `${lemma}s` : null,
      register: "standard",
      conceptId: null,
      meanings: [`معنی ${i}`],
      level: levels[Math.min(levels.length - 1, Math.floor((i - 1) / perLevel))],
      introOrder: i,
      noCard: i % 25 === 0,
      mastery: "produce",
      senseOf: null,
      parts: [],
      homophones: i % 17 === 0 ? ["x"] : [],
      image: i % 3 === 0 ? `/media/img${i}.webp` : null,
      noteFa: null,
      family: FAMILIES[i % FAMILIES.length],
      collocations: [],
      speak: { text: lemma, lang: language, url: null },
    });
  }

  const sentences: SentenceC[] = [];
  const targets: TargetC[] = [];
  let sentenceId = 1;
  let targetId = 1;
  const tokenFor = (word: WordC, start: number) => ({
    kind: "word" as const,
    wordId: word.id,
    surface: word.lemma,
    spans: [[start, start + word.lemma.length]] as [number, number][],
    meaningCtx: null,
  });
  const makeSentence = (list: WordC[], level: string): SentenceC => {
    const text = `${list.map((word) => word.lemma).join(" ")}.`;
    let at = 0;
    const tokens = list.map((word) => {
      const token = tokenFor(word, at);
      at += word.lemma.length + 1;
      return token;
    });
    const id = sentenceId++;
    return { id, text, translationFa: `ترجمه جمله ${id}`, level, speak: { text, lang: language, url: null }, tokens, bank: true };
  };
  const blankOut = (sentence: SentenceC, word: WordC) => sentence.text.replace(new RegExp(`(^| )${word.lemma}(?= |\\.)`), (match, lead) => `${lead}{{${word.lemma}}}`);

  // Word sentences: each word with three to four words that come before it in the order.
  for (const word of words) {
    if (word.noCard) continue;
    for (let k = 0; k < 6; k++) {
      // Earlier words, so the sentence is readable once they are known; the first words use no-card words.
      const earlier = word.id > 4 ? words.slice(0, word.id - 1) : words.filter((other) => other.noCard);
      const companions = [1, 2, 3].map((d) => earlier[(earlier.length * 10 - d * (k + 1)) % earlier.length]).filter((other) => other && other.id !== word.id);
      const list = [...companions.slice(0, 2), word, ...companions.slice(2)];
      const sentence = makeSentence(list, word.level);
      sentences.push(sentence);
      const others = words.filter((other) => other.id !== word.id && other.pos === word.pos).slice(0, 40);
      const distractors = [0, 1, 2].map((d) => others[(word.id + k + d * 7) % others.length].lemma);
      targets.push({
        id: targetId++,
        sentenceId: sentence.id,
        type: "word",
        targetId: word.id,
        markedText: blankOut(sentence, word),
        blanks: 1,
        accepted: [word.lemma],
        distractors,
        hint: null,
        acceptedFull: null,
      });
    }
  }

  // Grammar units: 30 targets each, on the unit's level, the blank on one word of the sentence.
  const units: UnitC[] = [];
  const transforms: TransformC[] = [];
  for (let u = 1; u <= unitCount; u++) {
    const level = levels[Math.min(levels.length - 1, Math.floor(((u - 1) * levels.length) / unitCount))];
    const pool = words.filter((word) => word.level === (opts.unitWordsLevel ?? levels[0]) && !word.noCard);
    const exampleIds: number[] = [];
    for (let k = 0; k < 30; k++) {
      const list = [0, 1, 2, 3].map((d) => pool[(u * 7 + k * 3 + d * 11) % pool.length]);
      const unique = list.filter((word, index) => list.findIndex((other) => other.id === word.id) === index);
      const sentence = makeSentence(unique, level);
      sentences.push(sentence);
      if (exampleIds.length < 3) exampleIds.push(sentence.id);
      const blank = unique[1] ?? unique[0];
      const distractors = [`${blank.lemma}e`, `${blank.lemma}s`, `${blank.lemma}nt`];
      targets.push({
        id: targetId++,
        sentenceId: sentence.id,
        type: "grammar",
        targetId: u,
        markedText: blankOut(sentence, blank),
        blanks: 1,
        accepted: [blank.lemma],
        distractors,
        hint: k % 2 ? `(${blank.lemma})` : null,
        acceptedFull: null,
      });
    }
    units.push({
      id: u,
      unitCode: `${language}-g${u}`,
      orderNo: u,
      titleFa: `واحد ${u}`,
      level,
      lessonFa: `درسنامه واحد ${u}`,
      buildTable: null,
      exampleSentenceIds: exampleIds,
      ruleLineFa: `قاعده واحد ${u}`,
      commonMistakeFa: null,
      canDoFa: u % 3 === 0 ? `حالا می‌توانی کار ${u} را بگویی.` : null,
      categorySets:
        u % 4 === 0
          ? [
              { name: "دسته ۱", items: ["un", "deux", "trois"] },
              { name: "دسته ۲", items: ["rouge", "vert", "bleu"] },
            ]
          : null,
    });
    if (u % 2 === 0) {
      for (let k = 0; k < 3; k++) {
        const base = pool[(u + k) % pool.length].lemma;
        transforms.push({ id: transforms.length + 1, unitId: u, instructionFa: "منفی کن", source: `je ${base} bien.`, outputs: [`je ne ${base} pas bien.`] });
      }
    }
  }

  const conjugations: ConjC[] = words
    .filter((word) => word.pos === "verb")
    .slice(0, 12)
    .map((word, i) => ({
      id: i + 1,
      wordId: word.id,
      tense: "présent",
      unitCode: `${language}-g2`,
      forms: Object.fromEntries(
        (language === "fr" ? ["je", "tu", "il_elle_on", "nous", "vous", "ils_elles"] : ["ich", "du", "er_sie_es", "wir", "ihr", "sie_Sie"]).map((key, k) => [
          key,
          `${word.lemma}${["e", "es", "e", "ons", "ez", "ent"][k]}`,
        ]),
      ),
      variants: {},
      reviewCard: i % 2 === 0,
    }));

  return indexContent({
    language,
    levels,
    openLevels: opts.openLevels ?? levels,
    words: new Map(words.map((word) => [word.id, word])),
    sentences: new Map(sentences.map((sentence) => [sentence.id, sentence])),
    targets: new Map(targets.map((target) => [target.id, target])),
    units,
    transforms,
    translates: [],
    conjugations,
  });
}

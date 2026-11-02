/**
 * Made-up content for engine tests and the simulator (PRD §16.3): words, bank sentences with word
 * targets, grammar units with their targets and conjugation tables. Every value comes from the index,
 * so the same arguments always give the same content.
 */
import {
  indexContent,
  type ConjC,
  type Content,
  type Gender,
  type PhonicsC,
  type PhonicsKind,
  type Pos,
  type QuestionC,
  type SentenceC,
  type TargetC,
  type TextC,
  type TransformC,
  type UnitC,
  type WordC,
  type DialogueC,
  type ErrorfixC,
} from "../../src/engine/content";
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
  /** Words and units of each level instead of an even spread (the simulator's A1 600/50, then 300/30, PRD §15.7). */
  perLevel?: { words: number[]; units: number[] };
  /** Listening and reading texts of each level (PRD §7.2), made of the level's words; none by default. */
  textsPerLevel?: number;
  /** Phonics lessons of all three kinds (PRD §16.3: 14); none by default. */
  phonics?: number;
  /** Situational dialogues and find-the-mistake texts of each level (PRD §8b.4, §8b.5), made of the level's words; none by default. */
  dialoguesPerLevel?: number;
  errorfixPerLevel?: number;
};

/** The level of the `n`th item (from 1) when each level holds `sizes[i]` of them. */
function levelAt(levels: string[], sizes: number[], n: number): string {
  let end = 0;
  for (let i = 0; i < levels.length; i++) {
    end += sizes[i] ?? 0;
    if (n <= end) return levels[i];
  }
  return levels[levels.length - 1];
}

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
  const count = opts.perLevel ? opts.perLevel.words.reduce((a, b) => a + b, 0) : (opts.words ?? 300);
  const unitCount = opts.perLevel ? opts.perLevel.units.reduce((a, b) => a + b, 0) : (opts.units ?? 12);
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
      level: opts.perLevel ? levelAt(levels, opts.perLevel.words, i) : levels[Math.min(levels.length - 1, Math.floor((i - 1) / perLevel))],
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
    const level = opts.perLevel ? levelAt(levels, opts.perLevel.units, u) : levels[Math.min(levels.length - 1, Math.floor(((u - 1) * levels.length) / unitCount))];
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

  const texts = makeTexts(levels, words, opts.textsPerLevel ?? 0, (list, level) => {
    const sentence = { ...makeSentence(list, level), bank: false, inText: true };
    sentences.push(sentence);
    return sentence;
  });

  // Dialogues: five turns, a line and three choices each, of the level's words; find the mistake: two marks in four words.
  const dialogues: DialogueC[] = [];
  const errorfixes: ErrorfixC[] = [];
  levels.forEach((level) => {
    const pool = words.filter((word) => word.level === level && !word.noCard);
    if (pool.length < 8) return;
    const pick = (n: number, k: number) => [0, 1, 2].map((d) => pool[(n * 5 + k * 3 + d * 7) % Math.min(pool.length, 40)]).filter((word, i, list) => list.indexOf(word) === i);
    for (let n = 0; n < (opts.dialoguesPerLevel ?? 0); n++) {
      const turns = Array.from({ length: 5 }, (_, k) => {
        const line = { ...makeSentence(pick(n, k * 4), level), bank: false };
        const choices = [1, 2, 3].map((c) => ({ ...makeSentence(pick(n, k * 4 + c), level), bank: false }));
        sentences.push(line, ...choices);
        return { sentenceId: line.id, speaker: "B", choices: choices.map((choice) => choice.id), correct: (n + k) % 3, whyFa: `چرا ${k}` };
      });
      dialogues.push({ id: dialogues.length + 1, code: `d-${level}-${n}`, level, titleFa: `گفتگو ${level} ${n + 1}`, situationFa: "در کافه هستی.", turns });
    }
    const unit = units.filter((item) => levels.indexOf(item.level) <= levels.indexOf(level)).at(-1);
    for (let n = 0; n < (opts.errorfixPerLevel ?? 0) && unit; n++) {
      const list = [0, 1, 2, 3].map((d) => pool[(n * 3 + d * 5) % Math.min(pool.length, 40)]);
      const marked = `${list[0].lemma} {{${list[1].lemma}x|${list[1].lemma}}} ${list[2].lemma} {{${list[3].lemma}s|${list[3].lemma}}}.`;
      errorfixes.push({ id: errorfixes.length + 1, level, markedText: marked, translationFa: "ترجمه", unitCodes: [unit.unitCode], whyFa: ["یک", "دو"], wordIds: list.map((word) => word.id) });
    }
  });

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
    texts,
    phonics: makePhonics(language, opts.phonics ?? 0),
    dialogues,
    errorfixes,
  });
}

/**
 * Phonics lessons (PRD §8.1) at their smallest sizes: a contrast lesson six words and five pairs, a
 * rule lesson eight words, a liaison lesson (French only) eight sentences; every other one recorded.
 */
function makePhonics(language: Lang, count: number): PhonicsC[] {
  const kinds: PhonicsKind[] = language === "fr" ? ["contrast", "rule", "liaison"] : ["contrast", "rule"];
  return Array.from({ length: count }, (_, i) => {
    const id = i + 1;
    const kind = kinds[i % kinds.length];
    const speak = (text: string, k: number) => ({ text, lang: language, url: k % 2 ? `/media/phonics-${id}-${k}.mp3` : null });
    const sound = (text: string, k: number) => ({ text, meaningFa: `معنی ${text}`, speak: speak(text, k) });
    const wordsOf = (n: number) => Array.from({ length: n }, (_, k) => ({ ...sound(`ph${id}w${k}`, k), wrong: [`ph${id}x${k}`, `ph${id}y${k}`] }));
    return {
      id,
      orderNo: id,
      kind,
      label: `صدای ${id}`,
      graphemes: [`g${id}`],
      tipFa: `نکته درس ${id}`,
      words: kind === "contrast" ? wordsOf(6) : kind === "rule" ? wordsOf(8) : [],
      pairs: kind === "contrast" ? Array.from({ length: 5 }, (_, k) => ({ a: sound(`ph${id}a${k}`, k), b: sound(`ph${id}b${k}`, k + 1) })) : [],
      sentences:
        kind === "liaison"
          ? Array.from({ length: 8 }, (_, k) => ({ ...sound(`les${k} amis${k} ont${k} un${k} ami${k}`, k), liaisonAfter: k % 2 ? [0, 2] : [0] }))
          : [],
    };
  });
}

/**
 * Texts of each level: six sentences of the level's words, the first texts from its first words (like
 * PRD §7.5's rule for the first A1 texts), every other one with a recording. Bands follow the level.
 * Each track has two question sets of the kinds that track allows.
 */
function makeTexts(levels: string[], words: WordC[], perLevel: number, sentence: (list: WordC[], level: string) => SentenceC): TextC[] {
  const texts: TextC[] = [];
  let questionId = 1;
  const base = (prompt: string) => ({ id: questionId++, prompt, promptFa: null, explanationFa: null });
  levels.forEach((level, li) => {
    const pool = words.filter((word) => word.level === level && !word.noCard);
    for (let k = 0; k < perLevel && pool.length >= 8; k++) {
      const reach = Math.min(pool.length, 12 + k * 10);
      const sentences = Array.from({ length: 6 }, (_, j) => sentence([0, 1, 2, 3, 4].map((d) => pool[(k * 5 + j * 3 + d * 7) % reach]), level));
      const wordCount = sentences.reduce((sum, item) => sum + item.tokens.length, 0);
      const id = texts.length + 1;
      const choice = (n: number): QuestionC => ({ ...base(`سؤال ${n}`), type: "mcq", options: ["a", "b", "c"], correct: n % 3 });
      const truth = (n: number): QuestionC => ({ ...base(`درست یا غلط ${n}`), type: "tf", correct: n % 2 === 0 });
      const set = (kind: "listening" | "reading", name: "A" | "B"): QuestionC[] => {
        const extra: QuestionC =
          kind === "listening"
            ? name === "A"
              ? { ...base("بنویس"), type: "dict", sentence: 1 }
              : { ...base("عدد"), type: "num", answer: "12", accepted: ["12", "douze"] }
            : name === "A"
              ? { ...base("کدام جمله"), type: "find", correctSentence: 2 }
              : { ...base("ترتیب"), type: "order", items: ["x", "y", "z"], correctOrder: [2, 0, 1] };
        return [choice(1), truth(2), choice(3), extra];
      };
      texts.push({
        id,
        code: `t${level}-${k + 1}`,
        level,
        band: Math.min(4, li + 1),
        kind: k % 2 ? "dialogue" : "message",
        title: `متن ${level} ${k + 1}`,
        sentenceIds: sentences.map((item) => item.id),
        speakers: k % 2 ? sentences.map((_, j) => (j % 2 ? "B" : "A")) : null,
        audio: k % 2 ? { url: `/media/text${id}.mp3`, offsetsMs: sentences.map((_, j) => j * 2500), durationSec: wordCount / 2 } : null,
        wordCount,
        keyWordIds: [pool[(k * 5) % reach].id, pool[(k * 5 + 3) % reach].id],
        placementOk: k === 0,
        difficulty: k,
        orderOverride: null,
        questions: { listening: { A: set("listening", "A"), B: set("listening", "B") }, reading: { A: set("reading", "A"), B: set("reading", "B") } },
      });
    }
  });
  return texts;
}

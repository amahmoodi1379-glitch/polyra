import {
  displayWord,
  genderAnswer,
  genderButtons,
  hasCard,
  isColloquial,
  levelIndex,
  nounArticle,
  PRONOUNS,
  type ConjC,
  type Content,
  type SentenceC,
  type TargetC,
  type TransformC,
  type TranslateC,
  type UnitC,
  type WordC,
} from "./content";
import type { AnswerSpec, Choice, Ex, Gloss, Question, Segment, SentenceView, WordView } from "./ex";
import { exerciseDef, PHRASE_EXCLUDED, RECOGNIZE_EXCLUDED, SHAPE } from "./exercises";
import { shuffle, type Rng } from "./random";
import { exerciseOn, num, type Settings } from "./settings";
import { itemKey, type ItemHistory } from "./state";

/**
 * Builds one exercise from the content (PRD §5.3, §5.5, §5.7, §6.5, §6.6). Every builder returns
 * null when the exercise's needs are not met for this item; that is how "requirement not met" is
 * decided in exercise choice (§9.3).
 */

export type BuildEnv = {
  content: Content;
  settings: Settings;
  /** The learner's vocabulary level, the ceiling for wrong options (PRD §5.5). */
  vocabLevel: string;
  /** "Known" word (PRD §5.7): has a card, is below `known_below`, or is `no_card`. */
  known: (wordId: number) => boolean;
  /** Word ids the learner has a card for. */
  introduced: ReadonlySet<number>;
  history: (key: string) => ItemHistory;
  sentenceSeen: ReadonlyMap<number, number>;
  /** The other word of the learner's strongest confusion pair with this word (PRD §5.5). */
  confusionPartner: (wordId: number) => number | null;
  rng: Rng;
  nextId: () => string;
};

const BLANK = /\{\{([^}]*)\}\}/g;

// ───────────────────────────── views ─────────────────────────────

export function wordView(word: WordC, content: Content): WordView {
  const lang = content.language;
  return {
    id: word.id,
    lemma: word.lemma,
    display: displayWord(word, lang),
    article: nounArticle(word, lang),
    gender: word.gender,
    pos: word.pos,
    meaning: word.meanings[0] ?? "",
    meanings: word.meanings,
    plural: word.plural,
    image: word.image,
    noteFa: word.noteFa,
    colloquial: isColloquial(word),
    speak: word.speak,
  };
}

export function glossesOf(sentence: SentenceC, content: Content): Gloss[] {
  const out: Gloss[] = [];
  for (const token of sentence.tokens) {
    const word = token.wordId !== null ? content.words.get(token.wordId) : undefined;
    for (const [start, end] of token.spans) {
      out.push({ start, end, kind: token.kind, wordId: token.wordId, meaning: token.meaningCtx ?? word?.meanings[0] ?? null });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The sentence with its blanks (`{{...}}` in `marked_text`) as segments. */
export function segmentsOf(markedText: string, firstLetters = false): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  let index = 0;
  for (const match of markedText.matchAll(BLANK)) {
    if (match.index > last) out.push({ t: "text", s: markedText.slice(last, match.index) });
    const inner = match[1];
    out.push(firstLetters ? { t: "blank", i: index, first: inner[0], size: inner.length } : { t: "blank", i: index, size: inner.length });
    index++;
    last = match.index + match[0].length;
  }
  if (last < markedText.length) out.push({ t: "text", s: markedText.slice(last) });
  return out;
}

/** The marked text with each blank filled by the given strings. */
export const fillBlanks = (markedText: string, fills: string[]) => {
  let i = 0;
  return markedText.replace(BLANK, () => fills[i++] ?? "");
};

function sentenceView(sentence: SentenceC, content: Content, opts: { marked?: string; translation: boolean; firstLetters?: boolean }): SentenceView {
  return {
    id: sentence.id,
    text: sentence.text,
    segments: opts.marked ? segmentsOf(opts.marked, opts.firstLetters) : [{ t: "text", s: sentence.text }],
    translation: opts.translation ? sentence.translationFa : null,
    glosses: glossesOf(sentence, content),
    speak: sentence.speak,
  };
}

// ───────────────────────────── sentence choice ─────────────────────────────

/** Share of known words among the sentence's other word tokens, with repeats (PRD §5.7). */
export function knownShare(sentence: SentenceC, known: (wordId: number) => boolean, exceptWordId: number | null): number {
  let total = 0;
  let ok = 0;
  for (const token of sentence.tokens) {
    if (token.kind !== "word") continue;
    if (token.wordId !== null && token.wordId === exceptWordId) continue;
    total++;
    if (token.wordId !== null && known(token.wordId)) ok++;
  }
  return total === 0 ? 1 : ok / total;
}

/** Sentences allowed for a word exercise, least seen first, ties at random (PRD §5.7). */
function allowedSentences(env: BuildEnv, word: WordC, ids: number[]): SentenceC[] {
  const threshold = num(env.settings, "known.threshold");
  const recent = new Set(env.history(itemKey("word", word.id)).recentSentences.slice(0, SHAPE.recentSentences));
  const list = ids
    .map((id) => env.content.sentences.get(id))
    .filter((sentence): sentence is SentenceC => !!sentence && !recent.has(sentence.id) && knownShare(sentence, env.known, word.id) >= threshold);
  return leastSeenFirst(env, list);
}

function leastSeenFirst(env: BuildEnv, list: SentenceC[]): SentenceC[] {
  return shuffle(env.rng, list).sort((a, b) => (env.sentenceSeen.get(a.id) ?? 0) - (env.sentenceSeen.get(b.id) ?? 0));
}

const singleTargets = (targets: TargetC[] | undefined) => (targets ?? []).filter((target) => target.blanks === 1);
const acceptedOf = (target: TargetC): string[] => (target.blanks === 1 ? (target.accepted as string[]) : []);
const distractorsOf = (target: TargetC): string[] => (target.blanks === 1 ? (target.distractors as string[]) : []);

// ───────────────────────────── wrong options ─────────────────────────────

const meaningsOverlap = (a: WordC, b: WordC) => a.meanings.some((meaning) => b.meanings.includes(meaning));

/** Three words whose meaning or form serve as wrong options for this word (PRD §5.5). */
function wrongWords(env: BuildEnv, word: WordC, field: "meaning" | "lemma"): WordC[] | null {
  const ceiling = levelIndex(env.content, env.vocabLevel);
  const usable = (other: WordC) =>
    other.id !== word.id &&
    other.lemma.toLowerCase() !== word.lemma.toLowerCase() &&
    (other.conceptId === null || other.conceptId !== word.conceptId) &&
    !meaningsOverlap(word, other) &&
    other.meanings.length > 0 &&
    levelIndex(env.content, other.level) <= Math.max(ceiling, levelIndex(env.content, word.level));
  const shown = (other: WordC) => (field === "meaning" ? other.meanings[0] : other.lemma);
  const chosen: WordC[] = [];
  const taken = new Set([shown(word)]);
  const add = (other: WordC | undefined) => {
    if (!other || chosen.length >= SHAPE.wrongOptions || !usable(other) || taken.has(shown(other))) return;
    chosen.push(other);
    taken.add(shown(other));
  };
  const partner = env.confusionPartner(word.id);
  if (partner !== null) add(env.content.words.get(partner));
  const all = shuffle(env.rng, [...env.content.words.values()].filter(hasCard));
  const ranked = (list: WordC[]) => [...list.filter((other) => env.introduced.has(other.id)), ...list.filter((other) => !env.introduced.has(other.id))];
  for (const other of ranked(all.filter((other) => other.pos === word.pos))) add(other);
  for (const other of ranked(all.filter((other) => other.pos !== word.pos))) add(other);
  return chosen.length === SHAPE.wrongOptions ? chosen : null;
}

function choiceSet(env: BuildEnv, correct: Choice, wrong: Choice[]): { options: Choice[]; correct: string } {
  return { options: shuffle(env.rng, [correct, ...wrong]), correct: correct.id };
}

/** Every written form of the language, so a made-up misspelling is never a real word (PRD §5.5). */
const formCache = new WeakMap<Content, Set<string>>();
function realForms(content: Content): Set<string> {
  let forms = formCache.get(content);
  if (forms) return forms;
  forms = new Set<string>();
  for (const word of content.words.values()) {
    forms.add(word.lemma.toLowerCase());
    if (word.plural) forms.add(word.plural.toLowerCase());
  }
  for (const sentence of content.sentences.values()) for (const token of sentence.tokens) forms.add(token.surface.toLowerCase());
  for (const table of content.conjugations) {
    for (const form of Object.values(table.forms)) forms.add(form.toLowerCase());
    for (const list of Object.values(table.variants)) for (const form of list) forms.add(form.toLowerCase());
  }
  formCache.set(content, forms);
  return forms;
}

const ACCENT_SWAPS: Record<string, string[]> = {
  é: ["e", "è", "ê"],
  è: ["e", "é"],
  ê: ["e", "é", "è"],
  ë: ["e"],
  à: ["a", "â"],
  â: ["a", "à"],
  î: ["i", "ï"],
  ï: ["i", "î"],
  ô: ["o"],
  û: ["u", "ù"],
  ù: ["u", "û"],
  ç: ["c"],
  ä: ["a", "ae"],
  ö: ["o", "oe"],
  ü: ["u", "ue"],
  ß: ["ss", "s"],
  e: ["é"],
  a: ["à"],
  u: ["ü"],
  o: ["ö"],
};

/** Made-up spellings of a word: accents changed, two neighbours swapped, a letter doubled or single (PRD §5.5). */
export function misspellings(lemma: string): string[] {
  const out = new Set<string>();
  const letters = [...lemma];
  letters.forEach((c, i) => {
    for (const swap of ACCENT_SWAPS[c.toLowerCase()] ?? []) out.add(letters.slice(0, i).join("") + swap + letters.slice(i + 1).join(""));
  });
  for (let i = 0; i < letters.length - 1; i++) {
    if (letters[i] === letters[i + 1] || !/\p{L}/u.test(letters[i]) || !/\p{L}/u.test(letters[i + 1])) continue;
    const copy = [...letters];
    [copy[i], copy[i + 1]] = [copy[i + 1], copy[i]];
    out.add(copy.join(""));
  }
  for (let i = 0; i < letters.length; i++) {
    if (!/\p{L}/u.test(letters[i])) continue;
    if (letters[i] === letters[i + 1]) out.add([...letters.slice(0, i), ...letters.slice(i + 1)].join(""));
    else if (letters[i] !== letters[i - 1]) out.add([...letters.slice(0, i + 1), letters[i], ...letters.slice(i + 1)].join(""));
  }
  out.delete(lemma);
  return [...out];
}

const UMLAUT: Record<string, string> = { a: "ä", o: "ö", u: "ü", A: "Ä", O: "Ö", U: "Ü" };
function umlauted(word: string): string | null {
  const au = word.lastIndexOf("au");
  const vowels = [...word].map((c, i) => (UMLAUT[c] ? i : -1)).filter((i) => i >= 0);
  if (au >= 0 && au === vowels[vowels.length - 2]) return word.slice(0, au) + "äu" + word.slice(au + 2);
  const last = vowels.at(-1);
  return last === undefined ? null : word.slice(0, last) + UMLAUT[word[last]] + word.slice(last + 1);
}

/** Plural forms made from common German patterns, the right one removed (PRD §5.5, W4c). */
export function germanPlurals(lemma: string): string[] {
  const out = new Set<string>();
  const endings = ["e", "er", "en", "n", "s", ""];
  const stem = lemma;
  for (const ending of endings) {
    out.add(stem + ending);
    const u = umlauted(stem);
    if (u) out.add(u + ending);
  }
  return [...out];
}

// ───────────────────────────── word exercises ─────────────────────────────

/** Whether the code may be built for this word at all (PRD §5.1, §5.3, §5.4). */
function wordCodeAllowed(env: BuildEnv, word: WordC, code: string): boolean {
  if (!exerciseOn(env.settings, code)) return false;
  if (word.pos === "phrase" && PHRASE_EXCLUDED.has(code)) return false;
  if (word.mastery === "recognize" && RECOGNIZE_EXCLUDED.has(code)) return false;
  return true;
}

function baseEx(env: BuildEnv, code: string, key: string, q: Question, a: AnswerSpec, extra: Partial<Ex> = {}): Ex {
  const info = exerciseDef(code);
  return {
    id: env.nextId(),
    code,
    item: key,
    step: info.step,
    time: num(env.settings, info.time),
    typed: info.typed,
    recall: info.recall,
    idk: !info.multiPair,
    audio: info.audio,
    sentenceId: null,
    targetId: null,
    listen: null,
    after: null,
    q,
    a,
    ...extra,
  };
}

const wordChoice = (word: WordC, field: "meaning" | "lemma"): Choice => ({
  id: `w${word.id}`,
  text: field === "meaning" ? word.meanings[0] : word.lemma,
  lang: field === "meaning" ? "fa" : "target",
  wordId: word.id,
});

function typedSpec(accepted: string[], opts: Partial<Extract<AnswerSpec, { kind: "type" }>> = {}): Extract<AnswerSpec, { kind: "type" }> {
  return {
    kind: "type",
    accepted,
    multi: accepted.some((item) => item.trim().includes(" ")),
    sentence: false,
    gender: null,
    noun: false,
    synonyms: [],
    first: accepted[0]?.[0] ?? "",
    transformSource: null,
    ...opts,
  };
}

/** Other published words that are the same concept or share a Persian meaning (PRD §5.6, "مترادف"). */
function synonymsOf(env: BuildEnv, word: WordC): string[] {
  const out = new Set<string>();
  for (const other of env.content.words.values()) {
    if (other.id === word.id || other.lemma.toLowerCase() === word.lemma.toLowerCase()) continue;
    if ((word.conceptId !== null && other.conceptId === word.conceptId) || meaningsOverlap(word, other)) out.add(other.lemma);
  }
  return [...out];
}

export function buildWordEx(env: BuildEnv, word: WordC, code: string): Ex | null {
  if (!wordCodeAllowed(env, word, code)) return null;
  const { content } = env;
  const lang = content.language;
  const key = itemKey("word", word.id);
  const view = wordView(word, content);
  const after = word.speak;

  switch (code) {
    case "W1a":
    case "W1b": {
      if (code === "W1b" && word.homophones.length > 0) return null;
      const wrong = wrongWords(env, word, "meaning");
      if (!wrong) return null;
      const { options, correct } = choiceSet(
        env,
        wordChoice(word, "meaning"),
        wrong.map((other) => wordChoice(other, "meaning")),
      );
      return baseEx(env, code, key, code === "W1a" ? { word: view } : {}, { kind: "choice", options, correct }, { listen: code === "W1b" ? word.speak : null, after });
    }
    case "W2a":
    case "W2b": {
      if (code === "W2b" && !word.image) return null;
      const wrong = wrongWords(env, word, "lemma");
      if (!wrong) return null;
      const { options, correct } = choiceSet(
        env,
        wordChoice(word, "lemma"),
        wrong.map((other) => wordChoice(other, "lemma")),
      );
      const q: Question = code === "W2a" ? { meaning: word.meanings[0] } : { image: word.image! };
      return baseEx(env, code, key, q, { kind: "choice", options, correct }, { after });
    }
    case "W2c": {
      if (!word.image) return null;
      const others = shuffle(
        env.rng,
        [...content.words.values()].filter((other) => other.id !== word.id && other.image && other.image !== word.image && !meaningsOverlap(word, other)),
      ).slice(0, SHAPE.wrongOptions);
      if (others.length < SHAPE.wrongOptions) return null;
      const toChoice = (item: WordC): Choice => ({ id: `w${item.id}`, text: item.meanings[0], lang: "fa", wordId: item.id, image: item.image });
      const { options, correct } = choiceSet(env, toChoice(word), others.map(toChoice));
      return baseEx(env, code, key, { word: view }, { kind: "choice", options, correct }, { after });
    }
    case "W2d": {
      const buttons = genderButtons(word, lang);
      const answer = genderAnswer(word, lang);
      if (!buttons || !answer) return null;
      const options = buttons.map((text) => ({ id: text, text, lang: "target" as const }));
      return baseEx(env, code, key, { lemma: word.lemma, meaning: word.meanings[0] }, { kind: "choice", options, correct: answer }, { after });
    }
    case "W3a": {
      const forms = realForms(content);
      const made = shuffle(
        env.rng,
        misspellings(word.lemma).filter((item) => !forms.has(item.toLowerCase())),
      ).slice(0, SHAPE.wrongOptions);
      if (made.length < SHAPE.wrongOptions) return null;
      const { options, correct } = choiceSet(
        env,
        { id: "right", text: word.lemma, lang: "target" },
        made.map((text, i) => ({ id: `m${i}`, text, lang: "target" as const })),
      );
      return baseEx(env, code, key, {}, { kind: "choice", options, correct }, { listen: word.speak, after });
    }
    case "W3b":
    case "W6a":
    case "W6b": {
      const targets = singleTargets(content.wordTargets.get(word.id)).filter((target) => code !== "W3b" || distractorsOf(target).length >= SHAPE.wrongOptions);
      const byId = new Map(targets.map((target) => [target.sentenceId, target]));
      const sentence = allowedSentences(env, word, [...byId.keys()])[0];
      if (!sentence) return null;
      const target = byId.get(sentence.id)!;
      const accepted = acceptedOf(target);
      const extra: Partial<Ex> = { sentenceId: sentence.id, targetId: target.id, after };
      if (code === "W3b") {
        const wrong = shuffle(env.rng, distractorsOf(target)).slice(0, SHAPE.wrongOptions);
        const { options, correct } = choiceSet(
          env,
          { id: "right", text: accepted[0], lang: "target" },
          wrong.map((text, i) => {
            const other = content.lemmaIndex.get(text.toLowerCase())?.find((id) => content.words.get(id)?.lemma.toLowerCase() !== word.lemma.toLowerCase());
            return { id: `d${i}`, text, lang: "target" as const, wordId: other ?? null };
          }),
        );
        const q = { sentence: sentenceView(sentence, content, { marked: target.markedText, translation: true }) };
        return baseEx(env, code, key, q, { kind: "choice", options, correct }, extra);
      }
      if (code === "W6a") {
        const q = { sentence: sentenceView(sentence, content, { marked: target.markedText, translation: true, firstLetters: true }) };
        return baseEx(env, code, key, q, typedSpec(accepted, { synonyms: synonymsOf(env, word) }), extra);
      }
      const q = { sentence: sentenceView(sentence, content, { marked: target.markedText, translation: false }) };
      return baseEx(env, code, key, q, typedSpec(accepted), { ...extra, listen: sentence.speak });
    }
    case "W3c": {
      const sentence = allowedSentences(env, word, content.wordSentences.get(word.id) ?? [])[0];
      if (!sentence) return null;
      const length = sentence.translationFa.length;
      const ceiling = levelIndex(content, sentence.level);
      const others = shuffle(
        env.rng,
        [...content.sentences.values()].filter(
          (other) =>
            other.bank &&
            other.id !== sentence.id &&
            other.translationFa !== sentence.translationFa &&
            levelIndex(content, other.level) <= ceiling &&
            !other.tokens.some((token) => token.wordId === word.id) &&
            Math.abs(other.translationFa.length - length) <= SHAPE.translationLength * length,
        ),
      );
      const wrong: SentenceC[] = [];
      for (const other of others) if (wrong.length < SHAPE.wrongOptions && !wrong.some((item) => item.translationFa === other.translationFa)) wrong.push(other);
      if (wrong.length < SHAPE.wrongOptions) return null;
      const { options, correct } = choiceSet(
        env,
        { id: `s${sentence.id}`, text: sentence.translationFa, lang: "fa" },
        wrong.map((other) => ({ id: `s${other.id}`, text: other.translationFa, lang: "fa" as const })),
      );
      const q = { sentence: sentenceView(sentence, content, { translation: false }) };
      return baseEx(env, code, key, q, { kind: "choice", options, correct }, { sentenceId: sentence.id, after });
    }
    case "W3d": {
      const companions: WordC[] = [];
      for (const id of shuffle(env.rng, [...env.introduced])) {
        const other = content.words.get(id);
        if (!other || other.id === word.id || companions.length >= SHAPE.pairCompanions) continue;
        if (other.lemma.toLowerCase() === word.lemma.toLowerCase() || meaningsOverlap(word, other)) continue;
        if (companions.some((item) => item.lemma.toLowerCase() === other.lemma.toLowerCase() || meaningsOverlap(item, other))) continue;
        companions.push(other);
      }
      if (companions.length < SHAPE.pairCompanions) return null;
      const group = [word, ...companions];
      const left = shuffle(env.rng, group).map((item) => wordChoice(item, "lemma"));
      const right = shuffle(env.rng, group).map((item) => ({ ...wordChoice(item, "meaning"), id: `m${item.id}` }));
      const pairs = Object.fromEntries(group.map((item) => [`w${item.id}`, `m${item.id}`]));
      return baseEx(env, code, key, {}, { kind: "pairs", left, right, pairs, target: `w${word.id}` }, { after });
    }
    case "W4a": {
      const letters = [...word.lemma];
      if (letters.length < SHAPE.minLetters || /\s/.test(word.lemma)) return null;
      let scrambled = shuffle(env.rng, letters);
      for (let tries = 0; scrambled.join("") === word.lemma && tries < SHAPE.shuffleTries; tries++) scrambled = shuffle(env.rng, letters);
      if (scrambled.join("") === word.lemma) return null;
      return baseEx(env, code, key, { meaning: word.meanings[0], letters: scrambled }, { kind: "tiles", tiles: scrambled, orders: [letters] }, { after });
    }
    case "W4b": {
      const letters = [...word.lemma];
      if (letters.length < SHAPE.minLetters) return null;
      const hideable = letters.map((c, i) => (i > 0 && /\p{L}/u.test(c) ? i : -1)).filter((i) => i > 0);
      const wanted = Math.round(num(env.settings, "w4b.hide_ratio") * letters.length);
      const count = Math.min(SHAPE.w4bMaxHidden, Math.max(SHAPE.w4bMinHidden, wanted), hideable.length);
      if (count < SHAPE.w4bMinHidden) return null;
      const hidden = shuffle(env.rng, hideable)
        .slice(0, count)
        .sort((a, b) => a - b);
      const pattern = letters.map((c, i) => (hidden.includes(i) ? null : c));
      return baseEx(env, code, key, { pattern }, { kind: "letters", word: word.lemma, hidden }, { listen: word.speak, after });
    }
    case "W4c": {
      if (lang !== "de" || word.pos !== "noun" || !word.plural || word.number === "pl_only") return null;
      const made = shuffle(
        env.rng,
        germanPlurals(word.lemma).filter((item) => item !== word.plural),
      ).slice(0, SHAPE.wrongOptions);
      if (made.length < SHAPE.wrongOptions) return null;
      const { options, correct } = choiceSet(
        env,
        { id: "right", text: `die ${word.plural}`, lang: "target" },
        made.map((text, i) => ({ id: `p${i}`, text: `die ${text}`, lang: "target" as const })),
      );
      return baseEx(env, code, key, { lemma: `${nounArticle(word, lang)} ${word.lemma}`, meaning: word.meanings[0] }, { kind: "choice", options, correct }, { after });
    }
    case "W5a": {
      const buttons = genderButtons(word, lang);
      const spec = typedSpec([word.lemma], {
        noun: word.pos === "noun",
        sentence: word.pos === "phrase",
        gender: buttons ? { buttons, correct: genderAnswer(word, lang)! } : null,
        synonyms: synonymsOf(env, word),
      });
      return baseEx(env, code, key, { meaning: word.meanings[0] }, spec, { after });
    }
    case "W5b": {
      if (word.homophones.length > 0) return null;
      return baseEx(env, code, key, {}, typedSpec([word.lemma], { noun: word.pos === "noun", sentence: word.pos === "phrase" }), { listen: word.speak, after });
    }
  }
  return null;
}

/** A colloquial word's two exercises (PRD §5.4). */
export function buildColloquialEx(env: BuildEnv, word: WordC, code: string): Ex | null {
  const standard = [...env.content.words.values()].find((other) => other.id !== word.id && other.conceptId !== null && other.conceptId === word.conceptId && hasCard(other));
  if (!standard) return null;
  const key = itemKey("word", word.id);
  const q: Question = { meaning: word.meanings[0], standard: displayWord(standard, env.content.language) };
  if (code === "K1") {
    const wrong = shuffle(
      env.rng,
      [...env.content.words.values()].filter((other) => other.id !== word.id && other.id !== standard.id && other.lemma !== word.lemma && !meaningsOverlap(word, other)),
    ).slice(0, SHAPE.wrongOptions);
    if (wrong.length < SHAPE.wrongOptions) return null;
    const { options, correct } = choiceSet(
      env,
      wordChoice(word, "lemma"),
      wrong.map((other) => wordChoice(other, "lemma")),
    );
    return baseEx(env, code, key, q, { kind: "choice", options, correct }, { after: word.speak });
  }
  if (code === "K2") return baseEx(env, code, key, q, typedSpec([word.lemma], { noun: word.pos === "noun" }), { after: word.speak });
  return null;
}

// ───────────────────────────── conjugation ─────────────────────────────

export function buildConjEx(env: BuildEnv, table: ConjC, code: string): Ex | null {
  if (!exerciseOn(env.settings, code)) return null;
  const { content } = env;
  const verb = content.words.get(table.wordId);
  if (!verb) return null;
  const pronouns = PRONOUNS[content.language].filter((item) => table.forms[item.key]);
  if (pronouns.length < SHAPE.persons) return null;
  const key = itemKey("conjugation", table.id);
  const accepted = (pronoun: string) => [table.forms[pronoun], ...(table.variants[pronoun] ?? [])];
  const base: Question = { verb: verb.lemma, tense: table.tense };
  const otherForms = () => {
    const own = new Set(Object.values(table.forms));
    const out = new Set<string>();
    for (const other of content.conjugations)
      if (other.wordId === table.wordId && other.id !== table.id) for (const form of Object.values(other.forms)) if (!own.has(form)) out.add(form);
    return shuffle(env.rng, [...out]);
  };
  const pick = shuffle(env.rng, pronouns)[0];

  switch (code) {
    case "C1": {
      const right = table.forms[pick.key];
      const wrong = [...new Set([...shuffle(env.rng, Object.values(table.forms)), ...otherForms()])].filter((form) => form !== right).slice(0, SHAPE.wrongOptions);
      if (wrong.length < SHAPE.wrongOptions) return null;
      const { options, correct } = choiceSet(
        env,
        { id: "right", text: right, lang: "target" },
        wrong.map((text, i) => ({ id: `f${i}`, text, lang: "target" as const })),
      );
      return baseEx(env, code, key, { ...base, pronoun: pick.label }, { kind: "choice", options, correct });
    }
    case "C2": {
      const empty = new Set(
        shuffle(env.rng, pronouns)
          .slice(0, SHAPE.c2EmptyRows)
          .map((item) => item.key),
      );
      const rows = pronouns.map((item) => ({ pronoun: item.label, accepted: empty.has(item.key) ? [table.forms[item.key]] : null }));
      const bank = shuffle(env.rng, [...pronouns.filter((item) => empty.has(item.key)).map((item) => table.forms[item.key]), ...otherForms().slice(0, SHAPE.c2ExtraForms)]);
      const q = { ...base, rows: pronouns.map((item) => ({ pronoun: item.label, given: empty.has(item.key) ? null : table.forms[item.key] })) };
      return baseEx(env, code, key, q, { kind: "table", rows, bank });
    }
    case "C3":
      return baseEx(env, code, key, { ...base, pronoun: pick.label }, typedSpec(accepted(pick.key)));
    case "C4": {
      const rows = pronouns.map((item) => ({ pronoun: item.label, accepted: accepted(item.key) }));
      return baseEx(env, code, key, { ...base, rows: pronouns.map((item) => ({ pronoun: item.label, given: null })) }, { kind: "table", rows, bank: null });
    }
  }
  return null;
}

// ───────────────────────────── grammar ─────────────────────────────

/** Words of a sentence as tiles (PRD §6.5): no punctuation, elided words on their own tile. */
export function tileWords(text: string): string[] {
  return text
    .replace(/[.,;:!?«»"()“”„…]/g, " ")
    .replace(/[’]/g, "'")
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      const parts = word.split(/(?<=')/);
      return parts.filter(Boolean);
    });
}

/** Tiles are lower case, except German nouns and names, so the first word's capital does not give it away. */
function tileCase(sentence: SentenceC, content: Content): (tile: string) => string {
  const keep = new Set<string>();
  for (const token of sentence.tokens) {
    const word = token.wordId !== null ? content.words.get(token.wordId) : undefined;
    if (token.kind === "name" || (content.language === "de" && word?.pos === "noun")) keep.add(token.surface);
  }
  return (tile) => (keep.has(tile) ? tile : tile.toLowerCase());
}

export type GrammarSource = { target: TargetC } | { transform: TransformC } | { translate: TranslateC } | { sets: true };

/** The source a grammar code needs, or null (PRD §6.5, the "نیاز" column). */
export function grammarCodeFits(env: BuildEnv, code: string, source: GrammarSource, unit: UnitC): boolean {
  if (!exerciseOn(env.settings, code)) return false;
  if ("transform" in source) return code === "G6";
  if ("translate" in source) return code === "G6b";
  if ("sets" in source) return code === "G3a" && !!unit.categorySets && unit.categorySets.length >= 2;
  const target = source.target;
  const one = target.blanks === 1;
  switch (code) {
    case "G1a":
    case "G1b":
    case "G2a":
      return one && distractorsOf(target).length >= SHAPE.wrongOptions;
    case "G2c":
      return one && distractorsOf(target).length >= SHAPE.g2Wrong;
    case "G2b":
      return one ? distractorsOf(target).length >= SHAPE.g2Wrong : (target.distractors as string[][]).every((list) => list.length >= SHAPE.g2Wrong);
    case "G3b":
      return !one && (target.distractors as string[][]).every((list) => list.length >= SHAPE.wrongOptions);
    case "G3c": {
      const sentence = env.content.sentences.get(target.sentenceId);
      return one && distractorsOf(target).length >= SHAPE.wrongOptions && !!sentence && knownShare(sentence, env.known, null) >= num(env.settings, "known.threshold");
    }
    case "G4a":
    case "G4b":
      return true;
    case "G5a":
      return one && !!target.hint;
    case "G5b":
      return one;
  }
  return false;
}

/** Whether the learner knows enough of the sentence to read it without the translation. */
const readable = (env: BuildEnv, sentence: SentenceC) => knownShare(sentence, env.known, null) >= num(env.settings, "known.threshold");

export function buildGrammarEx(env: BuildEnv, unit: UnitC, code: string, source: GrammarSource): Ex | null {
  if (!grammarCodeFits(env, code, source, unit)) return null;
  const { content } = env;
  const key = itemKey("grammar_unit", unit.id);

  if ("transform" in source) {
    const item = source.transform;
    return baseEx(env, code, key, { instruction: item.instructionFa, source: item.source }, typedSpec(item.outputs, { multi: true, sentence: true, transformSource: item.source }));
  }
  if ("translate" in source) {
    const item = source.translate;
    return baseEx(env, code, key, { promptFa: item.promptFa }, typedSpec(item.outputs, { multi: true, sentence: true }));
  }
  if ("sets" in source) {
    const sets = unit.categorySets!;
    const items = shuffle(
      env.rng,
      sets.flatMap((set, index) => set.items.map((text, i) => ({ id: `${index}-${i}`, text, set: index }))),
    );
    return baseEx(env, code, key, { sets: sets.map((set) => set.name) }, { kind: "sort", items });
  }

  const target = source.target;
  const sentence = content.sentences.get(target.sentenceId);
  if (!sentence) return null;
  const extra: Partial<Ex> = { sentenceId: sentence.id, targetId: target.id };
  const translation = !readable(env, sentence) || !["G1b", "G3c"].includes(code);
  const view = (marked?: string, withTranslation = translation) => sentenceView(sentence, content, { marked, translation: withTranslation });

  if (target.blanks === 2) {
    const accepted = target.accepted as string[][];
    const distractors = target.distractors as string[][];
    if (code === "G3b") {
      const groups = [0, 1].map((blank) =>
        shuffle(env.rng, [
          { id: `a${blank}`, text: accepted[blank][0], lang: "target" as const },
          ...shuffle(env.rng, distractors[blank])
            .slice(0, SHAPE.wrongOptions)
            .map((text, i) => ({ id: `d${blank}-${i}`, text, lang: "target" as const })),
        ]),
      ) as [Choice[], Choice[]];
      return baseEx(env, code, key, { sentence: view(target.markedText) }, { kind: "choice2", groups, correct: ["a0", "a1"] }, extra);
    }
    if (code === "G2b") {
      const right = sentence.text;
      const wrong = Array.from({ length: SHAPE.g2Wrong }, (_, i) => fillBlanks(target.markedText, [distractors[0][i], distractors[1][i]]));
      const { options, correct } = choiceSet(
        env,
        { id: "right", text: right, lang: "target" },
        wrong.map((text, i) => ({ id: `s${i}`, text, lang: "target" as const })),
      );
      return baseEx(env, code, key, {}, { kind: "choice", options, correct }, { ...extra, listen: sentence.speak });
    }
    if (code === "G4a" || code === "G4b") return tilesEx(env, code, key, unit, sentence, target, extra);
    return null;
  }

  const accepted = acceptedOf(target);
  const distractors = distractorsOf(target);
  const wrongFill = (text: string) => fillBlanks(target.markedText, [text]);
  switch (code) {
    case "G1a":
    case "G3c": {
      const { options, correct } = choiceSet(
        env,
        { id: "right", text: accepted[0], lang: "target" },
        shuffle(env.rng, distractors)
          .slice(0, SHAPE.wrongOptions)
          .map((text, i) => ({ id: `d${i}`, text, lang: "target" as const })),
      );
      return baseEx(env, code, key, { sentence: view(target.markedText, code === "G1a" ? true : translation) }, { kind: "choice", options, correct }, extra);
    }
    case "G1b":
    case "G2b":
    case "G2c": {
      const count = code === "G1b" ? SHAPE.g1bWrong : SHAPE.g2Wrong;
      const { options, correct } = choiceSet(
        env,
        { id: "right", text: sentence.text, lang: "target" },
        shuffle(env.rng, distractors)
          .slice(0, count)
          .map((text, i) => ({ id: `s${i}`, text: wrongFill(text), lang: "target" as const })),
      );
      if (code === "G2b") return baseEx(env, code, key, {}, { kind: "choice", options, correct }, { ...extra, listen: sentence.speak });
      const q: Question = code === "G2c" || translation ? { translation: sentence.translationFa } : {};
      return baseEx(env, code, key, q, { kind: "choice", options, correct }, extra);
    }
    case "G2a": {
      const wrong = shuffle(env.rng, distractors)[0];
      const parts: { id: string; text: string }[] = [];
      let last = 0;
      for (const match of target.markedText.matchAll(BLANK)) {
        const before = target.markedText.slice(last, match.index);
        before
          .split(/(\s+)/)
          .filter(Boolean)
          .forEach((text) => parts.push({ id: `p${parts.length}`, text }));
        parts.push({ id: "wrong", text: wrong });
        last = match.index + match[0].length;
      }
      target.markedText
        .slice(last)
        .split(/(\s+)/)
        .filter(Boolean)
        .forEach((text) => parts.push({ id: `p${parts.length}`, text }));
      return baseEx(env, code, key, { translation: sentence.translationFa }, { kind: "spot", parts, correct: "wrong" }, extra);
    }
    case "G4a":
    case "G4b":
      return tilesEx(env, code, key, unit, sentence, target, extra);
    case "G5a":
      return baseEx(env, code, key, { sentence: view(target.markedText, true), hint: target.hint! }, typedSpec(accepted), extra);
    case "G5b":
      return baseEx(env, code, key, { sentence: view(target.markedText, true) }, typedSpec(accepted), extra);
  }
  return null;
}

function tilesEx(env: BuildEnv, code: string, key: string, unit: UnitC, sentence: SentenceC, target: TargetC, extra: Partial<Ex>): Ex | null {
  const cased = tileCase(sentence, env.content);
  const order = tileWords(sentence.text).map(cased);
  if (order.length < 2) return null;
  const orders = [order, ...(target.acceptedFull ?? []).map((text) => tileWords(text).map(cased))];
  const tiles = [...order];
  if (code === "G4a") {
    const firsts = (target.blanks === 1 ? (target.distractors as string[]) : (target.distractors as string[][]).map((list) => list[0]))
      .slice(0, SHAPE.g4aExtraTiles)
      .map((text) => cased(tileWords(text)[0] ?? ""))
      .filter((tile) => tile && !order.includes(tile));
    tiles.push(...new Set(firsts));
  }
  let shuffled = shuffle(env.rng, tiles);
  for (let tries = 0; shuffled.join(" ") === order.join(" ") && tries < SHAPE.shuffleTries; tries++) shuffled = shuffle(env.rng, tiles);
  const q: Question = code === "G4a" ? { translation: sentence.translationFa } : {};
  void unit;
  return baseEx(env, code, key, q, { kind: "tiles", tiles: shuffled, orders }, { ...extra, listen: code === "G4b" ? sentence.speak : null });
}

/** One of the three two-option warm-ups after the lesson (G0, PRD §6.5); never scored. */
export function buildG0(env: BuildEnv, unit: UnitC, target: TargetC): Ex | null {
  if (target.blanks !== 1) return null;
  const sentence = env.content.sentences.get(target.sentenceId);
  const wrong = distractorsOf(target)[0];
  if (!sentence || !wrong) return null;
  const { options, correct } = choiceSet(env, { id: "right", text: acceptedOf(target)[0], lang: "target" }, [{ id: "d0", text: wrong, lang: "target" }]);
  return {
    id: env.nextId(),
    code: "G0",
    item: itemKey("grammar_unit", unit.id),
    step: 0,
    time: num(env.settings, "time.g0"),
    typed: false,
    recall: false,
    idk: false,
    audio: false,
    sentenceId: sentence.id,
    targetId: target.id,
    listen: null,
    after: null,
    q: { sentence: sentenceView(sentence, env.content, { marked: target.markedText, translation: true }) },
    a: { kind: "choice", options, correct },
  };
}

export const sentenceViewOf = sentenceView;

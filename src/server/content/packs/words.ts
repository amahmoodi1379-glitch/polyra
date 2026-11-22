import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fold } from "@/engine/tokens";
import { wordRecord, type WordRecord } from "@/schemas/words";
import { repeatedWord } from "../codes";
import { levelRank, type LanguageCode } from "../languages";
import { lexiconFlags, lexiconSpelling, nounLexicon } from "../lexicon";
import { describeProblem, zodProblems, type Problem } from "../problems";
import { checkWord } from "../word-rules";

/**
 * The word lists Claude writes for every level (owner, 18 Nov 2026; format in content/README.md):
 * `content/<language>/words/<LEVEL>.tsv`, one word per line in teaching order. Read here without a
 * database, so the checker script and the loader at server start share every rule, and every rule of
 * the panel's own word import (`wordRecord`, `checkWord`, the open lexicons) applies.
 */

export const PACK_LEVELS = ["A1", "A2", "B1", "B2"] as const;

/**
 * Topics of the word lists (CEFR themes, Council of Europe 2001 §4.1). A word's topic places it in a
 * theme of its level and gives the wrong options of its fill-the-gap sentences: words of the same topic
 * and part of speech are plausible, so the learner has to know the meaning.
 */
export const TOPICS = [
  "function", // articles, pronouns, prepositions, conjunctions, auxiliaries, question words
  "people", // person, name, age, nationality, identity
  "family",
  "body",
  "health",
  "food",
  "drink",
  "home", // house, rooms, furniture, household things
  "city", // places and buildings in town
  "transport",
  "travel", // holidays, hotel, luggage, countries
  "shopping", // shops, money, prices
  "clothes",
  "work",
  "education",
  "time", // days, months, seasons, clock, frequency
  "numbers", // numbers, quantities, measures
  "colors",
  "weather",
  "nature", // landscape, plants, environment
  "animals",
  "leisure", // hobbies, sport, music, games
  "media", // phone, internet, letters, press
  "feelings",
  "character", // personality and appearance
  "actions", // everyday verbs with no other topic
  "qualities", // general adjectives and adverbs (big, new, good, fast)
  "space", // position, direction, distance
  "abstract", // thinking, opinion, discourse, logic
  "society", // politics, law, history, religion
  "economy",
  "science", // science and technology
  "culture", // art, literature, film
] as const;
export type Topic = (typeof TOPICS)[number];

/** Columns every line has, in this order; empty cells are allowed where the field is optional. */
export const FIXED_COLUMNS = ["lemma", "pos", "gender", "plural", "meaning_fa", "concept_fa", "topic"] as const;
/** Optional `key:value` cells after the fixed ones. */
export const OPTIONAL_KEYS = ["code", "number", "sense_of", "register", "mastery", "no_card", "family", "parts", "homophones", "note", "coll", "checked"] as const;
/** Warnings a line may mark as checked by hand (`checked:gender,level`), with the reason in a commit or note. */
const CHECKABLE: Record<string, string> = { lexiconGender: "gender", lexiconPlural: "plural", levelRare: "level", levelCommon: "level" };

export type PackFile = { level: string; file: string; text: string };
export type PackNote = { file: string; line: number; lemma: string; text: string };
export type PackWord = { file: string; line: number; level: string; order: number; topic: Topic; checked: string[]; rank: number | null; word: WordRecord };
export type WordPack = { words: PackWord[]; errors: PackNote[]; warnings: PackNote[] };

const optionalKeys = new Set<string>(OPTIONAL_KEYS);
const topics = new Set<string>(TOPICS);

/** The frequency rank of each lemma or form (data/frequency, 1 = most frequent), lower case. */
export function frequencyRanks(language: string, root = process.cwd()): Map<string, number> {
  const ranks = new Map<string, number>();
  let rank = 0;
  for (const line of readFileSync(join(root, "data", "frequency", `${language}.txt`), "utf8").split("\n")) {
    const item = line.trim();
    if (!item || item.startsWith("#")) continue;
    rank++;
    if (!ranks.has(item.toLowerCase())) ranks.set(item.toLowerCase(), rank);
  }
  return ranks;
}

/** A lemma's frequency rank, also when the list spells œ and æ as oe and ae (Lexique: oeil, coeur). */
export function rankOf(ranks: Map<string, number>, lemma: string): number | null {
  const key = lemma.toLowerCase();
  return ranks.get(key) ?? ranks.get(lexiconSpelling(key)) ?? null;
}

/**
 * The frequency-list lemmas a taught word covers, for the coverage report: its lemma, the Lexique spelling
 * (œ as oe) and, for a reflexive verb, the verb without its pronoun («se lever» covers «lever»).
 */
export function coveredLemmas(word: Pick<WordRecord, "lemma" | "pos">): string[] {
  const lemma = word.lemma.toLowerCase();
  const forms = [lemma];
  if (word.pos === "verb") {
    const bare = lemma.replace(/^(se |s'|s’|sich )/, "");
    if (bare !== lemma) forms.push(bare);
  }
  return [...new Set(forms.flatMap((form) => [form, lexiconSpelling(form)]))];
}

/** The word files of a language that exist, lowest level first. */
export function readWordFiles(language: string, root = process.cwd()): PackFile[] {
  const files: PackFile[] = [];
  for (const level of PACK_LEVELS) {
    const file = join("content", language, "words", `${level}.tsv`);
    try {
      files.push({ level, file, text: readFileSync(join(root, file), "utf8") });
    } catch {
      // A level not written yet.
    }
  }
  return files;
}

const split = (value: string | undefined, by: RegExp) => (value ? value.split(by).map((item) => item.trim()).filter(Boolean) : []);

/** One line's cells as a P-W record (`wordRecord`'s input), plus its topic and checked flags. */
function lineRecord(cells: string[], level: string): { record: Record<string, unknown>; topic: string; checked: string[]; problems: string[] } {
  const problems: string[] = [];
  const [lemma, pos, gender, plural, meaning, concept, topic] = FIXED_COLUMNS.map((_, index) => (cells[index] ?? "").trim());
  const more = new Map<string, string>();
  for (const cell of cells.slice(FIXED_COLUMNS.length)) {
    if (!cell.trim()) continue;
    const at = cell.indexOf(":");
    const key = at > 0 ? cell.slice(0, at).trim() : "";
    if (!optionalKeys.has(key)) problems.push(`unknown cell «${cell.trim()}» (keys: ${OPTIONAL_KEYS.join(", ")})`);
    else if (more.has(key)) problems.push(`cell ${key} given twice`);
    else more.set(key, cell.slice(at + 1).trim());
  }
  const collocations = split(more.get("coll"), /;/).map((pair) => {
    const [text, translation] = pair.split("→").map((part) => part.trim());
    return { text, translation_fa: translation ?? "" };
  });
  const noCard = more.get("no_card");
  if (noCard !== undefined && noCard !== "1") problems.push("no_card is written no_card:1");
  const record = {
    code: more.get("code") || lemma,
    lemma,
    pos,
    gender: gender || null,
    number: more.get("number") || null,
    plural: plural || null,
    meaning_fa: meaning,
    level,
    register: more.get("register") || null,
    concept_fa: concept,
    no_card: noCard === "1",
    homophones: split(more.get("homophones"), /,/),
    note_fa: more.get("note") || null,
    mastery: more.get("mastery") || null,
    sense_of: more.get("sense_of") || null,
    parts: more.has("parts") ? split(more.get("parts"), /\s+/) : null,
    family: more.get("family") || null,
    collocations,
  };
  return { record, topic, checked: split(more.get("checked"), /,/), problems };
}

/**
 * Reads and checks every level of one language. Errors stop the loader; warnings are for the author to
 * look at (and mark `checked:` when the word is right after all).
 */
export function checkWordPack(language: LanguageCode, files: PackFile[], ranks: Map<string, number>, lexicon = nounLexicon(language)): WordPack {
  const words: PackWord[] = [];
  const errors: PackNote[] = [];
  const warnings: PackNote[] = [];
  const say = (list: PackNote[], at: { file: string; line: number }, lemma: string, text: string) => list.push({ file: at.file, line: at.line, lemma, text });
  const describe = (problems: Problem[]) => problems.map((item) => describeProblem(item, "chatbot"));

  for (const { level, file, text } of files) {
    let order = 0;
    for (const [index, raw] of text.split("\n").entries()) {
      const at = { file, line: index + 1 };
      const line = raw.replace(/\r$/, "");
      if (!line.trim() || line.startsWith("#") || line.startsWith("lemma\t")) continue;
      const cells = line.split("\t");
      const lemma = cells[0]?.trim() ?? "";
      if (cells.length < FIXED_COLUMNS.length) {
        say(errors, at, lemma, `needs ${FIXED_COLUMNS.length} tab-separated columns (${FIXED_COLUMNS.join(", ")}), has ${cells.length}`);
        continue;
      }
      const { record, topic, checked, problems } = lineRecord(cells, level);
      for (const text of problems) say(errors, at, lemma, text);
      if (!topics.has(topic)) say(errors, at, lemma, `unknown topic «${topic}»`);
      const parsed = wordRecord.safeParse(record, { reportInput: true });
      if (!parsed.success) {
        for (const text of describe(zodProblems(parsed.error))) say(errors, at, lemma, text);
        continue;
      }
      const word = parsed.data;
      for (const text of describe(checkWord(word, language))) say(errors, at, lemma, text);
      if (word.collocations.some((item) => !item.text || !item.translation_fa)) say(errors, at, lemma, "a collocation is written «text → ترجمه»");
      const rank = word.pos === "phrase" || /\s/.test(word.lemma) ? null : rankOf(ranks, word.lemma);
      words.push({ file, line: at.line, level, order: ++order, topic: topic as Topic, checked, rank, word });
    }
  }

  // Across the whole language: codes, repeats, references and the colloquial rule.
  const byCode = new Map<string, PackWord>();
  for (const item of words) {
    const other = byCode.get(item.word.code);
    if (other) say(errors, item, item.word.lemma, `code «${item.word.code}» is also on ${other.file}:${other.line}; give one of them code:… (livre-m, glace-2)`);
    else byCode.set(item.word.code, item);
  }
  const seen: (WordRecord & { at: PackWord })[] = [];
  for (const item of words) {
    const { word } = item;
    const twin = repeatedWord(
      seen.map((entry) => ({ ...entry, status: "draft" })),
      word,
    );
    if (twin && !word.sense_of && fold(word.code) === fold(word.lemma)) {
      say(errors, item, word.lemma, `repeats ${twin.at.file}:${twin.at.line}; a second sense needs code:${word.lemma}-2 and sense_of:${twin.code}`);
    }
    seen.push({ ...word, at: item });
    const above = (code: string) => {
      const target = byCode.get(code);
      return !target ? "unknown" : levelRank(target.level) > levelRank(item.level) ? "higher" : null;
    };
    for (const code of word.parts ?? []) {
      const problem = above(code);
      if (problem) say(errors, item, word.lemma, `part «${code}» is ${problem === "unknown" ? "not in the lists" : "of a higher level"}`);
    }
    if (word.sense_of) {
      const base = byCode.get(word.sense_of);
      if (!base || fold(base.word.lemma) !== fold(word.lemma)) say(errors, item, word.lemma, `sense_of «${word.sense_of}» is not a word with this lemma`);
      else if (levelRank(base.level) > levelRank(item.level)) say(errors, item, word.lemma, `sense_of «${word.sense_of}» is of a higher level`);
    }
  }
  const standard = new Set(words.filter((item) => item.word.register === "standard" || item.word.register === "formal").map((item) => item.word.concept_fa));
  for (const item of words) {
    if ((item.word.register === "familier" || item.word.register === "argot") && !standard.has(item.word.concept_fa)) {
      say(errors, item, item.word.lemma, `colloquial word without a standard word of concept «${item.word.concept_fa}»`);
    }
  }

  // Second opinions: gender and plural against the open lexicon, level against the frequency rank.
  for (const item of words) {
    for (const flag of lexiconFlags(item.word, language, item.rank, lexicon)) {
      if (item.checked.includes(CHECKABLE[flag.key] ?? flag.key)) continue;
      say(warnings, item, item.word.lemma, `${describeProblem(flag, "chatbot")} (checked:${CHECKABLE[flag.key] ?? flag.key} if right)`);
    }
  }
  return { words, errors, warnings };
}

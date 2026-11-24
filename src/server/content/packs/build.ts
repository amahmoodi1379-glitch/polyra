import { buildTexts, type TextSource } from "./texts";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isCardRegister } from "@/engine/content";
import { appSettingDefaults } from "@/server/settings/app-catalog";
import { levelRank, type LanguageCode } from "../languages";
import { Analyzer } from "./analyze";
import { buildGrammar, type GrammarUnitSource } from "./grammar";
import { Morph } from "./morph";
import { buildSentences, type SentenceRecord } from "./sentences";
import { buildTables, type PackTable } from "./tables";
import { checkWordPack, frequencyRanks, PACK_LEVELS, readWordFiles, type PackWord } from "./words";

/**
 * A language's whole content pack, built from `content/<language>/` without a database (owner, 18 Nov
 * 2026: Claude writes all content; format in content/README.md). The checker script and the loader at
 * server start share it: what the checker passes is what the server loads.
 */

/** The first card words of a language make sentences only from each other (PRD §14.9; as `firstWordIds`). */
const FIRST_WORDS = 30;

export type Note = { file: string; line: number; text: string };
export type Exception = { code: string; surface: string };
export type PackLevel = {
  level: string;
  words: PackWord[];
  units: GrammarUnitSource[];
  tables: PackTable[];
  sentences: SentenceRecord[];
  exceptions: Exception[];
  texts: TextSource[];
};
export type Pack = { language: LanguageCode; levels: PackLevel[]; words: PackWord[]; errors: Note[]; warnings: Note[]; notes: Note[] };

/** A short, stable fingerprint of an item as loaded. */
export const hashOf = (value: unknown) => createHash("sha1").update(JSON.stringify(value)).digest("hex").slice(0, 16);

/** The text files of a folder in name order (`grammar/A1/01-etre.txt`, …); none when it does not exist. */
function folder(root: string, path: string): { file: string; text: string }[] {
  let names: string[];
  try {
    names = readdirSync(join(root, path)).filter((name) => name.endsWith(".txt")).sort();
  } catch {
    return [];
  }
  return names.map((name) => ({ file: join(path, name), text: readFileSync(join(root, path, name), "utf8") }));
}

/** Names that may stand in sentences as names (`content/<language>/names.txt`, one per line). */
function readNames(root: string, language: string): Set<string> {
  try {
    const text = readFileSync(join(root, "content", language, "names.txt"), "utf8");
    return new Set(text.split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#")));
  } catch {
    return new Set();
  }
}

export type BuildOptions = {
  /** Where `data/` and `node_modules/` are (the open lexicons and conjugation data). */
  root?: string;
  /** Where `content/` is; the root unless a test brings its own pack. */
  contentRoot?: string;
  /** `conjugation.tenses.<language>`; the default setting when there is no database. */
  tenses?: Record<string, string[]>;
  /** Only these levels (the language's `levels.<language>`). */
  levels?: string[];
};

export function buildPack(language: LanguageCode, options: BuildOptions = {}): Pack {
  const root = options.root ?? process.cwd();
  const contentRoot = options.contentRoot ?? root;
  const tenses = options.tenses ?? (appSettingDefaults[`conjugation.tenses.${language}`] as Record<string, string[]>);
  const levels = PACK_LEVELS.filter((level) => !options.levels || options.levels.includes(level));
  const wordPack = checkWordPack(language, readWordFiles(language, contentRoot).filter((file) => levels.includes(file.level as (typeof levels)[number])), frequencyRanks(language, root));
  const words = wordPack.words;
  const pack: Pack = {
    language,
    levels: [],
    words,
    errors: wordPack.errors.map(({ file, line, lemma, text }) => ({ file, line, text: `${lemma}: ${text}` })),
    warnings: wordPack.warnings.map(({ file, line, lemma, text }) => ({ file, line, text: `${lemma}: ${text}` })),
    notes: [],
  };
  if (words.length === 0) return pack;

  const morph = new Morph(language, words, root);
  const analyzer = new Analyzer(language, words, morph, readNames(contentRoot, language));
  const firstWords = new Set(
    words
      .filter((item) => !item.word.no_card && isCardRegister(item.word.register))
      .sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.order - b.order)
      .slice(0, FIRST_WORDS),
  );

  const built = levels.map((level) => {
    const grammar = buildGrammar(analyzer, folder(contentRoot, join("content", language, "grammar", level)), level);
    const sentences = buildSentences(analyzer, folder(contentRoot, join("content", language, "sentences", level)), level, firstWords);
    const texts = buildTexts(analyzer, folder(contentRoot, join("content", language, "texts", level)), level);
    pack.errors.push(...grammar.errors, ...sentences.errors, ...texts.errors);
    pack.notes.push(...grammar.notes, ...sentences.notes, ...texts.notes);
    return { level, grammar, sentences, texts };
  });

  // Unit codes are unique across the language.
  const seen = new Map<string, string>();
  for (const { grammar } of built) {
    for (const unit of grammar.units) {
      const other = seen.get(unit.listItem.unit_code);
      if (other) pack.errors.push({ file: unit.file, line: 1, text: `code «${unit.listItem.unit_code}» is also the code of ${other}` });
      seen.set(unit.listItem.unit_code, unit.file);
    }
  }

  const unitTables = built.flatMap(({ grammar }) => grammar.units.map((unit) => ({ unit_code: unit.listItem.unit_code, level: unit.level, order: unit.order, file: unit.file, tables: unit.tables })));
  const tables = buildTables(language, words, tenses, unitTables, root);
  pack.errors.push(...tables.errors);
  pack.warnings.push(...tables.warnings);
  pack.notes.push(...tables.notes);

  const unique = (list: Exception[]) => [...new Map(list.map((item) => [`${item.code}|${item.surface}`, item])).values()];
  for (const { level, grammar, sentences, texts } of built) {
    pack.levels.push({
      level,
      words: words.filter((item) => item.level === level),
      units: grammar.units,
      tables: tables.tables.filter((table) => table.level === level),
      sentences: sentences.records,
      exceptions: unique([...grammar.exceptions, ...sentences.exceptions, ...texts.exceptions]),
      texts: texts.texts,
    });
  }
  return pack;
}

/** Counts for the checker's report. */
export function packSummary(pack: Pack) {
  return pack.levels.map((level) => ({
    level: level.level,
    words: level.words.length,
    units: level.units.length,
    grammarTargets: level.units.reduce((sum, unit) => sum + unit.sentenceCount, 0),
    tables: level.tables.length,
    sentences: level.sentences.length,
    targets: level.sentences.reduce((sum, sentence) => sum + sentence.targets.length, 0),
    texts: level.texts.length,
  }));
}

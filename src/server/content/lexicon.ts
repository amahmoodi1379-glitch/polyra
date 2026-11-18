import { readFileSync } from "node:fs";
import { join } from "node:path";
import { problem, type Problem } from "./problems";

/**
 * A second opinion on a new noun (PRD §14.2): its gender and plural against an open lexicon (Lexique
 * 3.83 for French, Wiktionary through german-nouns for German, data/lexicon), and its level against
 * the open frequency rank. Each disagreement is a warning for the teacher, never a refusal: a lexicon
 * has gaps, and a word of an A1 topic may be rarer than the list says.
 */

type Entry = Map<string, string[]>;
const lexicons = new Map<string, Map<string, Entry> | null>();

/** The noun lexicon of a language, read once; null when the file is missing (nothing is checked). */
export function nounLexicon(language: string): Map<string, Entry> | null {
  if (lexicons.has(language)) return lexicons.get(language)!;
  let lexicon: Map<string, Entry> | null = null;
  try {
    const text = readFileSync(join(process.cwd(), "data", "lexicon", `${language}-nouns.tsv`), "utf8");
    lexicon = parseLexicon(text);
  } catch {
    lexicon = null;
  }
  lexicons.set(language, lexicon);
  return lexicon;
}

/** `lemma<TAB>gender=plural|plural;gender=` lines; `#` lines are notes. */
export function parseLexicon(text: string): Map<string, Entry> {
  const out = new Map<string, Entry>();
  for (const line of text.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [lemma, genders = ""] = line.split("\t");
    const entry: Entry = new Map();
    for (const part of genders.split(";")) {
      const [gender, plurals = ""] = part.split("=");
      if (gender) entry.set(gender, plurals ? plurals.split("|") : []);
    }
    out.set(lemma, entry);
  }
  return out;
}

/**
 * Ranks beyond which a word is rare for its level, and below which it is too common for a level from
 * B1 up. Wide on purpose: the vocabulary-size studies behind CEFR levels (Milton 2010; Milton and
 * Alexiou 2009) put A1 within the first 1,000–1,500 words and A2 within 2,500, so these bounds only
 * catch a level that is clearly off. Not engine numbers (CLAUDE.md rule 6 is about src/engine).
 */
export const LEVEL_RANK = { rareFrom: { A1: 5000, A2: 8000, B1: 12000 } as Record<string, number>, commonUpTo: 500, commonFrom: ["B1", "B2", "C1", "C2"] };

export type NounFacts = { lemma: string; pos: string; gender: string | null; number: string | null; plural: string | null; level: string };

export function lexiconFlags(word: NounFacts, language: string, rank: number | null, lexicon = nounLexicon(language)): Problem[] {
  const flags: Problem[] = [];
  if (rank !== null) {
    const rare = LEVEL_RANK.rareFrom[word.level];
    if (rare !== undefined && rank > rare) flags.push(problem("levelRare", { lemma: word.lemma, rank, level: word.level }));
    if (rank <= LEVEL_RANK.commonUpTo && LEVEL_RANK.commonFrom.includes(word.level)) flags.push(problem("levelCommon", { lemma: word.lemma, rank, level: word.level }));
  }
  if (word.pos !== "noun" || !word.gender || !lexicon) return flags;
  const entry = lexicon.get(word.lemma) ?? (language === "fr" ? lexicon.get(word.lemma.toLowerCase()) : undefined);
  if (!entry || entry.size === 0) return flags;
  const given = word.gender === "mf" ? ["m", "f"] : [word.gender];
  const matching = given.filter((gender) => entry.has(gender));
  if (matching.length === 0) {
    flags.push(problem("lexiconGender", { lemma: word.lemma, value: word.gender, expected: [...entry.keys()].join(" / ") }));
    return flags;
  }
  if (word.plural && word.number !== "pl_only") {
    const plurals = [...new Set(matching.flatMap((gender) => entry.get(gender) ?? []))];
    if (plurals.length > 0 && !plurals.includes(word.plural)) flags.push(problem("lexiconPlural", { lemma: word.lemma, value: word.plural, expected: plurals.join("، ") }));
  }
  return flags;
}

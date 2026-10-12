import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Builds the open frequency lists in data/frequency (PRD §16.2) from their published sources.
 * Run once, by hand, after downloading the sources (see data/frequency/README.md):
 *   npx tsx scripts/data/build-frequency.ts <Lexique383.tsv> <de_50k.txt>
 * Output: one lemma or word per line, most frequent first; lines starting with # are notes.
 */

const FRENCH_LIMIT = 20_000;
const GERMAN_LIMIT = 30_000;
const outDir = join(process.cwd(), "data", "frequency");

/** Letters, with apostrophes, hyphens or spaces between them (aujourd'hui, a priori). No digits. */
const wordLike = /^\p{L}+(?:['\- ]\p{L}+)*$/u;
/** One-letter words that are real words, not letter names. */
const shortWords = new Set(["à", "y"]);

function keep(word: string) {
  return wordLike.test(word) && (word.length > 1 || shortWords.has(word));
}

/** Lexique 3.83: lemma frequency per million words, averaged over film subtitles and books. */
function french(path: string) {
  const [header, ...rows] = readFileSync(path, "utf8").split("\n");
  const columns = header.split("\t");
  const at = (name: string) => columns.indexOf(name);
  const [lemmaAt, posAt, filmsAt, booksAt] = [at("lemme"), at("cgram"), at("freqlemfilms2"), at("freqlemlivres")];

  // The lemma frequency repeats on every form of a (lemma, part of speech) pair; count it once.
  const perPair = new Map<string, number>();
  for (const row of rows) {
    const cells = row.split("\t");
    const lemma = cells[lemmaAt]?.trim();
    if (!lemma || !keep(lemma)) continue;
    const pair = `${lemma}\t${cells[posAt]}`;
    if (!perPair.has(pair)) perPair.set(pair, (Number(cells[filmsAt]) + Number(cells[booksAt])) / 2);
  }
  const perLemma = new Map<string, number>();
  for (const [pair, frequency] of perPair) {
    const lemma = pair.split("\t")[0];
    perLemma.set(lemma, (perLemma.get(lemma) ?? 0) + frequency);
  }
  return [...perLemma].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "fr")).map(([lemma]) => lemma);
}

/** FrequencyWords (OpenSubtitles 2018): word forms with counts, already sorted, lower case. */
function german(path: string) {
  return readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.split(" ")[0]?.trim())
    .filter((word): word is string => Boolean(word) && keep(word));
}

function write(file: string, notes: string[], words: string[]) {
  const unique = [...new Set(words)];
  writeFileSync(join(outDir, file), [...notes.map((note) => `# ${note}`), ...unique].join("\n") + "\n");
  console.log(`${file}: ${unique.length} lines`);
}

const [lexique, frequencyWords] = process.argv.slice(2);
if (!lexique || !frequencyWords) {
  console.error("Usage: npx tsx scripts/data/build-frequency.ts <Lexique383.tsv> <de_50k.txt>");
  process.exit(1);
}

write(
  "fr.txt",
  [
    "French lemmas by frequency. Derived from Lexique 3.83 (New, Pallier et al., www.lexique.org),",
    "CC BY-SA 4.0. This list is shared under the same licence. Built by scripts/data/build-frequency.ts.",
  ],
  french(lexique).slice(0, FRENCH_LIMIT),
);
write(
  "de.txt",
  [
    "German word forms by frequency. Derived from FrequencyWords by Hermit Dave (OpenSubtitles 2018),",
    "CC BY-SA 4.0. This list is shared under the same licence. Built by scripts/data/build-frequency.ts.",
  ],
  german(frequencyWords).slice(0, GERMAN_LIMIT),
);

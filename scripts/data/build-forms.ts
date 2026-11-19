import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../../src/lib/csv";

/**
 * Builds the word-form lexicons in data/lexicon from their published sources: which lemma each
 * inflected form belongs to, so the content packs can map the words of a sentence to the word list
 * without a chatbot (src/server/content/packs/morph.ts). Run once, by hand, after downloading the
 * sources (see data/lexicon/README.md):
 *   npx tsx scripts/data/build-forms.ts <Lexique383.tsv> <german-nouns nouns.csv>
 * Only lemmas of the frequency lists in data/frequency are kept, so the files stay small.
 *
 * Output, one form per line: `form<TAB>lemma|tag|gender-number|frequency;…`
 *   fr: tag is Lexique's cgram (NOM, VER, AUX, ADJ, ART:def, PRO:per …), frequency the form's
 *       frequency per million words (films and books averaged), used to choose between two readings.
 *   de: nouns only (verbs come from german-verbs-dict, the rest from rules): tag NOM, gender m/f/n.
 */

const outDir = join(process.cwd(), "data", "lexicon");
const frequent = (file: string) =>
  new Set(
    readFileSync(join(process.cwd(), "data", "frequency", file), "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.trim().toLowerCase()),
  );

type Reading = { lemma: string; tag: string; gn: string; freq: number };
const add = (forms: Map<string, Reading[]>, form: string, reading: Reading) => {
  const list = forms.get(form) ?? [];
  const same = list.find((item) => item.lemma === reading.lemma && item.tag === reading.tag && item.gn === reading.gn);
  if (same) same.freq = Math.max(same.freq, reading.freq);
  else list.push(reading);
  forms.set(form, list);
};

function french(path: string) {
  const [header, ...rows] = readFileSync(path, "utf8").split("\n");
  const columns = header.split("\t");
  const at = (name: string) => columns.indexOf(name);
  const [ortho, lemme, cgram, genre, nombre, films, livres] = ["ortho", "lemme", "cgram", "genre", "nombre", "freqfilms2", "freqlivres"].map(at);
  const keep = frequent("fr.txt");
  const forms = new Map<string, Reading[]>();
  for (const row of rows) {
    const cells = row.split("\t");
    const lemma = cells[lemme];
    if (!cells[ortho] || !lemma || !keep.has(lemma.toLowerCase())) continue;
    const freq = Math.round(((Number(cells[films]) || 0) + (Number(cells[livres]) || 0)) * 50) / 100;
    add(forms, cells[ortho], { lemma, tag: cells[cgram], gn: `${cells[genre] ?? ""}${cells[nombre] ?? ""}`, freq });
  }
  return forms;
}

function german(path: string) {
  const [header, ...rows] = parseCsv(readFileSync(path, "utf8"));
  const keep = frequent("de.txt");
  const at = (name: string) => header.indexOf(name);
  const genders = ["genus", "genus 1", "genus 2", "genus 3", "genus 4"].map(at).filter((index) => index >= 0);
  const formColumns = header.map((name, index) => ({ name, index })).filter(({ name }) => /^(nominativ|genitiv|dativ|akkusativ) (singular|plural)/.test(name));
  const forms = new Map<string, Reading[]>();
  for (const cells of rows) {
    const lemma = cells[at("lemma")]?.trim();
    if (!lemma || !/^\p{Lu}/u.test(lemma) || !cells[at("pos")]?.split(",").includes("Substantiv") || !keep.has(lemma.toLowerCase())) continue;
    const gender = genders.map((index) => cells[index]?.trim()).find((value) => value === "m" || value === "f" || value === "n") ?? "";
    for (const { name, index } of formColumns) {
      const form = cells[index]?.trim();
      if (!form || form === "—" || form === "-" || /\s/.test(form)) continue;
      add(forms, form, { lemma, tag: "NOM", gn: `${gender}${name.includes("plural") ? "p" : "s"}`, freq: 0 });
    }
  }
  return forms;
}

function write(file: string, notes: string[], forms: Map<string, Reading[]>) {
  mkdirSync(outDir, { recursive: true });
  const lines = [...forms]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([form, readings]) => `${form}\t${readings.map((item) => [item.lemma, item.tag, item.gn, item.freq].join("|")).join(";")}`);
  writeFileSync(join(outDir, file), [...notes.map((note) => `# ${note}`), ...lines].join("\n") + "\n");
  console.log(`${file}: ${lines.length} forms`);
}

const [lexique, nouns] = process.argv.slice(2);
if (!lexique || !nouns) {
  console.error("Usage: npx tsx scripts/data/build-forms.ts <Lexique383.tsv> <nouns.csv>");
  process.exit(1);
}

write(
  "fr-forms.tsv",
  [
    "French word forms with lemma, category, gender and number, frequency. Derived from Lexique 3.83",
    "(New, Pallier et al., www.lexique.org), CC BY-SA 4.0. Shared under the same licence. Built by scripts/data/build-forms.ts.",
  ],
  french(lexique),
);
write(
  "de-forms.tsv",
  [
    "German noun forms (all cases) with lemma and gender. Derived from german-nouns by gambolputty (Wiktionary,",
    "de.wiktionary.org), CC BY-SA 4.0. Shared under the same licence. Built by scripts/data/build-forms.ts.",
  ],
  german(nouns),
);

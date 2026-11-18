import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../../src/lib/csv";

/**
 * Builds the open noun lexicons in data/lexicon from their published sources: each noun's gender and
 * plural, for the gender and plural check of a new or imported word (src/server/content/lexicon.ts).
 * Run once, by hand, after downloading the sources (see data/lexicon/README.md):
 *   npx tsx scripts/data/build-lexicon.ts <Lexique383.tsv> <german-nouns nouns.csv>
 * Only nouns of the frequency lists in data/frequency are kept, so the files stay small.
 * Output, one noun per line: `lemma<TAB>gender=plural|plural;gender=…` (no plural: `gender=`).
 */

const outDir = join(process.cwd(), "data", "lexicon");
const frequent = (file: string) =>
  new Set(
    readFileSync(join(process.cwd(), "data", "frequency", file), "utf8")
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.trim().toLowerCase()),
  );

type Entry = Map<string, Set<string>>;
const add = (lexicon: Map<string, Entry>, lemma: string, gender: string, plural: string | null) => {
  const entry = lexicon.get(lemma) ?? new Map<string, Set<string>>();
  const plurals = entry.get(gender) ?? new Set<string>();
  if (plural) plurals.add(plural);
  entry.set(gender, plurals);
  lexicon.set(lemma, entry);
};

/**
 * Lexique 3.83: every singular noun form with its gender, and the plural forms of the same lemma and
 * gender. A feminine noun Lexique files under its masculine lemma (actrice under acteur) is still its
 * own line. Lexique leaves the gender of some forms empty (voiture, singular): the lemma's other forms
 * fill it in; a noun with no gender anywhere (livre, both genders) is left out.
 */
function french(path: string) {
  const [header, ...rows] = readFileSync(path, "utf8").split("\n");
  const columns = header.split("\t");
  const at = (name: string) => columns.indexOf(name);
  const [orthoAt, lemmaAt, posAt, genderAt, numberAt] = [at("ortho"), at("lemme"), at("cgram"), at("genre"), at("nombre")];
  const keep = frequent("fr.txt");
  type Form = { ortho: string; gender: string; plural: boolean };
  const byLemma = new Map<string, Form[]>();
  for (const row of rows) {
    const cells = row.split("\t");
    if (cells[posAt] !== "NOM") continue;
    const [ortho, lemma, gender, number] = [cells[orthoAt], cells[lemmaAt], cells[genderAt] ?? "", cells[numberAt]];
    if (!ortho || !lemma) continue;
    byLemma.set(lemma, [...(byLemma.get(lemma) ?? []), { ortho, gender: gender === "m" || gender === "f" ? gender : "", plural: number === "p" }]);
  }
  const lexicon = new Map<string, Entry>();
  for (const [lemma, forms] of byLemma) {
    const lemmaGenders = [...new Set(forms.map((form) => form.gender).filter(Boolean))];
    for (const form of forms) {
      if (form.plural || (!keep.has(form.ortho.toLowerCase()) && !keep.has(lemma.toLowerCase()))) continue;
      const genders = form.gender ? [form.gender] : lemmaGenders;
      for (const gender of genders) {
        // A plural of the masculine lemma does not belong to a feminine form spelled otherwise.
        const own = forms
          .filter((other) => other.plural && (other.gender === gender || other.gender === ""))
          .map((other) => other.ortho)
          .filter((plural) => plural === form.ortho || plural.startsWith(form.ortho.slice(0, Math.max(1, form.ortho.length - 2))));
        if (own.length === 0) add(lexicon, form.ortho, gender, null);
        for (const plural of own) add(lexicon, form.ortho, gender, plural);
      }
    }
  }
  return lexicon;
}

/** german-nouns (Wiktionary): genus m, f or n (several when the noun has several), nominative plurals. */
function german(path: string) {
  const [header, ...rows] = parseCsv(readFileSync(path, "utf8"));
  const at = (name: string) => header.indexOf(name);
  const keep = frequent("de.txt");
  const genders = ["genus", "genus 1", "genus 2", "genus 3", "genus 4"].map(at).filter((index) => index >= 0);
  const plurals = ["nominativ plural", "nominativ plural*", "nominativ plural 1", "nominativ plural 2", "nominativ plural 3", "nominativ plural 4"]
    .map(at)
    .filter((index) => index >= 0);
  const article: Record<string, string> = { m: "der", f: "die", n: "das" };
  const lexicon = new Map<string, Entry>();
  for (const cells of rows) {
    const lemma = cells[at("lemma")]?.trim();
    if (!lemma || !/^\p{Lu}/u.test(lemma) || !cells[at("pos")]?.split(",").includes("Substantiv") || !keep.has(lemma.toLowerCase())) continue;
    const forms = plurals.map((index) => cells[index]?.trim()).filter((form): form is string => !!form && form !== "—" && form !== "-");
    for (const index of genders) {
      const gender = article[cells[index]?.trim() ?? ""];
      if (!gender) continue;
      if (forms.length === 0) add(lexicon, lemma, gender, null);
      for (const form of forms) add(lexicon, lemma, gender, form);
    }
  }
  return lexicon;
}

function write(file: string, notes: string[], lexicon: Map<string, Entry>) {
  mkdirSync(outDir, { recursive: true });
  const lines = [...lexicon]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([lemma, entry]) => `${lemma}\t${[...entry].map(([gender, forms]) => `${gender}=${[...forms].join("|")}`).join(";")}`);
  writeFileSync(join(outDir, file), [...notes.map((note) => `# ${note}`), ...lines].join("\n") + "\n");
  console.log(`${file}: ${lines.length} nouns`);
}

const [lexique, nouns] = process.argv.slice(2);
if (!lexique || !nouns) {
  console.error("Usage: npx tsx scripts/data/build-lexicon.ts <Lexique383.tsv> <nouns.csv>");
  process.exit(1);
}

write(
  "fr-nouns.tsv",
  [
    "French nouns with gender and plural. Derived from Lexique 3.83 (New, Pallier et al., www.lexique.org),",
    "CC BY-SA 4.0. This list is shared under the same licence. Built by scripts/data/build-lexicon.ts.",
  ],
  french(lexique),
);
write(
  "de-nouns.tsv",
  [
    "German nouns with gender and plural. Derived from german-nouns by gambolputty (Wiktionary, de.wiktionary.org),",
    "CC BY-SA 4.0. This list is shared under the same licence. Built by scripts/data/build-lexicon.ts.",
  ],
  german(nouns),
);

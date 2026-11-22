/**
 * Builds the whole content pack of each language from content/<language>/ (format: content/README.md)
 * without a database, exactly as the server builds it at start: word lists, grammar units, sentences
 * with their word mapping and wrong options, and conjugation tables. Prints the counts per level and
 * every error with its file and line.
 *
 *   npm run content:check                 (both languages)
 *   npm run content:check -- fr --notes   (also the notes: forms read by context, tables waiting for a unit)
 *   npm run content:check -- de --warnings
 *
 * Exits with 1 when anything has an error. A clean check is what a content PR needs; the server then
 * loads it through the panel's importers (`npm run content:load` does the same on a local database).
 */
import type { LanguageCode } from "../../src/server/content/languages";
import { buildPack, packSummary, type Note } from "../../src/server/content/packs/build";

const args = process.argv.slice(2);
const languages = (args.filter((arg) => !arg.startsWith("--")) as LanguageCode[]).filter((arg) => arg === "fr" || arg === "de");
const show = (title: string, notes: Note[]) => {
  if (notes.length === 0) return;
  console.log(`\n${title} (${notes.length}):`);
  for (const note of notes) console.log(`  ${note.file}:${note.line}  ${note.text}`);
};

let failed = false;
for (const language of languages.length ? languages : (["fr", "de"] as LanguageCode[])) {
  const started = Date.now();
  const pack = buildPack(language);
  console.log(`\n=== ${language} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  if (pack.words.length === 0 && pack.errors.length === 0) {
    console.log("no content yet");
    continue;
  }
  for (const row of packSummary(pack)) {
    if (row.words + row.units + row.sentences + row.tables === 0) continue;
    console.log(`${row.level}: ${row.words} words, ${row.units} units (${row.grammarTargets} targets), ${row.sentences} sentences (${row.targets} word targets), ${row.tables} tables`);
  }
  show("Errors", pack.errors);
  if (args.includes("--warnings")) show("Warnings", pack.warnings);
  else if (pack.warnings.length) console.log(`\n${pack.warnings.length} warnings (--warnings to list them)`);
  if (args.includes("--notes")) show("Notes", pack.notes);
  if (pack.errors.length > 0) failed = true;
}
if (failed) process.exitCode = 1;

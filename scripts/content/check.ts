/**
 * Builds the whole content pack of each language from content/<language>/ (format: content/README.md)
 * without a database, exactly as the server builds it at start: word lists, grammar units, sentences
 * with their word mapping and wrong options, and conjugation tables. Prints the counts per level and
 * every error with its file and line.
 *
 *   npm run content:check                 (both languages)
 *   npm run content:check -- fr --notes   (also the notes: forms read by context, tables waiting for a unit)
 *   npm run content:check -- de --warnings
 *   npm run content:check -- de --timing  (word sentences that use a grammar point before its unit)
 *   npm run content:check -- fr --texts   (each text's length and how deep into the teaching order it reaches)
 *
 * Exits with 1 when anything has an error. A clean check is what a content PR needs; the server then
 * loads it through the panel's importers (`npm run content:load` does the same on a local database).
 */
import { isCardRegister } from "../../src/engine/content";
import { levelRank, type LanguageCode } from "../../src/server/content/languages";
import { buildPack, packSummary, type Note, type Pack } from "../../src/server/content/packs/build";

const args = process.argv.slice(2);
const languages = (args.filter((arg) => !arg.startsWith("--")) as LanguageCode[]).filter((arg) => arg === "fr" || arg === "de");
const show = (title: string, notes: Note[]) => {
  if (notes.length === 0) return;
  console.log(`\n${title} (${notes.length}):`);
  for (const note of notes) console.log(`  ${note.file}:${note.line}  ${note.text}`);
};

/**
 * Each text with its length and its deepest card word: the position in the language's teaching order
 * (all levels) of the latest word it uses. A learner meets a text once `text.known_share` of its words
 * are known, so a text that reaches word 600 waits until about then (prompt.first_texts spreads them).
 */
function textReach(pack: Pack) {
  const order = pack.words
    .filter((item) => !item.word.no_card && isCardRegister(item.word.register))
    .sort((a, b) => levelRank(a.level) - levelRank(b.level) || a.order - b.order);
  const position = new Map(order.map((item, index) => [item.word.code ?? item.word.lemma, index + 1]));
  console.log("\nTexts (words, deepest card word):");
  for (const level of pack.levels) {
    for (const text of level.texts) {
      const sentences = (text.answer.sentences as { text: string }[]).map((sentence) => sentence.text).join(" ");
      const words = sentences.split(/\s+/u).filter((piece) => /[\p{L}\p{N}]/u.test(piece)).length;
      const deepest = text.codes.map((code) => [code, position.get(code) ?? 0] as const).sort((a, b) => b[1] - a[1])[0];
      console.log(`  ${text.file}  ${text.kind}${text.placement_ok ? ", placement" : ""}  ${words} words, deepest ${deepest ? `${deepest[0]} (${deepest[1]})` : "-"}`);
    }
  }
}

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
    console.log(`${row.level}: ${row.words} words, ${row.units} units (${row.grammarTargets} targets), ${row.sentences} sentences (${row.targets} word targets), ${row.tables} tables, ${row.texts} texts`);
  }
  show("Errors", pack.errors);
  if (args.includes("--warnings")) show("Warnings", pack.warnings);
  else if (pack.warnings.length) console.log(`\n${pack.warnings.length} warnings (--warnings to list them)`);
  if (args.includes("--notes")) show("Notes", pack.notes);
  if (pack.timing.length) {
    const perUnit = new Map<string, number>();
    for (const note of pack.timing) perUnit.set(note.unit, (perUnit.get(note.unit) ?? 0) + 1);
    console.log(`\n${pack.timing.length} word sentences use grammar before its unit (--timing to list them): ${[...perUnit].map(([unit, n]) => `${unit} ${n}`).join(", ")}`);
    if (args.includes("--timing")) show("Grammar before its unit", pack.timing);
  }
  if (args.includes("--texts")) textReach(pack);
  if (pack.errors.length > 0) failed = true;
}
if (failed) process.exitCode = 1;

/**
 * Builds the whole content pack of each language from content/<language>/ (format: content/README.md)
 * without a database, exactly as the server builds it at start: word lists, grammar units, sentences
 * with their word mapping and wrong options, and conjugation tables. Prints the counts per level and
 * every error with its file and line.
 *
 *   npm run content:check                 (both languages)
 *   npm run content:check -- fr --notes   (also the notes: forms read by context, tables waiting for a unit)
 *   npm run content:check -- de --warnings
 *   npm run content:check -- de --timing  (word sentences, texts and dialogues that use a grammar point before its unit)
 *   npm run content:check -- fr --texts   (each text's and dialogue's length and how deep into the teaching order it reaches)
 *   npm run content:check -- fr --units   (each unit's deepest word of its level against when the unit arrives)
 *   npm run content:check -- fr --only=sentences/B1/03 --options   (every word sentence with the wrong options it gets)
 *   npm run content:check -- fr --only=sentences/B1/03,texts/B1/0   (a writer's quick check: only these sentence,
 *                                          text, dialogue, find-the-mistake and writing files; words and units always)
 *
 * Exits with 1 when anything has an error. A clean check is what a content PR needs; the server then
 * loads it through the panel's importers (`npm run content:load` does the same on a local database).
 */
import { isCardRegister } from "../../src/engine/content";
import { levelRank, type LanguageCode } from "../../src/server/content/languages";
import { buildPack, packSummary, type Note, type Pack } from "../../src/server/content/packs/build";
import { engineCatalog } from "../../src/server/settings/engine-catalog";

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
    for (const dialogue of level.dialogues) {
      const deepest = dialogue.codes.map((code) => [code, position.get(code) ?? 0] as const).sort((a, b) => b[1] - a[1])[0];
      console.log(`  ${dialogue.file}  dialogue, deepest ${deepest ? `${deepest[0]} (${deepest[1]})` : "-"}`);
    }
  }
}

/** A word's position among the card words of its level, from the unit's tokens (examples, targets, translations). */
function unitReach(pack: Pack) {
  const gate = Number(engineCatalog.find((item) => item.key === "gate.grammar_words")?.default ?? 0);
  console.log("\nUnits (deepest card word of the unit's level; the unit arrives at about card word N of its level):");
  for (const level of pack.levels) {
    const order = level.words.filter((item) => !item.word.no_card && isCardRegister(item.word.register)).sort((a, b) => a.order - b.order);
    const position = new Map(order.map((item, index) => [item.word.code ?? item.word.lemma, index + 1]));
    const step = level.units.length ? order.length / level.units.length : 0;
    for (const [k, unit] of [...level.units].sort((a, b) => a.order - b.order).entries()) {
      const codes = new Set<string>();
      const walk = (value: unknown) => {
        if (Array.isArray(value)) value.forEach(walk);
        else if (value && typeof value === "object") {
          const record = value as Record<string, unknown>;
          if (typeof record.code === "string" && record.kind === "word") codes.add(record.code);
          Object.values(record).forEach(walk);
        }
      };
      walk(unit.answer);
      const arrives = Math.max(gate, Math.round(gate + k * step));
      const late = [...codes].map((code) => [code, position.get(code) ?? 0] as const).filter(([, at]) => at > arrives + 60).sort((a, b) => b[1] - a[1]);
      const deepest = [...codes].map((code) => [code, position.get(code) ?? 0] as const).sort((a, b) => b[1] - a[1])[0];
      console.log(`  ${unit.file}  arrives ~${arrives}, deepest ${deepest && deepest[1] ? `${deepest[0]} (${deepest[1]})` : "-"}${late.length ? `; later than ${arrives + 60}: ${late.map(([code, at]) => `${code} (${at})`).join(", ")}` : ""}`);
    }
  }
}

const onlyArg = args.find((arg) => arg.startsWith("--only="));
const only = onlyArg ? onlyArg.slice("--only=".length).split(",").map((part) => part.trim()).filter(Boolean) : undefined;
/** With --only, the notes of other content files are left out (word lists and units always show). */
const mine = (notes: Note[]) => (only ? notes.filter((note) => !/\/(sentences|texts|dialogues|errorfix|writing|phonics)\//u.test(note.file) || only.some((part) => note.file.includes(part))) : notes);

let failed = false;
for (const language of languages.length ? languages : (["fr", "de"] as LanguageCode[])) {
  const started = Date.now();
  const pack = buildPack(language, { only });
  pack.errors = mine(pack.errors);
  pack.warnings = mine(pack.warnings);
  pack.notes = mine(pack.notes);
  pack.timing = pack.timing.filter((note) => !only || only.some((part) => note.file.includes(part)));
  console.log(`\n=== ${language} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  if (pack.words.length === 0 && pack.errors.length === 0) {
    console.log("no content yet");
    continue;
  }
  for (const row of packSummary(pack)) {
    if (row.words + row.units + row.sentences + row.tables + row.phonics === 0) continue;
    const production = row.errorfix + row.writing > 0 ? `, ${row.errorfix} find-the-mistake, ${row.writing} writing tasks` : "";
    console.log(`${row.level}: ${row.words} words, ${row.units} units (${row.grammarTargets} targets), ${row.sentences} sentences (${row.targets} word targets), ${row.tables} tables, ${row.texts} texts, ${row.dialogues} dialogues${production}${row.phonics ? `, ${row.phonics} phonics lessons` : ""}`);
  }
  show("Errors", pack.errors);
  if (args.includes("--warnings")) show("Warnings", pack.warnings);
  else if (pack.warnings.length) console.log(`\n${pack.warnings.length} warnings (--warnings to list them)`);
  if (args.includes("--notes")) show("Notes", pack.notes);
  if (pack.timing.length) {
    const perUnit = new Map<string, number>();
    for (const note of pack.timing) perUnit.set(note.unit, (perUnit.get(note.unit) ?? 0) + 1);
    console.log(`\n${pack.timing.length} sentences (of words, texts, dialogues) use grammar before its unit (--timing to list them): ${[...perUnit].map(([unit, n]) => `${unit} ${n}`).join(", ")}`);
    if (args.includes("--timing")) show("Grammar before its unit", pack.timing);
  }
  if (args.includes("--texts")) textReach(pack);
  if (args.includes("--units")) unitReach(pack);
  if (args.includes("--options")) {
    console.log("\nWord sentences with their wrong options (written d: or made by the builder):");
    for (const level of pack.levels)
      for (const sentence of level.sentences)
        for (const target of sentence.targets) console.log(`  ${target.target}: ${target.marked_text}  →  ${target.distractors.join(", ")}${target.hint ? `  ${target.hint}` : ""}${target.accepted.length > 1 ? `  (ok: ${target.accepted.slice(1).join(", ")})` : ""}`);
  }
  if (pack.errors.length > 0) failed = true;
}
if (failed) process.exitCode = 1;

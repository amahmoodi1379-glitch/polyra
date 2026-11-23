/**
 * Checks the word lists in content/<language>/words/*.tsv (format: content/README.md) with every rule of
 * the panel's word import, the open lexicons and the frequency list, and prints a report per level:
 * size against the level target, parts of speech, topics, frequency ranks, and the most frequent
 * lemmas the lists leave out.
 *
 *   npm run content:words -- fr          (or de, or both when left out)
 *   npm run content:words -- de --missing=300 --warnings
 *
 * Exits with 1 when any line has an error.
 */
import { appSettingDefaults } from "../../src/server/settings/app-catalog";
import type { LanguageCode } from "../../src/server/content/languages";
import { checkWordPack, coveredLemmas, frequencyRanks, PACK_LEVELS, readWordFiles, type PackWord } from "../../src/server/content/packs/words";

const args = process.argv.slice(2);
const languages = (args.filter((arg) => !arg.startsWith("--")) as LanguageCode[]).filter((arg) => arg === "fr" || arg === "de");
const option = (name: string) => args.find((arg) => arg.startsWith(`--${name}`))?.split("=")[1];
const missingCount = Number(option("missing") ?? 150);
const showWarnings = args.includes("--warnings");

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const top = (counts: Map<string, number>, n: number) =>
  [...counts]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => `${key} ${count}`)
    .join(", ");

let failed = false;
for (const language of languages.length ? languages : (["fr", "de"] as LanguageCode[])) {
  const files = readWordFiles(language);
  console.log(`\n=== ${language}: ${files.map((file) => file.file).join(", ") || "no word files yet"}`);
  if (files.length === 0) continue;
  const ranks = frequencyRanks(language);
  const pack = checkWordPack(language, files, ranks);

  for (const note of pack.errors) console.log(`ERROR ${note.file}:${note.line} ${note.lemma}: ${note.text}`);
  if (pack.errors.length > 0) failed = true;
  if (showWarnings) for (const note of pack.warnings) console.log(`warn  ${note.file}:${note.line} ${note.lemma}: ${note.text}`);
  console.log(`${pack.errors.length} errors, ${pack.warnings.length} warnings${showWarnings || pack.warnings.length === 0 ? "" : " (--warnings lists them)"}`);

  const targets = appSettingDefaults[`targets.${language}`] as Record<string, { words: number; phrases: number }>;
  for (const level of PACK_LEVELS) {
    const list = pack.words.filter((item) => item.level === level);
    if (list.length === 0) continue;
    const cards = list.filter((item) => !item.word.no_card && item.word.pos !== "phrase");
    const phrases = list.filter((item) => item.word.pos === "phrase");
    const pos = new Map<string, number>();
    const topicCount = new Map<string, number>();
    for (const item of list) {
      pos.set(item.word.pos, (pos.get(item.word.pos) ?? 0) + 1);
      topicCount.set(item.topic, (topicCount.get(item.topic) ?? 0) + 1);
    }
    const ranked = cards.map((item) => item.rank).filter((rank): rank is number => rank !== null);
    const target = targets[level];
    console.log(
      `${level}: ${cards.length} card words (target ${target?.words ?? "?"}), ${phrases.length} phrases (target ${target?.phrases ?? "?"}), ${list.length - cards.length - phrases.length} no_card` +
        `\n    pos: ${top(pos, 12)}\n    topics: ${top(topicCount, 40)}` +
        `\n    frequency rank: median ${median(ranked) ?? "-"}, not in the frequency list ${cards.length - ranked.length}`,
    );
  }

  // Coverage: how much of the most frequent vocabulary the lists teach, and what they leave out.
  // A taught «œil» covers the frequency list's «oeil» (Lexique spelling), a taught «se lever» its «lever».
  const taught = new Set(pack.words.flatMap((item: PackWord) => coveredLemmas(item.word)));
  const byRank = [...ranks].sort((a, b) => a[1] - b[1]);
  for (const band of [500, 1000, 2000, 3000, 5000]) {
    const inBand = byRank.filter(([, rank]) => rank <= band);
    const covered = inBand.filter(([lemma]) => taught.has(lemma)).length;
    console.log(`coverage of the ${band} most frequent: ${covered} (${Math.round((covered / inBand.length) * 100)}%)`);
  }
  const missing = byRank.filter(([lemma]) => !taught.has(lemma)).slice(0, missingCount);
  console.log(`most frequent not in the lists (check: a name, a form of a listed word, or truly missing):\n${missing.map(([lemma, rank]) => `${rank}:${lemma}`).join(" ")}`);
}
process.exit(failed ? 1 : 0);

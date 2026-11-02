/**
 * The pace study for the owner's decisions of PRD §17.1 (speed of progress, the start screen's
 * time estimate `pace_estimate_fa`, the first review): made-up learners from zero come every day
 * with each session length, through the real engine on synthetic content with the A1 size of PRD §16.6
 * (600 words, 50 units), until A1 is introduced or the days run out.
 *
 *   npm run pace                         FSRS retention from the defaults (0.9)
 *   npm run pace -- --retention=0.85     the other option of §17.1
 *   npm run pace -- --days=300 --seed=x
 *
 * It prints one line per session length; nothing is a pass mark. Like the simulator, the learner
 * forgets with FSRS's own curve (PRD §16.3, «محدودیت شبیه‌ساز»), so these are estimates for the
 * start screen until real data replaces them.
 */
import { hasCard, isColloquial } from "../src/engine/content";
import { seeded } from "../src/engine/random";
import type { BuildOptions } from "../src/engine/session/build";
import type { Settings } from "../src/engine/settings";
import { plusDays } from "../src/engine/time";
import { engineCatalog } from "../src/server/settings/engine-catalog";
import { syntheticContent } from "../fixtures/synthetic";
import { playSession } from "../fixtures/synthetic/drive";
import { human } from "../fixtures/synthetic/human";
import { freshLearner } from "../fixtures/synthetic/learner";

const args = new Map<string, string | undefined>(
  process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value];
  }),
);
const SEED = args.get("seed") ?? "polyra-pace";
const DAYS = Number(args.get("days") ?? 400);
const LENGTHS = (args.get("lengths") ?? "10,15,20,30").split(",").map(Number);
const ABILITIES = [0.9, 0.75, 0.75, 0.75, 0.75, 0.55];
const START = new Date("2026-03-21T04:30:00Z");

const defaults: Settings = Object.fromEntries(engineCatalog.map((item) => [item.key, item.default]));
const settings: Settings = { ...defaults, ...(args.has("retention") ? { "fsrs.request_retention": Number(args.get("retention")) } : {}) };

const content = syntheticContent({ perLevel: { words: [600, 300, 300, 300], units: [50, 30, 30, 30] }, textsPerLevel: 20, phonics: 14 });
const a1Words = new Set([...content.words.values()].filter((word) => word.level === "A1" && hasCard(word) && !isColloquial(word)).map((word) => word.id));
const a1Units = new Set(content.units.filter((unit) => unit.level === "A1").map((unit) => unit.id));

type Run = { ability: number; wordsDay: number | null; unitsDay: number | null; month2: number; firstReview: number; reviewShare: number; minutes: number };

function runLearner(length: number, index: number): Run {
  const ability = ABILITIES[index % ABILITIES.length];
  const seed = `${SEED}:${length}:${index}`;
  const rng = seeded(seed, "answers");
  const person = human({ content, settings, seed, ability: () => ability });
  let learner = freshLearner("fr", { sessionLength: length, phonicsAuto: true });
  let wordsDay: number | null = null;
  let unitsDay: number | null = null;
  const month2: number[] = [];
  let firstOk = 0;
  let firstOf = 0;
  let reviewSec = 0;
  let allSec = 0;
  for (let day = 0; day < DAYS && (wordsDay === null || unitsDay === null); day++) {
    const now = new Date(plusDays(START, day).getTime() + rng() * 3_600_000);
    const opts: BuildOptions = { scope: "mixed", lengthMin: length, noAudio: false, cap: null, seed: `${seed}:${day}` };
    let played = playSession(content, learner, settings, now, opts, person.policy, rng);
    if (played.build.kind === "ask_word_cap") played = playSession(content, played.learner, settings, now, { ...opts, cap: "none" }, person.policy, rng);
    learner = played.learner;
    played.results.forEach((result, at) => {
      const seconds = played.latencies[at] / 1000;
      allSec += seconds;
      if (result.log.kind === "review" && result.card.kind === "review") reviewSec += seconds;
      if (result.log.kind === "review" && result.log.rating !== null && result.state?.fsrs.reps === 2 && result.card.item.startsWith("w:")) {
        firstOf++;
        if (result.log.result === "correct" || result.log.result === "near") firstOk++;
      }
    });
    if (day >= 30 && day < 60) month2.push(learner.today.newWords);
    const words = learner.items.filter((item) => item.itemType === "word" && a1Words.has(item.itemId)).length;
    const units = learner.items.filter((item) => item.itemType === "grammar_unit" && a1Units.has(item.itemId)).length;
    if (wordsDay === null && words >= a1Words.size) wordsDay = day + 1;
    if (unitsDay === null && units >= a1Units.size) unitsDay = day + 1;
  }
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  return { ability, wordsDay, unitsDay, month2: mean(month2), firstReview: firstOk / Math.max(1, firstOf), reviewShare: reviewSec / Math.max(1, allSec), minutes: allSec / 60 };
}

const median = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const months = (days: number | null) => (days === null || days > DAYS ? `>${(DAYS / 30).toFixed(0)}` : (days / 30).toFixed(1));
const pct = (n: number) => `${Math.round(n * 100)}%`;

console.log(`retention ${settings["fsrs.request_retention"]} · ${DAYS} days at most · A1 = ${a1Words.size} card words and ${a1Units.size} units`);
for (const length of LENGTHS) {
  const runs = ABILITIES.map((_, index) => runLearner(length, index));
  const typical = runs.filter((run) => run.ability === 0.75);
  const fmt = (pick: (run: Run) => number | null, list: Run[]) => months(median(list.map(pick).map((v) => v ?? DAYS + 1)) ?? null);
  const both = (run: Run) => (run.wordsDay === null || run.unitsDay === null ? null : Math.max(run.wordsDay, run.unitsDay));
  console.log(
    `${String(length).padStart(2)} min · A1 words (months): strong ${months(runs[0].wordsDay)}, typical ${fmt((r) => r.wordsDay, typical)}, weak ${months(runs[5].wordsDay)}` +
      ` · A1 grammar: strong ${months(runs[0].unitsDay)}, typical ${fmt((r) => r.unitsDay, typical)}, weak ${months(runs[5].unitsDay)}` +
      ` · A1 both, typical ${fmt(both, typical)}` +
      ` · new words/day in month 2 (typical) ${(typical.reduce((a, r) => a + r.month2, 0) / typical.length).toFixed(1)}` +
      ` · first review right (typical) ${pct(typical.reduce((a, r) => a + r.firstReview, 0) / typical.length)}` +
      ` · review time share ${pct(runs.reduce((a, r) => a + r.reviewShare, 0) / runs.length)}`,
  );
}

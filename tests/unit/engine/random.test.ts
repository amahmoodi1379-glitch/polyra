/**
 * The random test of PRD §16.3: made-up learners with random behaviour (right, wrong, near, «نمی‌دانم»,
 * leaving half-way, also in a text, sound off, «این را بلدم» and the pretest mode, «بعداً» on a phonics round, every kind of session, the word-cap and text-session questions, a new session length,
 * switches in the panel and a level closed under them) go day by day through the real engine, and
 * `checkInvariants` runs after every build and every card. A failure names its seed, learner and day,
 * so `RANDOM_SEED=… RANDOM_USERS=… npx vitest run tests/unit/engine/random.test.ts` plays it again.
 * `npm test` runs a small crowd; set RANDOM_USERS and RANDOM_DAYS for a long run.
 */
import { describe, expect, it } from "vitest";
import type { Content } from "@/engine/content";
import { checkInvariants, type InvariantInput, type Violation } from "@/engine/invariants";
import { seeded, type Rng } from "@/engine/random";
import type { BuildOptions } from "@/engine/session/build";
import type { Settings } from "@/engine/settings";
import type { LearnerSnapshot } from "@/engine/state";
import { plusDays } from "@/engine/time";
import { switchableExercises } from "@/server/settings/engine-catalog";
import { syntheticContent } from "../../../fixtures/synthetic";
import { playSession, randomPolicy } from "../../../fixtures/synthetic/drive";
import { freshLearner } from "../../../fixtures/synthetic/learner";
import { defaults } from "./kit";

const SEED = process.env.RANDOM_SEED ?? "polyra";
const USERS = Number(process.env.RANDOM_USERS ?? 24);
const DAYS = Number(process.env.RANDOM_DAYS ?? 18);
const START = new Date("2026-03-21T04:30:00Z");

const pick = <T,>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

const contents = {
  fr: syntheticContent({ textsPerLevel: 8, phonics: 6, dialoguesPerLevel: 3, errorfixPerLevel: 3 }),
  de: syntheticContent({ language: "de", textsPerLevel: 8, phonics: 6, dialoguesPerLevel: 3, errorfixPerLevel: 3 }),
  frA1: syntheticContent({ openLevels: ["A1"], textsPerLevel: 8, phonics: 6, dialoguesPerLevel: 3 }),
};

const SCOPES: BuildOptions["scope"][] = ["mixed", "mixed", "mixed", "mixed", "mixed", "vocab", "grammar", "listening", "reading", "quick", "notebook", "extra", "phonics"];

type Failure = { user: number; day: number; session: number; violations: Violation[] };

function runLearner(user: number): Failure | null {
  const rng = seeded(SEED, "user", user);
  const lang = rng() < 0.3 ? "de" : "fr";
  let content: Content = lang === "de" ? contents.de : contents.fr;
  const accuracy = 0.4 + rng() * 0.55;
  // Some learners press «این را بلدم» often, enough for the pretest mode where it is switched on (PRD §11.5).
  const policy = randomPolicy(accuracy, content.language, rng() < 0.4 ? 0.35 : 0.03);
  let settings: Settings = { ...defaults, "feature.confusion_card": rng() < 0.5, "feature.pretest": rng() < 0.6 };
  let learner: LearnerSnapshot = freshLearner(lang, { sessionLength: pick(rng, [10, 15, 20, 30]), phonicsAuto: rng() < 0.6 });
  // Some learners see the teacher close every level above A1 on a random day (PRD §13.5).
  const closeDay = lang === "fr" && rng() < 0.3 ? 1 + Math.floor(rng() * DAYS) : null;

  for (let day = 0; day < DAYS; day++) {
    if (rng() < 0.15) continue;
    if (day === closeDay) content = contents.frA1;
    // The panel: an exercise or the confusion card switched on or off (PRD §9.12, §13.2).
    if (rng() < 0.15) {
      const code = pick(rng, switchableExercises).code;
      settings = { ...settings, [`exercise.${code}.enabled`]: !(settings[`exercise.${code}.enabled`] ?? true) };
    }
    if (rng() < 0.05) settings = { ...settings, "feature.confusion_card": !settings["feature.confusion_card"] };
    if (rng() < 0.05) settings = { ...settings, "feature.pretest": !settings["feature.pretest"] };
    if (rng() < 0.05) learner = { ...learner, sessionLength: pick(rng, [10, 15, 20, 30]) };

    const sessions = 1 + Math.floor(rng() * 3);
    for (let session = 0; session < sessions; session++) {
      const now = new Date(plusDays(START, day).getTime() + (session * 3 + rng()) * 3_600_000);
      const violations: Violation[] = [];
      const check = (input: InvariantInput) => violations.push(...checkInvariants(input));
      const opts: BuildOptions = { scope: pick(rng, SCOPES), lengthMin: learner.sessionLength, noAudio: rng() < 0.1, cap: null, seed: `${SEED}-${user}-${day}-${session}` };
      const textAsk = (): "confirmed" | "later" => (rng() < 0.5 ? "confirmed" : "later");
      const phonicsLater = () => rng() < 0.25;
      const play = { leaveAfter: rng() < 0.15 ? Math.floor(rng() * 25) : undefined, muteAfter: rng() < 0.1 ? Math.floor(rng() * 10) : undefined, check, textAsk, phonicsLater };
      let played = playSession(content, learner, settings, now, opts, policy, rng, play);
      learner = played.learner;
      if (played.build.kind === "ask_word_cap") {
        played = playSession(content, learner, settings, now, { ...opts, cap: rng() < 0.5 ? "more" : "none" }, policy, rng, play);
        learner = played.learner;
      }
      if (played.build.kind === "plan" && played.build.effects.unbuildable.length > 0) violations.push({ rule: 1, detail: `no exercise for ${played.build.effects.unbuildable.join(", ")}` });
      if (violations.length > 0) return { user, day, session, violations: violations.slice(0, 5) };
    }
  }
  return null;
}

describe("the rules that never break (PRD §16.3), random learners", () => {
  it(`${USERS} learners over ${DAYS} days, seed «${SEED}»: no rule is broken`, { timeout: 30 * 60_000 }, () => {
    const failures: Failure[] = [];
    for (let user = 0; user < USERS; user++) {
      const failure = runLearner(user);
      if (failure) failures.push(failure);
    }
    expect(failures, `RANDOM_SEED=${SEED}`).toEqual([]);
  });
});

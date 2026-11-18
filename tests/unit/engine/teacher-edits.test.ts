/**
 * The teacher may edit and delete anything at any time (owner, 18 Nov 2026), and the engine must not
 * break for learners with progress on it. Between sessions a made-up teacher takes words, units and
 * texts out the way `learnerContent` then shows them (a sentence with a hidden word goes, and with it a
 * text or a dialogue made of it), moves words to other levels, changes a noun's gender, makes a noun a
 * verb, and puts items back. Every build and every card goes through `checkInvariants`; nothing may throw.
 */
import { describe, expect, it } from "vitest";
import { indexContent, type Content } from "@/engine/content";
import { checkInvariants, type InvariantInput, type Violation } from "@/engine/invariants";
import { seeded, type Rng } from "@/engine/random";
import type { BuildOptions } from "@/engine/session/build";
import type { LearnerSnapshot } from "@/engine/state";
import { plusDays } from "@/engine/time";
import { syntheticContent } from "../../../fixtures/synthetic";
import { playSession, randomPolicy } from "../../../fixtures/synthetic/drive";
import { freshLearner } from "../../../fixtures/synthetic/learner";
import { defaults } from "./kit";

const START = new Date("2026-03-21T04:30:00Z");
const USERS = Number(process.env.EDIT_USERS ?? 10);
const DAYS = Number(process.env.EDIT_DAYS ?? 16);
const SCOPES: BuildOptions["scope"][] = ["mixed", "mixed", "mixed", "vocab", "grammar", "listening", "reading", "quick", "notebook", "extra"];
const pick = <T,>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)];

/** What the learner sees once these words are hidden (src/server/learn/content.ts does the same). */
function withoutWords(content: Content, gone: ReadonlySet<number>): Content {
  const words = new Map([...content.words].filter(([id]) => !gone.has(id)));
  const sentences = new Map([...content.sentences].filter(([, sentence]) => !sentence.tokens.some((token) => token.kind === "word" && token.wordId !== null && gone.has(token.wordId))));
  return rebuild(content, {
    words,
    sentences,
    targets: new Map([...content.targets].filter(([, target]) => sentences.has(target.sentenceId) && !(target.type === "word" && gone.has(target.targetId)))),
    conjugations: content.conjugations.filter((table) => words.has(table.wordId)),
    texts: content.texts.filter((text) => text.sentenceIds.every((id) => sentences.has(id))).map((text) => ({ ...text, keyWordIds: text.keyWordIds.filter((id) => words.has(id)) })),
    dialogues: content.dialogues.filter((dialogue) => dialogue.turns.every((turn) => sentences.has(turn.sentenceId) && turn.choices.every((id) => sentences.has(id)))),
    errorfixes: content.errorfixes.filter((item) => item.wordIds.every((id) => words.has(id))),
  });
}

function rebuild(content: Content, parts: Partial<Content>): Content {
  const next = { ...content, ...parts };
  return indexContent({
    language: next.language,
    levels: next.levels,
    openLevels: next.openLevels,
    words: next.words,
    sentences: next.sentences,
    targets: next.targets,
    units: next.units,
    transforms: next.transforms,
    translates: next.translates,
    conjugations: next.conjugations,
    texts: next.texts,
    phonics: next.phonics,
    dialogues: next.dialogues,
    errorfixes: next.errorfixes,
  });
}

/** One random change by the teacher. */
function teacherEdit(full: Content, now: Content, rng: Rng): Content {
  const roll = rng();
  const someWords = (share: number) => new Set([...now.words.keys()].filter(() => rng() < share));
  if (roll < 0.25) {
    // Delete or suspend a few words, with whatever only they made.
    const hidden = new Set([...full.words.keys()].filter((id) => !now.words.has(id)));
    return withoutWords(full, new Set([...hidden, ...someWords(0.04)]));
  }
  if (roll < 0.4 && now.units.length > 1) {
    // Delete a grammar unit: its targets and exercises go with it.
    const unit = pick(rng, now.units);
    return rebuild(now, {
      units: now.units.filter((item) => item.id !== unit.id),
      targets: new Map([...now.targets].filter(([, target]) => !(target.type === "grammar" && target.targetId === unit.id))),
      transforms: now.transforms.filter((item) => item.unitId !== unit.id),
      translates: now.translates.filter((item) => item.unitId !== unit.id),
    });
  }
  if (roll < 0.5 && now.texts.length > 0) {
    const text = pick(rng, now.texts);
    return rebuild(now, { texts: now.texts.filter((item) => item.id !== text.id) });
  }
  if (roll < 0.65) {
    // Edit words: another level, another gender, a noun made a verb, a meaning changed.
    const words = new Map(now.words);
    for (const id of someWords(0.05)) {
      const word = words.get(id)!;
      const change = rng();
      if (change < 0.3) words.set(id, { ...word, level: pick(rng, now.levels) });
      else if (change < 0.6 && word.pos === "noun") words.set(id, { ...word, gender: word.gender === "f" || word.gender === "die" ? (now.language === "fr" ? "m" : "der") : now.language === "fr" ? "f" : "die" });
      else if (change < 0.8 && word.pos === "noun") words.set(id, { ...word, pos: "verb", gender: null, number: null });
      else words.set(id, { ...word, meanings: word.meanings.map((meaning) => `${meaning} (تازه)`) });
    }
    return rebuild(now, { words });
  }
  if (roll < 0.75) return full; // «برگردان»: everything back.
  if (roll < 0.8 && now.conjugations.length > 0) {
    const table = pick(rng, now.conjugations);
    return rebuild(now, { conjugations: now.conjugations.filter((item) => item.id !== table.id) });
  }
  return now;
}

type Failure = { user: number; day: number; error?: string; violations?: Violation[] };

function runLearner(user: number): Failure | null {
  const rng = seeded("teacher-edits", user);
  const full = syntheticContent({ language: rng() < 0.3 ? "de" : "fr", textsPerLevel: 6, phonics: 4, dialoguesPerLevel: 2, errorfixPerLevel: 2 });
  let content = full;
  const policy = randomPolicy(0.5 + rng() * 0.45, full.language, 0.05);
  const settings = { ...defaults, "feature.confusion_card": true };
  let learner: LearnerSnapshot = freshLearner(full.language, { sessionLength: pick(rng, [10, 15, 20]) });
  for (let day = 0; day < DAYS; day++) {
    // From the fourth day on the teacher is at work most days.
    if (day >= 3 && rng() < 0.7) content = teacherEdit(full, content, rng);
    for (let session = 0; session < 1 + Math.floor(rng() * 2); session++) {
      const now = new Date(plusDays(START, day).getTime() + (session * 4 + rng()) * 3_600_000);
      const violations: Violation[] = [];
      const check = (input: InvariantInput) => violations.push(...checkInvariants(input));
      const opts: BuildOptions = { scope: pick(rng, SCOPES), lengthMin: learner.sessionLength, noAudio: rng() < 0.1, cap: null, seed: `edits-${user}-${day}-${session}` };
      try {
        let played = playSession(content, learner, settings, now, opts, policy, rng, { check, leaveAfter: rng() < 0.15 ? Math.floor(rng() * 20) : undefined });
        learner = played.learner;
        if (played.build.kind === "ask_word_cap") {
          played = playSession(content, learner, settings, now, { ...opts, cap: "more" }, policy, rng, { check });
          learner = played.learner;
        }
      } catch (error) {
        return { user, day, error: error instanceof Error ? `${error.message}\n${error.stack?.split("\n").slice(1, 4).join("\n")}` : String(error) };
      }
      // A due item whose content is gone is not an engine error: the item waits (rule 1 is about live content).
      const real = violations.filter((item) => !(item.rule === 1 && /no exercise/.test(item.detail)));
      if (real.length > 0) return { user, day, violations: real.slice(0, 5) };
    }
  }
  return null;
}

describe("the teacher edits and deletes while learners learn (owner, 18 Nov 2026)", () => {
  it(`${USERS} learners × ${DAYS} days: no error, no broken rule`, () => {
    const failures = Array.from({ length: USERS }, (_, user) => runLearner(user)).filter((item): item is Failure => item !== null);
    expect(failures).toEqual([]);
  }, 300_000);
});

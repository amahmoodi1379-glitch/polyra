/**
 * «یک سطح پایین‌تر برویم؟» (PRD §11.7, T75): each skill's condition, the switch, the cooldown, one skill
 * at a time, and what «بله» changes. Content is made up (`fixtures/synthetic`).
 */
import { describe, expect, it } from "vitest";
import type { Content } from "@/engine/content";
import { levelDownOffer, levelDownSkills, type LevelDownInput } from "@/engine/leveldown";
import { pickSessionMessage, SESSION_MESSAGES } from "@/engine/messages";
import { nextUnit } from "@/engine/session/newmaterial";
import type { SkillLevelE, TextStateE } from "@/engine/state";
import { plusDays } from "@/engine/time";
import { syntheticContent } from "../../../fixtures/synthetic";
import { settings } from "./kit";

const NOW = new Date("2026-05-01T08:00:00Z");
const on = settings({ "feature.leveldown": true });
const content: Content = syntheticContent({ perLevel: { words: [40, 40, 40, 40], units: [4, 4, 4, 4] }, textsPerLevel: 6 });

const skills = (over: Partial<Record<SkillLevelE["skill"], Partial<SkillLevelE>>> = {}): SkillLevelE[] =>
  (["vocab", "grammar", "listening", "reading"] as const).map((skill) => ({ skill, level: "A1", knownBelow: "A1", ...over[skill] }));
const reviews = (right: number, wrong: number) => [...Array<boolean>(right).fill(true), ...Array<boolean>(wrong).fill(false)];
const input = (over: Partial<LevelDownInput> = {}): LevelDownInput => ({ skills: skills(), texts: [], vocabReviews: [], grammarRounds: [], askedAt: null, ...over });

/** First rounds of texts in a track with the given scores, for `track_score`. */
function firstRounds(track: "listening" | "reading", level: string, scores: number[]): TextStateE[] {
  const texts = content.texts.filter((text) => text.level === level);
  return scores.map((score, i) => ({
    textId: texts[i].id,
    track,
    attemptsDone: 1,
    firstScore: score,
    scores: [{ attempt: 1, set: "A" as const, score, at: plusDays(NOW, -i - 1).toISOString() }],
    lastAttemptAt: plusDays(NOW, -i - 1).toISOString(),
    nextAttemptAt: null,
    partial: null,
    partialUntil: null,
    usedInTest: false,
  }));
}

describe("vocabulary (PRD §11.7, T75)", () => {
  const placed = skills({ vocab: { level: "B1", knownBelow: "B1" } });

  it("T75: placed at B1, 40% right over 35 reviews: offered A2; «بله» puts level and known_below at A2", () => {
    const offer = levelDownOffer(content, input({ skills: placed, vocabReviews: reviews(14, 21) }), on, NOW);
    expect(offer).toEqual({ skill: "vocab", from: "B1", to: "A2" });
    expect(levelDownSkills(placed, offer!).find((row) => row.skill === "vocab")).toEqual({ skill: "vocab", level: "A2", knownBelow: "A2" });
  });

  it("not with fewer than 30 reviews, at 50% or more, or from the lowest level", () => {
    expect(levelDownOffer(content, input({ skills: placed, vocabReviews: reviews(10, 19) }), on, NOW)).toBeNull();
    expect(levelDownOffer(content, input({ skills: placed, vocabReviews: reviews(15, 15) }), on, NOW)).toBeNull();
    expect(levelDownOffer(content, input({ vocabReviews: reviews(5, 30) }), on, NOW)).toBeNull();
  });

  it("T75: then not again for 14 days; never with the switch off", () => {
    const struggling = input({ skills: placed, vocabReviews: reviews(10, 25) });
    expect(levelDownOffer(content, { ...struggling, askedAt: plusDays(NOW, -13) }, on, NOW)).toBeNull();
    expect(levelDownOffer(content, { ...struggling, askedAt: plusDays(NOW, -14) }, on, NOW)).not.toBeNull();
    expect(levelDownOffer(content, struggling, settings(), NOW)).toBeNull();
  });
});

describe("grammar (PRD §11.7)", () => {
  const placed = skills({ grammar: { level: "A2", knownBelow: "A2" } });
  const rounds = (good: number) => [...Array<boolean>(good).fill(true), ...Array<boolean>(10 - good).fill(false)];

  it("lower units counted known and 4 of the last 10 rounds Good or Easy: offered; 5 of 10 or fewer than 10 rounds: not", () => {
    expect(levelDownOffer(content, input({ skills: placed, grammarRounds: rounds(4) }), on, NOW)).toEqual({ skill: "grammar", from: "A2", to: "A1" });
    expect(levelDownOffer(content, input({ skills: placed, grammarRounds: rounds(5) }), on, NOW)).toBeNull();
    expect(levelDownOffer(content, input({ skills: placed, grammarRounds: rounds(2).slice(0, 9) }), on, NOW)).toBeNull();
    expect(levelDownOffer(content, input({ grammarRounds: rounds(0) }), on, NOW)).toBeNull();
  });

  it("«بله»: the next new unit is the first of the lower level; opened units stay", () => {
    const after = levelDownSkills(placed, { skill: "grammar", from: "A2", to: "A1" }).find((row) => row.skill === "grammar")!;
    expect(after.knownBelow).toBe("A1");
    expect(nextUnit(content, new Map(), on, after.knownBelow)?.id).toBe(content.units[0].id);
  });
});

describe("listening and reading (PRD §11.7)", () => {
  const placed = skills({ listening: { level: "A2" } });

  it("a track above the lowest level, its score below 0.4 and four untouched texts below: offered", () => {
    const texts = firstRounds("listening", "A2", [0.3, 0.3, 0.3]);
    expect(levelDownOffer(content, input({ skills: placed, texts }), on, NOW)).toEqual({ skill: "listening", from: "A2", to: "A1" });
    expect(levelDownSkills(placed, { skill: "listening", from: "A2", to: "A1" }).find((row) => row.skill === "listening")).toMatchObject({ level: "A1" });
  });

  it("not without a score, at 0.4, or with fewer than four untouched texts below", () => {
    expect(levelDownOffer(content, input({ skills: placed }), on, NOW)).toBeNull();
    expect(levelDownOffer(content, input({ skills: placed, texts: firstRounds("listening", "A2", [0.4, 0.4, 0.4]) }), on, NOW)).toBeNull();
    const low = [...firstRounds("listening", "A2", [0.2, 0.2, 0.2]), ...firstRounds("reading", "A1", [0.9, 0.9, 0.9])];
    expect(levelDownOffer(content, input({ skills: placed, texts: low }), on, NOW)).toBeNull();
  });
});

describe("one skill at a time, and the message first of all (PRD §3.11)", () => {
  it("vocabulary before grammar; the leveldown message outranks every other", () => {
    const both = input({ skills: skills({ vocab: { level: "B1", knownBelow: "B1" }, grammar: { level: "A2", knownBelow: "A2" } }), vocabReviews: reviews(5, 30), grammarRounds: Array<boolean>(10).fill(false) });
    expect(levelDownOffer(content, both, on, NOW)?.skill).toBe("vocab");
    expect(SESSION_MESSAGES[0]).toBe("leveldown");
    expect(pickSessionMessage([{ kind: "install" as const }, { kind: "skipTest" as const }, { kind: "longer" as const }, { kind: "leveldown" as const }])?.kind).toBe("leveldown");
    expect(pickSessionMessage([{ kind: "install" as const }, { kind: "skipTest" as const }, { kind: "longer" as const }])?.kind).toBe("longer");
    expect(pickSessionMessage([{ kind: "phonicsOff" as const }, { kind: "skipTest" as const }])?.kind).toBe("skipTest");
  });
});

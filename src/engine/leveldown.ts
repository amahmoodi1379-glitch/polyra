import { levelIndex, type Content, type Track } from "./content";
import { flag, num, type Settings } from "./settings";
import type { SkillLevelE, SkillName, TextStateE } from "./state";
import { trackScore } from "./texts";
import { plusDays } from "./time";

/**
 * «یک سطح پایین‌تر برویم؟» (PRD §11.7, `levelDownCheck` of §15.3): a learner whose level was set high
 * (placement or a skip exam) and is struggling gets one yes/no question at the end of a session. Each
 * skill is judged on its own; one level at a time; then not again for `leveldown.cooldown_days`.
 */

export const LEVELDOWN_RULE = {
  /** Scored grammar rounds looked at, and the Good or Easy among them below which the offer comes. */
  grammarRounds: 10,
  grammarGood: 5,
  /** A track's score below which it may go down, and untouched texts the lower level must have. */
  trackBelow: 0.4,
  lowerTexts: 4,
} as const;

export type LevelDownInput = {
  skills: SkillLevelE[];
  texts: TextStateE[];
  /** Scored vocabulary reviews of the last `leveldown.window_days`, not first typings: right or nearly right. */
  vocabReviews: boolean[];
  /** The last scored grammar rounds, newest first: Good or Easy. */
  grammarRounds: boolean[];
  /** `enrollment.leveldown_asked_at`. */
  askedAt: Date | null;
};

export type LevelDownOffer = { skill: SkillName; from: string; to: string };

const SKILL_ORDER: readonly SkillName[] = ["vocab", "grammar", "listening", "reading"];

/** The first skill that should go one level down, or null (the switch off, asked lately, or none). */
export function levelDownOffer(content: Content, input: LevelDownInput, settings: Settings, now: Date): LevelDownOffer | null {
  if (!flag(settings, "feature.leveldown")) return null;
  if (input.askedAt && now < plusDays(input.askedAt, num(settings, "leveldown.cooldown_days"))) return null;
  const row = (skill: SkillName) => input.skills.find((item) => item.skill === skill);
  const lower = (level: string) => content.levels[levelIndex(content, level) - 1];
  for (const skill of SKILL_ORDER) {
    const current = row(skill);
    if (!current) continue;
    if (skill === "vocab") {
      // known_below above the lowest level, and accuracy below the mark over enough reviews.
      const below = current.knownBelow;
      if (!below || levelIndex(content, below) <= 0) continue;
      const reviews = input.vocabReviews;
      if (reviews.length < num(settings, "leveldown.min_reviews")) continue;
      if (reviews.filter(Boolean).length / reviews.length >= num(settings, "leveldown.accuracy")) continue;
      return { skill, from: current.level, to: lower(below) };
    }
    if (skill === "grammar") {
      // Units of a lower level counted known, and few Good or Easy in the last rounds.
      const below = current.knownBelow;
      if (!below || levelIndex(content, below) <= 0) continue;
      const rounds = input.grammarRounds.slice(0, LEVELDOWN_RULE.grammarRounds);
      if (rounds.length < LEVELDOWN_RULE.grammarRounds || rounds.filter(Boolean).length >= LEVELDOWN_RULE.grammarGood) continue;
      return { skill, from: below, to: lower(below) };
    }
    // A track above the lowest level, its score low, and enough untouched texts below to read (PRD §7.5 rule 2).
    const track = skill as Track;
    if (levelIndex(content, current.level) <= 0) continue;
    const score = trackScore(input.texts, track, settings);
    if (score === null || score >= LEVELDOWN_RULE.trackBelow) continue;
    const to = lower(current.level);
    const touched = new Set(input.texts.map((state) => state.textId));
    if (content.texts.filter((text) => text.level === to && !touched.has(text.id)).length < LEVELDOWN_RULE.lowerTexts) continue;
    return { skill, from: current.level, to };
  }
  return null;
}

/**
 * «بله» (PRD §11.7): vocabulary's level and known_below one down (its cards stay); grammar's known
 * level one down, so the next new unit is that level's first (opened units stay open); a track's level.
 */
export function levelDownSkills(skills: SkillLevelE[], offer: LevelDownOffer): SkillLevelE[] {
  return skills.map((row) => {
    if (row.skill !== offer.skill) return row;
    if (offer.skill === "listening" || offer.skill === "reading") return { ...row, level: offer.to };
    return { ...row, level: offer.to, knownBelow: offer.to };
  });
}

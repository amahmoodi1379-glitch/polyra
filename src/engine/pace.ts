import { num, type Settings } from "./settings";

/**
 * Pace (PRD §9.10): a learner who gets many reviews wrong gets less new material. The mode only
 * changes with enough reviews, and there is a band between the two limits so it does not flip daily.
 */

export type PaceMode = "normal" | "slow";

/** `reviews`: scored reviews of the window, first typings already left out (§9.2). */
export function updatePace(mode: PaceMode, reviews: readonly { ok: boolean }[], settings: Settings): { mode: PaceMode; becameSlow: boolean } {
  if (reviews.length < num(settings, "pace.min_reviews")) return { mode, becameSlow: false };
  const accuracy = reviews.filter((review) => review.ok).length / reviews.length;
  if (mode === "normal" && accuracy < num(settings, "pace.slow_below")) return { mode: "slow", becameSlow: true };
  if (mode === "slow" && accuracy >= num(settings, "pace.normal_at")) return { mode: "normal", becameSlow: false };
  return { mode, becameSlow: false };
}

/** A cap in slow mode: multiplied by `pace.slow_factor` and rounded up (§9.10, §10.5). */
export const paced = (cap: number, mode: PaceMode, settings: Settings) => (mode === "slow" ? Math.ceil(cap * num(settings, "pace.slow_factor")) : cap);

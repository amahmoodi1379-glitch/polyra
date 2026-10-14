import { createEmptyCard, fsrs, generatorParameters, type Card, type FSRS, type Grade, Rating, State } from "ts-fsrs";
import { num, optionalNum, weights, type Settings } from "./settings";

/**
 * FSRS through the `ts-fsrs` library (PRD §9.1). The library decides only *when* an item comes back;
 * our own rules decide the exercise and the step. Short-term steps and fuzz are off, so the result is
 * the same on every device.
 */

/** The card as stored in `item_state.fsrs`: the library's card with dates as ISO strings. */
export type FsrsCard = {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
};

export type FsrsRating = "again" | "hard" | "good" | "easy";
export const ratingNumber: Record<FsrsRating, Grade> = { again: Rating.Again, hard: Rating.Hard, good: Rating.Good, easy: Rating.Easy };

const DAY_MS = 86_400_000;
const schedulers = new Map<string, FSRS>();

function scheduler(settings: Settings): FSRS {
  const w = weights(settings);
  const retention = num(settings, "fsrs.request_retention");
  const maxInterval = num(settings, "fsrs.maximum_interval");
  const key = `${retention}|${maxInterval}|${w?.join(",") ?? ""}`;
  let found = schedulers.get(key);
  if (!found) {
    found = fsrs(
      generatorParameters({
        request_retention: retention,
        maximum_interval: maxInterval,
        enable_short_term: false,
        enable_fuzz: false,
        ...(w ? { w } : {}),
      }),
    );
    schedulers.set(key, found);
  }
  return found;
}

const toStored = (card: Card): FsrsCard => ({
  due: card.due.toISOString(),
  stability: card.stability,
  difficulty: card.difficulty,
  elapsed_days: card.elapsed_days,
  scheduled_days: card.scheduled_days,
  learning_steps: card.learning_steps,
  reps: card.reps,
  lapses: card.lapses,
  state: card.state,
  last_review: card.last_review ? card.last_review.toISOString() : null,
});

const fromStored = (card: FsrsCard): Card => ({
  ...card,
  due: new Date(card.due),
  last_review: card.last_review ? new Date(card.last_review) : undefined,
  state: card.state as State,
});

/** A card that has never been rated, due now. */
export const emptyCard = (now: Date): FsrsCard => toStored(createEmptyCard(now));

export const isNewCard = (card: FsrsCard): boolean => card.state === State.New;

/**
 * Rates a card. After the first rating of a new item the next review is pulled in to
 * `new.first_interval_days` (PRD §9.1), unless the caller says not to (probation cards, §9.7).
 */
/** A phone whose clock is behind the last review must not break the card: for the card, time does not run backwards. */
const notBefore = (card: FsrsCard, now: Date) => (card.last_review && Date.parse(card.last_review) > now.getTime() ? new Date(card.last_review) : now);

export function rateCard(card: FsrsCard, rating: FsrsRating, at: Date, settings: Settings, firstCap = true): FsrsCard {
  const now = notBefore(card, at);
  const wasNew = isNewCard(card);
  const next = scheduler(settings).next(fromStored(card), now, ratingNumber[rating]).card;
  const firstDays = optionalNum(settings, "new.first_interval_days");
  if (wasNew && firstCap && firstDays !== null) {
    const cap = new Date(now.getTime() + firstDays * DAY_MS);
    if (next.due > cap) next.due = cap;
  }
  return toStored(next);
}

/** Probability of recall right now; 0 for a card that was never rated (PRD §9.1). */
export function retrievability(card: FsrsCard, now: Date, settings: Settings): number {
  if (isNewCard(card)) return 0;
  return scheduler(settings).get_retrievability(fromStored(card), notBefore(card, now), false);
}

/** The same card with a new due date, every other value untouched. */
export const withDue = (card: FsrsCard, due: Date): FsrsCard => ({ ...card, due: due.toISOString() });

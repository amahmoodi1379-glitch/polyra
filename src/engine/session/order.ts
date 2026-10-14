import type { ConjC, UnitC, WordC } from "../content";
import type { Ex } from "../ex";
import { SHAPE } from "../exercises";
import { shuffle, type Rng } from "../random";
import type { NotebookRef } from "../state";
import type { PlanItem, PlayKind } from "./types";

/**
 * What the build chose, before it becomes cards, and the first order of the session (PRD §10.7).
 */

type Base = { key: string; cost: number; planItem?: PlanItem };

export type Entry =
  | (Base & { t: "single"; kind: PlayKind; ex: Ex; alt: Ex | null; step: number; note?: { refType: NotebookRef; refId: number } })
  | (Base & { t: "newword"; word: WordC; ex: Ex; alt: Ex | null })
  | (Base & { t: "newconj"; table: ConjC; ex: Ex })
  | (Base & { t: "round"; step: number; questions: Ex[]; lesson: boolean })
  | (Base & { t: "newunit"; unit: UnitC; g0: Ex[]; questions: Ex[]; step: number });

/** Spreads `items` evenly between the elements of `base`. */
export function interleave<T>(base: T[], items: T[]): T[] {
  if (items.length === 0) return base;
  const out: T[] = [];
  let taken = 0;
  items.forEach((item, i) => {
    const until = Math.round(((i + 0.5) * base.length) / items.length);
    while (taken < until) out.push(base[taken++]);
    out.push(item);
  });
  while (taken < base.length) out.push(base[taken++]);
  return out;
}

/** Singles in random order with no two of the same exercise code in a row, as far as a few tries allow. */
function mixSingles(list: Entry[], rng: Rng): Entry[] {
  const code = (entry: Entry) => (entry.t === "single" ? entry.ex.code : entry.t);
  let best = shuffle(rng, list);
  const repeats = (order: Entry[]) => order.reduce((sum, entry, i) => sum + (i > 0 && code(order[i - 1]) === code(entry) ? 1 : 0), 0);
  for (let tries = 0; repeats(best) > 0 && tries < SHAPE.shuffleTries; tries++) {
    const next = shuffle(rng, list);
    if (repeats(next) < repeats(best)) best = next;
  }
  return best;
}

const stepOf = (entry: Entry) => (entry.t === "single" ? entry.step : Number.POSITIVE_INFINITY);

/**
 * PRD §10.7, "ترتیب اولیه": the two easiest reviews first, new words and blocks spread evenly, the
 * other singles mixed, and the easiest remaining single last so the session ends on a success.
 */
export function orderEntries(entries: Entry[], rng: Rng): Entry[] {
  const singles = entries.filter((entry) => entry.t === "single");
  const newWords = entries.filter((entry) => entry.t === "newword");
  const blocks = entries.filter((entry) => entry.t === "round" || entry.t === "newunit" || entry.t === "newconj");

  const byStep = (list: Entry[]) => [...list].sort((a, b) => stepOf(a) - stepOf(b));
  const reviews = byStep(singles.filter((entry) => entry.t === "single" && entry.kind === "review"));
  const first = reviews.slice(0, 2);
  let rest = singles.filter((entry) => !first.includes(entry));
  const last = byStep(rest)[0];
  rest = rest.filter((entry) => entry !== last);

  let middle = mixSingles(rest, rng);
  middle = interleave(middle, newWords);
  middle = interleave(middle, blocks);
  return [...first, ...middle, ...(last ? [last] : [])];
}

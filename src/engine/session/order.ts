import type { ConjC, UnitC, WordC } from "../content";
import type { Ex } from "../ex";
import { SHAPE } from "../exercises";
import type { PhonicsRound, PhonicsView } from "../phonics";
import { shuffle, type Rng } from "../random";
import type { NotebookRef } from "../state";
import type { TextPick } from "../texts";
import type { PlanItem, PlayKind, ProdCard } from "./types";

/**
 * What the build chose, before it becomes cards, and the first order of the session (PRD §10.7).
 */

type Base = { key: string; cost: number; planItem?: PlanItem };

export type Entry =
  | (Base & { t: "single"; kind: PlayKind; ex: Ex; alt: Ex | null; step: number; note?: { refType: NotebookRef; refId: number } })
  | (Base & { t: "newword"; word: WordC; ex: Ex; alt: Ex | null })
  | (Base & { t: "newconj"; table: ConjC; ex: Ex })
  | (Base & { t: "round"; step: number; questions: Ex[]; alts: (Ex | null)[]; lesson: boolean })
  | (Base & { t: "newunit"; unit: UnitC; g0: Ex[]; questions: Ex[]; alts: (Ex | null)[]; step: number })
  /** A sentence heard alone (PRD §7.6), placed like a single exercise. */
  | (Base & { t: "drill"; ex: Ex })
  /**
   * A text attempt (PRD §7.4), a block; `lead` puts it first: an attempt left half-way or the text of a
   * text session (§10.7). `keyWords` are shown before a first attempt (§7.5).
   */
  | (Base & { t: "text"; pick: TextPick; keyWords: number[]; lead: boolean })
  /** A phonics round (PRD §8.3), a block kept apart from the plan and placed by `phonics.position` (§10.7 rule 3). */
  | (Base & { t: "phonics"; pick: PhonicsRound; questions: Ex[]; view: PhonicsView; auto: boolean })
  /** Speaking (PRD §8b, §10.7): «بگو، بعد بشنو» is placed like a single exercise, never among the first three; a dialogue and a find-the-mistake text like blocks. */
  | (Base & { t: "prod"; prod: ProdCard });

/** «بگو، بعد بشنو» comes after the session's first three items (PRD §10.7). */
const SPEAK_AFTER = 3;

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
  const code = (entry: Entry) => (entry.t === "single" || entry.t === "drill" ? entry.ex.code : entry.t === "prod" ? entry.prod.kind : entry.t);
  let best = shuffle(rng, list);
  const repeats = (order: Entry[]) => order.reduce((sum, entry, i) => sum + (i > 0 && code(order[i - 1]) === code(entry) ? 1 : 0), 0);
  for (let tries = 0; repeats(best) > 0 && tries < SHAPE.shuffleTries; tries++) {
    const next = shuffle(rng, list);
    if (repeats(next) < repeats(best)) best = next;
  }
  return best;
}

const stepOf = (entry: Entry) => (entry.t === "single" ? entry.step : entry.t === "drill" ? entry.ex.step : Number.POSITIVE_INFINITY);

/**
 * PRD §10.7, "ترتیب اولیه": a text left half-way or a text session's text first, then the two easiest
 * reviews, new words and blocks spread evenly, the other singles mixed, and the easiest remaining
 * single last so the session ends on a success. A phonics round comes after `position` items (a new
 * word with its first exercise is one item), or last.
 */
export function orderEntries(entries: Entry[], rng: Rng, phonics: { entry: Entry; position: number } | null = null): Entry[] {
  const lead = entries.filter((entry) => entry.t === "text" && entry.lead);
  const isSpeak = (entry: Entry) => entry.t === "prod" && entry.prod.kind === "speak";
  const singles = entries.filter((entry) => entry.t === "single" || entry.t === "drill" || isSpeak(entry));
  const newWords = entries.filter((entry) => entry.t === "newword");
  const blocks = entries.filter(
    (entry) => entry.t === "round" || entry.t === "newunit" || entry.t === "newconj" || (entry.t === "text" && !entry.lead) || (entry.t === "prod" && !isSpeak(entry)),
  );

  const byStep = (list: Entry[]) => [...list].sort((a, b) => stepOf(a) - stepOf(b));
  const reviews = byStep(singles.filter((entry) => entry.t === "single" && entry.kind === "review"));
  const first = reviews.slice(0, 2);
  let rest = singles.filter((entry) => !first.includes(entry));
  const last = byStep(rest)[0];
  rest = rest.filter((entry) => entry !== last);

  let middle = mixSingles(rest, rng);
  middle = interleave(middle, newWords);
  middle = interleave(middle, blocks);
  let out = [...lead, ...first, ...middle, ...(last ? [last] : [])];
  // «بگو، بعد بشنو» never among the session's first three items (PRD §10.7).
  const early = out.slice(0, SPEAK_AFTER).filter(isSpeak);
  if (early.length > 0) {
    out = out.filter((entry) => !early.includes(entry));
    out.splice(Math.min(SPEAK_AFTER, out.length), 0, ...early);
  }
  // Rule 3: the phonics round after the session's first items, or last when it has fewer.
  if (phonics) out.splice(Math.min(phonics.position, out.length), 0, phonics.entry);
  return out;
}

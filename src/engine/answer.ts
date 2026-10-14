import type { WordC } from "./content";
import { exerciseDef, SHAPE } from "./exercises";
import { emptyCard, isNewCard, rateCard, withDue, type FsrsRating } from "./fsrs";
import type { Graded, ResultReason } from "./grade";
import type { NotebookOp } from "./notebook";
import { flag, num, type Settings } from "./settings";
import type { ConfusionE, ItemSource, ItemStateE, ItemType, NotebookRef } from "./state";
import { addDays, plusDays, tehranDayStart } from "./time";

/**
 * What one answer does to the learner's state (PRD §9.2, §9.5, §9.7, §9.9, §9.11). Pure: the old
 * state and the graded answer in, the new state and the effects out. The server writes the result;
 * the browser runs the same function to decide what comes next in the session.
 */

export type AnswerKind = "review" | "followup" | "practice";

export type AnswerCtx = {
  settings: Settings;
  now: Date;
  /** Tehran date of `now`. */
  today: string;
  /** The learner's median answer time per exercise code (PRD §9.2, "سریع"). */
  latency: Readonly<Record<string, { median: number; count: number }>>;
};

/** A brand-new item's state, made when its first exercise is answered (PRD §10.8, T79). */
export function newItemState(itemType: ItemType, itemId: number, now: Date, source: ItemSource = "normal"): ItemStateE {
  return {
    itemType,
    itemId,
    step: 1,
    fsrs: emptyCard(now),
    probation: "none",
    source,
    introducedAt: now.toISOString(),
    firstReviewDone: false,
    typedOnce: false,
    deferredUntil: null,
    frozen: false,
    nearStreak: 0,
    failCount: 0,
    roundsCount: 0,
  };
}

/** "Fast": below `fast.ratio` of the learner's median for the code, with enough earlier answers (PRD §9.2). */
export function isFast(code: string, latencyMs: number, ctx: AnswerCtx): boolean {
  const known = ctx.latency[code];
  if (!known || known.count < num(ctx.settings, "fast.min_samples")) return false;
  return latencyMs < num(ctx.settings, "fast.ratio") * known.median;
}

const tomorrowStart = (ctx: AnswerCtx) => tehranDayStart(addDays(ctx.today, 1));

const rate = (state: ItemStateE, rating: FsrsRating, ctx: AnswerCtx): ItemStateE => ({ ...state, fsrs: rateCard(state.fsrs, rating, ctx.now, ctx.settings) });

// ───────────────────────────── single-exercise items ─────────────────────────────

export type SingleInput = {
  state: ItemStateE;
  kind: AnswerKind;
  code: string;
  graded: Graded;
  latencyMs: number;
  /** The item's last step (PRD §5.3, §5.4, §6.6). */
  last: number;
  /** Whether the exercise asked for the noun's gender (W2d, or a typed noun with gender buttons). */
  gender: boolean;
};

export type SingleOutcome = {
  state: ItemStateE;
  result: Graded["result"];
  reason: ResultReason | null;
  /** The third near answer in a row turned into a wrong one (PRD §9.2); its message is shown. */
  nearStreakHit: boolean;
  rating: FsrsRating | null;
  firstTyping: boolean;
  stepBefore: number;
  stepAfter: number;
  notebook: NotebookOp[];
  /** Plan a followup: a correct review (PRD §9.2). */
  followup: boolean;
  /** The followup must be a form exercise of the last step (PRD §9.3, step 2). */
  followupFormOnly: boolean;
  /** Plan a practice one step lower after a wrong answer. */
  practice: boolean;
  /** Plan a W2d after a wrong gender (PRD §9.2). */
  genderPractice: boolean;
  /** Show the intro card again (first exercise of a new item, probation, leech). */
  introAgain: boolean;
  /** The item just became a leech (PRD §9.9). */
  leech: boolean;
  /** «این را بلدم» is not offered again for this item (PRD §9.7). */
  noIKnow: boolean;
  /** Counts for the pace check (PRD §9.10): a scored review that is not a first typing. */
  paceSample: boolean;
};

const refOf = (state: ItemStateE, code: string): NotebookRef => (state.itemType === "conjugation" ? "conjugation" : code === "W2d" ? "word_gender" : "word");

export function applySingle(input: SingleInput, ctx: AnswerCtx): SingleOutcome {
  const { kind, code, last } = input;
  const { settings } = ctx;
  const info = exerciseDef(code);
  const before = input.state;
  let state: ItemStateE = { ...before };
  let result = input.graded.result;
  const reason = input.graded.reason;
  const out: Omit<SingleOutcome, "state" | "result" | "reason" | "stepAfter"> = {
    nearStreakHit: false,
    rating: null,
    firstTyping: false,
    stepBefore: before.step,
    notebook: [],
    followup: false,
    followupFormOnly: false,
    practice: false,
    genderPractice: false,
    introAgain: false,
    leech: false,
    noIKnow: false,
    paceSample: false,
  };
  const id = state.itemId;
  const ref = refOf(state, code);
  const up = (s: ItemStateE) => ({ ...s, step: Math.min(last, s.step + 1) });
  const down = (s: ItemStateE) => ({ ...s, step: Math.max(1, s.step - 1) });
  const done = () => ({ ...out, state, result, reason, stepAfter: state.step });

  // Three near answers in a row (accent or case) count as wrong; gender does not count (§9.2, §9.11).
  if (kind !== "practice") {
    if (result === "near" && (reason === "accent" || reason === "case")) {
      state.nearStreak += 1;
      if (state.nearStreak >= num(settings, "near.max_streak")) {
        result = "wrong";
        out.nearStreakHit = true;
        state.nearStreak = 0;
      }
    } else if (result !== "near") {
      state.nearStreak = 0;
    }
  }
  const failed = result === "wrong" || result === "idk";
  const genderSlip = result === "near" && reason === "gender";
  // What the answer says for the notebook (§9.5): a right answer counts, a wrong one starts over.
  const noteAnswer = () => {
    if (failed) out.notebook.push({ op: "wrong", refType: ref, refId: id });
    else if (result === "correct") {
      out.notebook.push({ op: "correct", refType: ref, refId: id });
      if (input.gender && ref === "word") out.notebook.push({ op: "correct", refType: "word_gender", refId: id });
    }
    if (genderSlip) out.notebook.push({ op: "wrong", refType: "word_gender", refId: id });
  };

  if (kind === "practice") {
    // No FSRS and no step (§9.2); the notebook still hears about it.
    noteAnswer();
    out.practice = failed;
    out.genderPractice = genderSlip;
    return done();
  }

  if (kind === "followup") {
    // A followup moves the step but never FSRS (§9.2).
    if (result === "correct") state = up(state);
    else if (failed) state = down(state);
    noteAnswer();
    out.practice = failed;
    out.genderPractice = genderSlip;
    return done();
  }

  // ── review ──
  const wasLast = before.step >= last;

  // A probation card's first real review (PRD §9.7, §9.11): none of the other exceptions apply.
  if (state.probation !== "none") {
    state.probation = "none";
    state.firstReviewDone = true;
    if (info.typed) state.typedOnce = true;
    if (failed) {
      state = { ...rate(state, "again", ctx), step: 1 };
      out.rating = "again";
      out.notebook.push({ op: "wrong", refType: ref, refId: id });
      out.introAgain = true;
      out.noIKnow = true;
      out.paceSample = true;
      return done();
    }
  }

  // The first exercise of a new item, right after the intro card (§9.2): no penalty, back tomorrow.
  if (!state.firstReviewDone && isNewCard(state.fsrs)) {
    state.firstReviewDone = true;
    if (failed) {
      state.fsrs = withDue(state.fsrs, tomorrowStart(ctx));
      out.introAgain = true;
      out.practice = true;
      return done();
    }
  }
  state.firstReviewDone = true;

  // The first typing review (§9.2): a wrong answer costs Hard and a step, not Again.
  if (info.recall && !state.typedOnce) {
    state.typedOnce = true;
    out.firstTyping = true;
    if (failed) {
      state = down(rate(state, "hard", ctx));
      out.rating = "hard";
      out.practice = true;
      noteAnswer();
      return done();
    }
  }

  if (result === "correct") {
    const rating: FsrsRating = info.recall && isFast(code, input.latencyMs, ctx) ? "easy" : "good";
    state = up(rate(state, rating, ctx));
    out.rating = rating;
    // A conjugation card on its last step has no followup (§9.2).
    out.followup = !(wasLast && state.itemType === "conjugation");
    out.followupFormOnly = wasLast;
  } else if (result === "near") {
    state = rate(state, "hard", ctx);
    out.rating = "hard";
    out.genderPractice = genderSlip;
  } else {
    state = down(rate(state, "again", ctx));
    out.rating = "again";
    state.failCount += 1;
    out.practice = true;
  }
  noteAnswer();

  // A leech (§9.9): rest for a week; its notebook entries and its practice go.
  if (failed && state.failCount % num(settings, "leech.threshold") === 0) {
    out.leech = true;
    out.practice = false;
    out.introAgain = true;
    state.deferredUntil = plusDays(ctx.now, num(settings, "leech.rest_days")).toISOString();
    const main: NotebookRef = state.itemType === "conjugation" ? "conjugation" : "word";
    out.notebook = [{ op: "remove", refType: main, refId: id }];
    if (main === "word") out.notebook.push({ op: "remove", refType: "word_gender", refId: id });
  }
  out.paceSample = !out.firstTyping;
  return done();
}

// ───────────────────────────── grammar rounds ─────────────────────────────

export type RoundAnswer = { code: string; result: Graded["result"]; latencyMs: number; targetId: number | null };

export type RoundOutcome = {
  /** Whether the round was scored (three answers or more, PRD §6.5 rule 8). */
  scored: boolean;
  state: ItemStateE;
  s: number;
  rating: FsrsRating | null;
  firstTyping: boolean;
  stepBefore: number;
  stepAfter: number;
  notebook: NotebookOp[];
  /** Show the lesson before the unit's next round (a new unit failed its first round). */
  lessonAgain: boolean;
  paceSample: boolean;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** A typed round whose answers were all quick for their codes (PRD §9.2, round table). */
function roundFast(answers: RoundAnswer[], ctx: AnswerCtx): boolean {
  const min = num(ctx.settings, "fast.min_samples");
  const ratios: number[] = [];
  for (const answer of answers) {
    const known = ctx.latency[answer.code];
    if (!known || known.count < min || known.median <= 0) return false;
    ratios.push(answer.latencyMs / known.median);
  }
  return ratios.length > 0 && median(ratios) < num(ctx.settings, "fast.ratio");
}

/**
 * Scores a grammar round (PRD §9.2, "آیتم چندسؤالی"). `state` is the unit's state, or a new one from
 * `newItemState` when this is the unit's first round.
 */
export function applyRound(state: ItemStateE, step: number, answers: RoundAnswer[], ctx: AnswerCtx, last: number): RoundOutcome {
  const before = state.step;
  const firstRound = !state.firstReviewDone && isNewCard(state.fsrs);
  const wrongTargets = answers.filter((answer) => (answer.result === "wrong" || answer.result === "idk") && answer.targetId !== null);
  const notebook: NotebookOp[] = firstRound ? [] : wrongTargets.map((answer) => ({ op: "wrong" as const, refType: "grammar_target" as const, refId: answer.targetId! }));
  const okTargets = answers.filter((answer) => (answer.result === "correct" || answer.result === "near") && answer.targetId !== null);
  notebook.push(...okTargets.map((answer) => ({ op: "correct" as const, refType: "grammar_target" as const, refId: answer.targetId! })));
  const base = { state, s: 0, rating: null, firstTyping: false, stepBefore: before, stepAfter: before, notebook, lessonAgain: false, paceSample: false };
  if (answers.length < SHAPE.roundMin) return { ...base, scored: false };

  const s = answers.filter((answer) => answer.result === "correct" || answer.result === "near").length / answers.length;
  let next: ItemStateE = { ...state, roundsCount: state.roundsCount + 1, firstReviewDone: true };
  const typedRound = step >= 5;
  let firstTyping = false;
  let rating: FsrsRating;

  if (firstRound && s < SHAPE.roundHard) {
    // A new unit's first round without a pass: no rating, back tomorrow with the lesson (§9.2).
    next.fsrs = withDue(next.fsrs, tomorrowStart(ctx));
    return { ...base, scored: true, state: next, s, lessonAgain: true };
  }
  if (typedRound && !state.typedOnce) {
    next.typedOnce = true;
    firstTyping = true;
  }
  if (s === 1 && typedRound && roundFast(answers, ctx)) rating = "easy";
  else if (s >= SHAPE.roundGood) rating = "good";
  else if (s >= SHAPE.roundHard) rating = "hard";
  else rating = firstTyping ? "hard" : "again";

  next = { ...next, fsrs: rateCard(next.fsrs, rating, ctx.now, ctx.settings) };
  if (s >= SHAPE.roundGood) next.step = Math.min(last, next.step + 1);
  else if (s < SHAPE.roundHard) next.step = Math.max(1, next.step - 1);
  return { ...base, scored: true, state: next, s, rating, firstTyping, stepAfter: next.step, paceSample: !firstTyping };
}

// ───────────────────────────── confusion pairs ─────────────────────────────

export type ConfusionOutcome = { pairs: ConfusionE[]; pair: ConfusionE | null; showCard: boolean };

/** Orders a pair so each two words have one row. */
export const pairKey = (a: number, b: number) => (a < b ? [a, b] : [b, a]);

/**
 * Counts a wrong answer that belongs to another word (PRD §9.9). Two words with the same lemma never
 * make a pair. The card shows when the count reaches `confusion.min_count`, the feature is on, the
 * pair was known when the session was built, and the card was not shown in the last
 * `confusion.card_gap_days`.
 */
export function applyConfusion(
  pairs: readonly ConfusionE[],
  word: Pick<WordC, "id" | "lemma">,
  other: Pick<WordC, "id" | "lemma"> | undefined,
  ctx: AnswerCtx,
  knownAtStart: (a: number, b: number) => boolean,
): ConfusionOutcome {
  if (!other || other.id === word.id || other.lemma.toLowerCase() === word.lemma.toLowerCase()) return { pairs: [...pairs], pair: null, showCard: false };
  const [a, b] = pairKey(word.id, other.id);
  const found = pairs.find((pair) => pair.wordId === a && pair.otherWordId === b);
  const pair: ConfusionE = found
    ? { ...found, count: found.count + 1, lastAt: ctx.now.toISOString() }
    : { wordId: a, otherWordId: b, count: 1, lastAt: ctx.now.toISOString(), cardShownAt: null };
  const gapMs = num(ctx.settings, "confusion.card_gap_days") * 86_400_000;
  const rested = !pair.cardShownAt || ctx.now.getTime() - Date.parse(pair.cardShownAt) >= gapMs;
  const showCard = flag(ctx.settings, "feature.confusion_card") && pair.count >= num(ctx.settings, "confusion.min_count") && rested && knownAtStart(a, b);
  if (showCard) pair.cardShownAt = ctx.now.toISOString();
  const rest = pairs.filter((item) => item !== found);
  return { pairs: [...rest, pair], pair, showCard };
}

/** The strongest pair a word has, for wrong options and the leech card (PRD §5.5, §9.9). */
export function strongestPartner(pairs: readonly ConfusionE[], wordId: number, minCount = 1): number | null {
  let best: ConfusionE | null = null;
  for (const pair of pairs) {
    if (pair.wordId !== wordId && pair.otherWordId !== wordId) continue;
    if (pair.count < minCount) continue;
    if (!best || pair.count > best.count || (pair.count === best.count && pair.lastAt > best.lastAt)) best = pair;
  }
  if (!best) return null;
  return best.wordId === wordId ? best.otherWordId : best.wordId;
}

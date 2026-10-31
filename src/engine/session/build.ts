import { newItemState, strongestPartner } from "../answer";
import { buildG0, buildWordEx, type BuildEnv } from "../build";
import { genderButtons, levelIndex, type ConjC, type Content, type Track, type UnitC, type WordC } from "../content";
import { buildDrillEx, drillGate, drillKey, drillOrder } from "../drill";
import type { Ex } from "../ex";
import { exerciseDef, SHAPE, type TimeKey } from "../exercises";
import { isNewCard, retrievability } from "../fsrs";
import { grammarProgress, grammarLevel, indexItems, vocabProgress, type ItemIndex } from "../levels";
import { notebookOrder, openEntries } from "../notebook";
import { paced, updatePace, type PaceMode } from "../pace";
import { buildRound, CONJ_LAST_STEP, lastStepOfUnit, lastStepOfWord, pickConjEx, pickTargetEx, pickUnitEx, pickWordEx, type Purpose } from "../pick";
import { seeded, shuffle } from "../random";
import { num, type Settings } from "../settings";
import { itemKey, parseItemKey, type ConfusionE, type ItemStateE, type ItemType, type LearnerSnapshot, type NotebookE, type SkillName } from "../state";
import {
  attemptCost,
  dueTexts,
  indexTextStates,
  newText,
  otherTrack,
  partialText,
  remainingCost,
  stageRules,
  stagesOf,
  textKey,
  textProgress,
  withinTextTime,
  type TextEnv,
  type TextPick,
} from "../texts";
import { addDays, tehranDayStart } from "../time";
import { conjCandidates, introducedCardWords, nextNewWords, nextUnit } from "./newmaterial";
import { orderEntries, type Entry } from "./order";
import type { Card, PlanItem, Scope, SessionPlan } from "./types";
import { lessonView, makeEnv, tableView, textView, wordCard } from "./views";

/**
 * Builds a session (PRD §10.2–§10.11): vocabulary, grammar, sentence listening (§7.6) and texts
 * (§7.4, §7.5). Phonics, production and placement samples are added by their own phases.
 */

export type BuildOptions = {
  scope: Scope;
  /** Minutes the learner chose (PRD §3.1); «امروز وقت کم دارم» uses `quick.minutes`. */
  lengthMin: number;
  noAudio: boolean;
  /** The answer to the word-cap question (PRD §3.7). */
  cap: "more" | "none" | null;
  /** The answer to «پیش از جلسه متن» (PRD §10.11): take the long text, or build without it. */
  text?: "confirmed" | "later" | null;
  /** The session id, the seed of every random choice. */
  seed: string;
};

export type BuildEffects = {
  paceMode: PaceMode;
  /** Backlog mode: the shares are 75/15/0/10 (PRD §10.6). */
  backlog: boolean;
  becameSlow: boolean;
  /** Reviews moved to later days by the backlog rule (PRD §10.6). */
  spread: { key: string; deferredUntil: string }[];
  lastSpreadDate: string | null;
  wordsCapToday: number;
  capPromptShown: boolean;
  /** Due items with no exercise to show, a content problem the server logs for the teacher. */
  unbuildable: string[];
  /** A text session was built (PRD §10.11): `is_text_session` and today's `text_session_done`. */
  textSession: boolean;
};

export type BuildResult =
  | { kind: "ask_word_cap"; learned: number; canMore: boolean; effects: BuildEffects }
  /** «پیش از جلسه متن»: the waiting text is longer than the session (PRD §10.11). */
  | { kind: "ask_text_session"; minutes: number; textId: number; track: Track; effects: BuildEffects }
  | { kind: "nothing_left"; effects: BuildEffects }
  | { kind: "empty_notebook"; effects: BuildEffects }
  | { kind: "plan"; plan: SessionPlan; effects: BuildEffects };

type Ctx = {
  content: Content;
  learner: LearnerSnapshot;
  settings: Settings;
  now: Date;
  today: string;
  env: BuildEnv;
  audio: boolean;
  items: ItemIndex;
  states: Map<string, ItemStateE>;
};

const time = (settings: Settings, ex: Ex | null | undefined) => (ex ? num(settings, exerciseDef(ex.code).time) : 0);
const TIME_KEYS: TimeKey[] = ["time.choice", "time.type_word", "time.type_sentence", "time.arrange"];
const exCost = (settings: Settings, list: (Ex | null | undefined)[]) =>
  list.reduce((sum, ex) => sum + (ex ? (ex.code === "G0" ? num(settings, "time.g0") : time(settings, ex)) : 0), 0);

/** Due (PRD §9.1): due by the end of today and not resting. A frozen card is never due (`activeCards`). */
export function isDue(state: ItemStateE, now: Date, today: string): boolean {
  if (state.deferredUntil && Date.parse(state.deferredUntil) > now.getTime()) return false;
  return Date.parse(state.fsrs.due) < tehranDayStart(addDays(today, 1)).getTime();
}

type CardRef = Pick<ItemStateE, "itemType" | "itemId">;

/**
 * Which cards still take part (PRD §13.5–§13.7, «frozen»): the item is published and not suspended,
 * its level is open, a word has a card and a table is a review card. Any other card is frozen: never
 * due, never counted or practised, and back by itself when its item is. Nothing is written for it.
 */
export function activeCards(content: Content): (card: CardRef) => boolean {
  const open = new Set(content.openLevels);
  const units = new Map(content.units.map((unit) => [unit.id, unit]));
  const unitByCode = new Map(content.units.map((unit) => [unit.unitCode, unit]));
  const tables = new Map(content.conjugations.map((table) => [table.id, table]));
  return (card) => {
    if (card.itemType === "word") {
      const word = content.words.get(card.itemId);
      return !!word && !word.noCard && open.has(word.level);
    }
    if (card.itemType === "grammar_unit") {
      const unit = units.get(card.itemId);
      return !!unit && open.has(unit.level);
    }
    const table = tables.get(card.itemId);
    if (!table?.reviewCard) return false;
    // A table belongs to the level of its unit; one without a unit to the level of its verb.
    const level = table.unitCode ? unitByCode.get(table.unitCode)?.level : content.words.get(table.wordId)?.level;
    return !!level && open.has(level);
  };
}

/** The card a notebook entry practises: its word, its table, or the unit of its grammar target. */
export function noteCard(content: Content, note: NotebookE): CardRef | null {
  if (note.refType === "conjugation") return { itemType: "conjugation", itemId: note.refId };
  if (note.refType === "grammar_target") {
    const target = content.targets.get(note.refId);
    return target ? { itemType: "grammar_unit", itemId: target.targetId } : null;
  }
  return { itemType: "word", itemId: note.refId };
}

/** The new-material caps of a session length (PRD §10.5), halved in slow pace (PRD §9.10). */
export function sessionCaps(settings: Settings, lengthMin: number, mode: PaceMode) {
  const perSession = Math.ceil((num(settings, "new.words_per_5min") * lengthMin) / 5);
  // No setting lets a session or the soft cap pass the hard daily cap (PRD §10.5).
  const wordsHard = num(settings, "new.words_daily_hard");
  return {
    words: Math.min(wordsHard, paced(perSession, mode, settings)),
    wordsSoft: Math.min(wordsHard, paced(Math.max(num(settings, "new.words_daily_soft"), perSession), mode, settings)),
    wordsHard,
    units: Math.ceil((num(settings, "new.units_per_10min") * lengthMin) / 10),
    unitsDaily: paced(num(settings, "new.units_daily"), mode, settings),
    conj: paced(num(settings, "new.conj_per_session"), mode, settings),
    conjDaily: paced(num(settings, "new.conj_daily"), mode, settings),
  };
}

/** Due cards above this count are spread over the next days (PRD §10.6); it follows the learner's session length. */
export const backlogThreshold = (settings: Settings, sessionLength: number) => Math.ceil((num(settings, "backlog.per_5min") * sessionLength) / 5);

const SKILL_ORDER: SkillName[] = ["vocab", "grammar", "listening", "reading"];

/**
 * The skill of the next pack of new material (PRD §10.2, step 7): vocabulary first, then the lowest
 * «progress + 0.1 × packs taken», ties in the order vocabulary, grammar, listening, reading.
 */
export function nextSkill(
  skills: ReadonlySet<SkillName>,
  progress: Partial<Record<SkillName, number>>,
  packs: Partial<Record<SkillName, number>>,
  first: boolean,
): SkillName | null {
  if (first && skills.has("vocab")) return "vocab";
  const score = (skill: SkillName) => (progress[skill] ?? 0) + SHAPE.packWeight * (packs[skill] ?? 0);
  return SKILL_ORDER.filter((skill) => skills.has(skill)).sort((a, b) => score(a) - score(b) || SKILL_ORDER.indexOf(a) - SKILL_ORDER.indexOf(b))[0] ?? null;
}

/**
 * Listening's place in the pick while it has only sentence drills. Its bar counts texts (PRD §9.6), so
 * drills alone would keep it at zero and take most packs; it stands one pack above the weakest other
 * skill instead, so a drill pack takes its turn after that skill's (DECISIONS.md).
 */
export const drillStandIn = (others: ReadonlySet<SkillName>, progress: Partial<Record<SkillName, number>>) =>
  Math.min(...[...others].map((skill) => progress[skill] ?? 0)) + SHAPE.packWeight;

/** Backlog spread (PRD §10.6): keep the weakest `threshold`, move the rest over the next days. */
export function spreadBacklog(due: { key: string; r: number }[], threshold: number, today: string, settings: Settings) {
  const sorted = [...due].sort((a, b) => a.r - b.r);
  const keep = sorted.slice(0, threshold);
  const rest = sorted.slice(threshold);
  const days = num(settings, "backlog.spread_days");
  const spread = rest.map((item, i) => ({ key: item.key, deferredUntil: tehranDayStart(addDays(today, 1 + Math.floor((i * days) / rest.length))).toISOString() }));
  return { keep, spread };
}

// ───────────────────────────── per-item exercises ─────────────────────────────

/**
 * The item's history as if `shown` had just come, so an exercise made in advance is chosen the way it
 * would be when it comes: not the code or the sentence just seen, the least seen code first (PRD §9.3,
 * steps 4 and 5).
 */
function afterShown(env: BuildEnv, key: string, shown: (Ex | null)[]): BuildEnv {
  const seen = shown.filter((ex): ex is Ex => !!ex);
  if (seen.length === 0) return env;
  return {
    ...env,
    history: (other) => {
      const base = env.history(other);
      if (other !== key) return base;
      const codeCounts = { ...base.codeCounts };
      for (const ex of seen) codeCounts[ex.code] = (codeCounts[ex.code] ?? 0) + 1;
      const sentences = seen.flatMap((ex) => (ex.sentenceId === null ? [] : [ex.sentenceId]));
      return { codeCounts, lastCode: seen.at(-1)!.code, recentSentences: [...sentences, ...base.recentSentences] };
    },
  };
}

function wordItem(ctx: Ctx, word: WordC, step: number, isNew: boolean): { primary: Ex | null; item: PlanItem } {
  const { env, audio } = ctx;
  const last = lastStepOfWord(word);
  const key = itemKey("word", word.id);
  const state = ctx.states.get(key);
  const pick = (shown: (Ex | null)[], at: number, purpose: Purpose, formOnly = false, withAudio = audio) =>
    pickWordEx(afterShown(env, key, shown), word, at, purpose, { formOnly, audio: withAudio });
  const alt = (shown: (Ex | null)[], ex: Ex | null, at: number, purpose: Purpose, formOnly = false) => (ex && ex.audio && audio ? pick(shown, at, purpose, formOnly, false) : null);

  let primary: Ex | null;
  if (state && state.probation !== "none") {
    // The first real review of a probation card is typed: W5a, or a step-3 meaning exercise (PRD §9.7).
    primary = word.mastery === "recognize" ? pick([], 3, "review") : (buildWordEx(env, word, "W5a") ?? pick([], step, "review"));
  } else {
    primary = pick([], step, "review");
  }
  const nextStep = Math.min(last, step + 1);
  const followup = step < last ? pick([primary], nextStep, "followup") : null;
  const followupForm = pick([primary], last, "followup", true);
  // Two practices after wrong answers: the first follows the review, the second the first practice.
  const fallStep = Math.max(1, step - 1);
  const first = pick([primary], fallStep, "practice");
  const practices = [
    { ex: first, shown: [primary] },
    { ex: pick([primary, first], fallStep, "practice"), shown: [primary, first] },
  ].filter((practice) => practice.ex);
  const gender = genderButtons(word, ctx.content.language) ? buildWordEx(env, word, "W2d") : null;
  return {
    primary,
    item: {
      key,
      isNew,
      last,
      followup,
      followupAlt: alt([primary], followup, nextStep, "followup"),
      followupForm,
      followupFormAlt: alt([primary], followupForm, last, "followup", true),
      fallback: practices.map((practice) => practice.ex!),
      fallbackAlt: practices.map((practice) => alt(practice.shown, practice.ex, fallStep, "practice")),
      gender,
    },
  };
}

function conjItem(ctx: Ctx, table: ConjC, step: number, isNew: boolean): { primary: Ex | null; item: PlanItem } {
  const { env, audio } = ctx;
  const key = itemKey("conjugation", table.id);
  const pick = (shown: (Ex | null)[], at: number, purpose: Purpose) => pickConjEx(afterShown(env, key, shown), table, at, purpose, { audio });
  const primary = pick([], step, "review");
  const followup = step < CONJ_LAST_STEP ? pick([primary], step + 1, "followup") : null;
  const fallStep = Math.max(1, step - 1);
  const first = pick([primary], fallStep, "practice");
  const fallback = [first, pick([primary, first], fallStep, "practice")].filter((ex): ex is Ex => !!ex);
  return {
    primary,
    item: {
      key,
      isNew,
      last: CONJ_LAST_STEP,
      followup,
      followupAlt: null,
      followupForm: null,
      followupFormAlt: null,
      fallback,
      fallbackAlt: fallback.map(() => null),
      gender: null,
    },
  };
}

/**
 * A speed bound, not tuning (DECISIONS.md): after this many due items in a row that do not fit the
 * time left, the rest of a long backlog waits without being built.
 */
const MISSES = 24;

const altOf = (ctx: Ctx, ex: Ex, rebuild: () => Ex | null) => (ex.audio && ctx.audio ? rebuild() : null);

// ───────────────────────────── the build ─────────────────────────────

export function buildSession(content: Content, learner: LearnerSnapshot, settings: Settings, now: Date, today: string, opts: BuildOptions): BuildResult {
  const { scope } = opts;
  const lengthMin = scope === "quick" ? num(settings, "quick.minutes") : opts.lengthMin;
  /** The session's time (PRD §10.1); a text left half-way or a text session's text takes its share first (§10.2 steps 0 and 2). */
  const fullBudget = lengthMin * 60;
  let budget = fullBudget;
  /** The shortest exercise: below it nothing more fits. */
  const minCost = Math.min(...TIME_KEYS.map((key) => num(settings, key)));
  const env = makeEnv(content, learner, settings, seeded(opts.seed, "build"));
  const items = indexItems(learner.items);
  const states = new Map(learner.items.map((item) => [itemKey(item.itemType, item.itemId), item]));
  const active = activeCards(content);
  const ctx: Ctx = { content, learner, settings, now, today, env, audio: !opts.noAudio, items, states };

  // Step 1: pace, backlog and the word cap (PRD §10.2).
  const pace = updatePace(
    learner.enrollment.paceMode,
    learner.paceReviews.filter((review) => !review.firstTyping),
    settings,
  );
  const threshold = backlogThreshold(settings, learner.sessionLength);
  const dueStates = learner.items.filter((state) => isDue(state, now, today) && active(state));
  const withR = dueStates.map((state) => ({ key: itemKey(state.itemType, state.itemId), r: retrievability(state.fsrs, now, settings) }));
  let spread: BuildEffects["spread"] = [];
  let lastSpreadDate = learner.enrollment.lastSpreadDate;
  let eligible = withR;
  if (withR.length > threshold && lastSpreadDate !== today) {
    const result = spreadBacklog(withR, threshold, today, settings);
    spread = result.spread;
    eligible = result.keep;
    lastSpreadDate = today;
  }
  const backlog = eligible.length >= threshold;
  const share = (part: string) => num(settings, backlog ? `backlog.share.${part}` : `share.${part}`);

  const caps = sessionCaps(settings, opts.lengthMin, pace.mode);
  const hard = caps.wordsHard;
  let wordsCapToday = learner.today.wordsCapToday ?? caps.wordsSoft;
  let capPromptShown = learner.today.capPromptShown;
  let wordsBlocked = false;
  const wantsNew = scope === "mixed" || scope === "vocab";
  if (wantsNew && learner.today.newWords >= wordsCapToday) {
    if (wordsCapToday >= hard) wordsBlocked = true;
    else if (opts.cap === "more") {
      wordsCapToday = Math.min(hard, wordsCapToday + num(settings, "new.words_daily_step"));
      capPromptShown = false;
    } else if (opts.cap === "none" || capPromptShown) {
      wordsBlocked = true;
      capPromptShown = true;
    } else {
      const effects = { paceMode: pace.mode, backlog, becameSlow: pace.becameSlow, spread, lastSpreadDate, wordsCapToday, capPromptShown: true, unbuildable: [], textSession: false };
      return { kind: "ask_word_cap", learned: learner.today.newWords, canMore: wordsCapToday < hard, effects };
    }
  }
  const effects: BuildEffects = { paceMode: pace.mode, backlog, becameSlow: pace.becameSlow, spread, lastSpreadDate, wordsCapToday, capPromptShown, unbuildable: [], textSession: false };

  const entries: Entry[] = [];
  const planItems: Record<string, PlanItem> = {};
  const inPlan = new Set<string>();
  let used = 0;
  const add = (entry: Entry) => {
    entries.push(entry);
    inPlan.add(entry.key);
    if (entry.planItem) planItems[entry.planItem.key] = entry.planItem;
    used += entry.cost;
  };

  const textScope = scope === "listening" || scope === "reading";
  const wantWords = scope !== "grammar" && !textScope;
  const wantGrammar = scope !== "vocab" && !textScope;

  // ── Texts (PRD §7.4, §7.5): none without sound in listening; only mixed and the two text sessions have them ──
  const textTracks: Track[] = (scope === "mixed" ? (["listening", "reading"] as Track[]) : textScope ? [scope] : []).filter(
    (track) => ctx.audio || track === "reading",
  );
  const tenv: TextEnv = {
    content,
    settings,
    now,
    known: env.known,
    states: indexTextStates(learner.texts),
    levelOf: (track) => learner.skills.find((skill) => skill.skill === track)?.level ?? content.levels[0],
  };
  const textsPlanned = new Set<number>();
  const newTexts: Record<Track, number> = { listening: 0, reading: 0 };
  const textSec = { ...learner.today.newTextSec };
  const textEntry = (pick: TextPick, lead: boolean): Entry => {
    const cost = pick.resume ? remainingCost(pick.text, pick.track, pick.resume, settings) : attemptCost(pick.text, pick.track, pick, settings);
    // «کلمه‌های این متن» before a first attempt: its key words the learner does not know yet (PRD §7.5).
    const keyWords =
      pick.attempt === 1 && !pick.resume ? pick.text.keyWordIds.filter((id) => content.words.has(id) && !env.known(id)).slice(0, num(settings, "keywords.max")) : [];
    return { t: "text", key: textKey(pick.text.id), pick, keyWords, lead, cost };
  };
  const noteText = (entry: Entry) => {
    if (entry.t !== "text") return;
    textsPlanned.add(entry.pick.text.id);
    if (entry.pick.attempt === 1) newTexts[entry.pick.track]++;
    if (entry.pick.attempt === 1 && !entry.pick.resume) textSec[entry.pick.track] += entry.cost;
  };
  /** A text placed first takes its time from the session's budget, not from a share (PRD §10.2). */
  const leadText = (entry: Entry) => {
    entries.push(entry);
    inPlan.add(entry.key);
    noteText(entry);
    budget = Math.max(0, budget - entry.cost);
  };
  const addText = (entry: Entry) => {
    add(entry);
    noteText(entry);
  };
  /** A new text of a track that fits today's new text time (PRD §10.5) and, in a mixed session, its share and one per track. */
  const newTextEntry = (track: Track, mixed: boolean): Entry | null => {
    if (mixed && newTexts[track] >= 1) return null;
    const pick = newText(tenv, track, textsPlanned);
    if (!pick) return null;
    const entry = textEntry(pick, false);
    if (!withinTextTime(settings, textSec[track], entry.cost)) return null;
    if (mixed && entry.cost > num(settings, "text.max_share") * fullBudget) return null;
    return entry;
  };

  // Step 0: an attempt left half-way comes first, from where it was (PRD §7.4, T91).
  const partial = textTracks.length ? partialText(tenv, textTracks) : null;
  if (partial) leadText(textEntry(partial, true));

  // Step 2: a text session after `text.session_every` mixed sessions without a text (PRD §10.11, T65).
  if (
    scope === "mixed" &&
    !partial &&
    !backlog &&
    opts.text !== "later" &&
    learner.mixedWithoutText >= num(settings, "text.session_every") &&
    !learner.today.textSessionDone &&
    learner.enrollment.textPromptDate !== today
  ) {
    const due = dueTexts(tenv, textTracks)[0];
    const fresh = due
      ? null
      : textTracks
          .map((track) => ({ track, entry: newTextEntry(track, false) }))
          .filter((item): item is { track: Track; entry: Entry } => item.entry !== null)
          .sort((a, b) => textProgress(content, tenv.states, a.track, tenv.levelOf(a.track), settings).progress - textProgress(content, tenv.states, b.track, tenv.levelOf(b.track), settings).progress)[0]?.entry;
    const entry = due ? textEntry(due, true) : fresh ? { ...fresh, lead: true } : null;
    if (entry && entry.t === "text") {
      if (entry.cost > budget && opts.text !== "confirmed") {
        return { kind: "ask_text_session", minutes: Math.max(1, Math.round(entry.cost / 60)), textId: entry.pick.text.id, track: entry.pick.track, effects };
      }
      leadText(entry);
      effects.textSession = true;
    }
  }

  // Sentence listening (PRD §7.6): the suitable sentences in order, found as far as they are taken; none without sound.
  const fromStart = (() => {
    const vocab = learner.skills.find((skill) => skill.skill === "vocab");
    return !vocab?.knownBelow || levelIndex(content, vocab.knownBelow) <= 0;
  })();
  const drillAt =
    ctx.audio && (scope === "mixed" || scope === "listening") && !drillGate(fromStart, introducedCardWords(content, learner.items), settings)
      ? lazyList(drillOrder(env, new Map(learner.drills.map((drill) => [drill.sentenceId, drill])), now))
      : () => undefined;
  const drillsOpen = drillAt(0) !== undefined;
  const drillTaken = new Set<number>();
  /** Up to `count` drills that fit `room`, skipping sentences any exercise of the plan already uses. */
  const nextDrills = (count: number, room: number): Entry[] => {
    if (!drillsOpen) return [];
    const used = new Set<number>(drillTaken);
    for (const entry of entries) for (const ex of entryExercises(entry)) if (ex.sentenceId !== null) used.add(ex.sentenceId);
    const out: Entry[] = [];
    let total = 0;
    for (let i = 0, pick = drillAt(0); pick && out.length < count; pick = drillAt(++i)) {
      const { sentence, code } = pick;
      if (used.has(sentence.id)) continue;
      const ex = buildDrillEx(env, sentence, code);
      if (!ex) continue;
      const cost = time(settings, ex);
      if (total + cost > room) break;
      total += cost;
      used.add(sentence.id);
      out.push({ t: "drill", key: drillKey(sentence.id), ex, cost });
    }
    return out;
  };
  const addDrills = (list: Entry[]) => {
    for (const entry of list) {
      add(entry);
      if (entry.t === "drill" && entry.ex.sentenceId !== null) drillTaken.add(entry.ex.sentenceId);
    }
  };

  // ── Reviews (step 4), R ascending, with the round cap; a grammar session is bound by its time only (DECISIONS.md) ──
  const roundCap = scope === "grammar" ? Number.POSITIVE_INFINITY : Math.ceil((num(settings, "cap.rounds_per_5min") * lengthMin) / 5);
  let rounds = 0;
  // Without sound some items may have nothing to show; with sound every due item should.
  const unbuildable = (key: string) => {
    if (ctx.audio) effects.unbuildable.push(key);
    return null;
  };
  const dueEntry = (key: string): Entry | null => {
    const state = states.get(key)!;
    const { type, id } = parseItemKey(key);
    if (type === "word") {
      if (!wantWords) return null;
      const word = content.words.get(id)!;
      const built = wordItem(ctx, word, state.step, false);
      if (!built.primary) return unbuildable(key);
      const alt = altOf(ctx, built.primary, () => pickWordEx(env, word, state.step, "review", { audio: false }));
      return { t: "single", key, kind: "review", ex: built.primary, alt, step: state.step, cost: exCost(settings, [built.primary, built.item.followup]), planItem: built.item };
    }
    if (type === "conjugation") {
      if (!wantGrammar) return null;
      const table = content.conjugations.find((item) => item.id === id)!;
      const built = conjItem(ctx, table, state.step, false);
      if (!built.primary) return unbuildable(key);
      return {
        t: "single",
        key,
        kind: "review",
        ex: built.primary,
        alt: null,
        step: state.step,
        cost: exCost(settings, [built.primary, built.item.followup]),
        planItem: built.item,
      };
    }
    if (!wantGrammar || rounds >= roundCap) return null;
    const unit = content.units.find((item) => item.id === id)!;
    const round = buildRound(env, unit, state.step, { audio: ctx.audio });
    if (!round) return unbuildable(key);
    // The lesson comes again before the round of a unit that failed its first round or is stuck (PRD §6.2, §9.2).
    const lesson = isNewCard(state.fsrs) || (state.roundsCount >= num(settings, "grammar.unlock_after_rounds") && state.step < 2);
    return { t: "round", key, step: round.step, questions: round.questions, alts: round.alts, lesson, cost: exCost(settings, round.questions) + (lesson ? num(settings, "time.grammar_lesson") : 0) };
  };
  const reviewBudget = share("review") * budget;
  let spent = 0;
  const leftover: string[] = [];
  const dueKeys = [...eligible].sort((a, b) => a.r - b.r).map((item) => item.key);
  // Attempts 2 and 3 first, the oldest first: `text.due_per_15min` of them, each within `text.max_share` of the session (PRD §10.2 step 4).
  if (scope === "mixed") {
    const cap = Math.ceil((num(settings, "text.due_per_15min") * lengthMin) / 15);
    let taken = 0;
    for (const pick of dueTexts(tenv, textTracks)) {
      if (taken >= cap) break;
      if (textsPlanned.has(pick.text.id)) continue;
      const entry = textEntry(pick, false);
      if (entry.cost > num(settings, "text.max_share") * fullBudget || spent + entry.cost > reviewBudget) continue;
      addText(entry);
      spent += entry.cost;
      taken++;
    }
  }
  if (scope !== "notebook" && scope !== "extra" && !textScope) {
    let misses = 0;
    for (const key of dueKeys) {
      const room = (scope === "quick" ? budget : reviewBudget) - spent;
      // Once not even the shortest exercise fits, or many in a row have not, the rest wait without being built (a long backlog).
      if (room < minCost || misses >= MISSES) {
        leftover.push(key);
        continue;
      }
      const entry = dueEntry(key);
      if (!entry) continue;
      if (entry.cost <= room) {
        add(entry);
        if (entry.t === "round") rounds++;
        spent += entry.cost;
        misses = 0;
      } else {
        leftover.push(key);
        misses++;
      }
    }
  }

  // ── Notebook (step 5) ──
  const entriesOpen = notebookOrder(openEntries(learner.notebook, now));
  const noteEntry = (note: NotebookE): Entry | null => {
    if (note.refType === "grammar_target") {
      if (!wantGrammar) return null;
      const target = content.targets.get(note.refId);
      if (!target) return null;
      const unit = content.units.find((item) => item.id === target.targetId);
      const state = unit ? states.get(itemKey("grammar_unit", unit.id)) : undefined;
      if (!unit || !state || !active(state) || inPlan.has(itemKey("grammar_unit", unit.id))) return null;
      const ex = pickTargetEx(env, unit, target, state.step, { audio: ctx.audio });
      if (!ex) return null;
      return {
        t: "single",
        key: `t:${target.id}`,
        kind: "practice",
        ex,
        alt: altOf(ctx, ex, () => pickTargetEx(env, unit, target, state.step, { audio: false })),
        step: state.step,
        cost: time(settings, ex),
        note: { refType: note.refType, refId: note.refId },
      };
    }
    if (note.refType === "conjugation") {
      if (!wantGrammar) return null;
      const key = itemKey("conjugation", note.refId);
      const table = content.conjugations.find((item) => item.id === note.refId);
      const state = states.get(key);
      if (!table || !state || !active(state) || inPlan.has(key)) return null;
      const built = conjItem(ctx, table, state.step, false);
      const ex = pickConjEx(env, table, state.step, "practice", { audio: ctx.audio });
      if (!ex) return null;
      return {
        t: "single",
        key,
        kind: "practice",
        ex,
        alt: null,
        step: state.step,
        cost: time(settings, ex),
        note: { refType: note.refType, refId: note.refId },
        planItem: built.item,
      };
    }
    if (!wantWords) return null;
    const key = itemKey("word", note.refId);
    const word = content.words.get(note.refId);
    const state = states.get(key);
    if (!word || !state || !active(state) || inPlan.has(key)) return null;
    const built = wordItem(ctx, word, state.step, false);
    const ex = note.refType === "word_gender" ? buildWordEx(env, word, "W2d") : pickWordEx(env, word, state.step, "practice", { audio: ctx.audio });
    if (!ex) return null;
    const alt = note.refType === "word_gender" ? null : altOf(ctx, ex, () => pickWordEx(env, word, state.step, "practice", { audio: false }));
    return { t: "single", key, kind: "practice", ex, alt, step: state.step, cost: time(settings, ex), note: { refType: note.refType, refId: note.refId }, planItem: built.item };
  };
  const noteLeft: NotebookE[] = [];
  if (scope !== "extra" && !textScope) {
    const noteBudget = scope === "notebook" ? budget : scope === "quick" ? budget - used : share("notebook") * budget;
    let noteSpent = 0;
    for (const note of entriesOpen) {
      if (noteBudget - noteSpent < minCost) {
        noteLeft.push(note);
        continue;
      }
      const entry = noteEntry(note);
      if (!entry) continue;
      if (noteSpent + entry.cost <= noteBudget) {
        add(entry);
        noteSpent += entry.cost;
      } else noteLeft.push(note);
    }
    if (scope === "notebook" && entries.length === 0) return { kind: "empty_notebook", effects };
  }

  // ── «تمرین بیشتر روی کلمه‌های امروز» (PRD §10.8) ──
  if (scope === "extra") {
    for (const key of learner.touchedToday) {
      const state = states.get(key);
      if (!state || !active(state) || inPlan.has(key)) continue;
      const { type, id } = parseItemKey(key);
      let entry: Entry | null = null;
      if (type === "word") {
        const word = content.words.get(id)!;
        const built = wordItem(ctx, word, state.step, false);
        const ex = pickWordEx(env, word, state.step, "practice", { audio: ctx.audio });
        if (ex) entry = { t: "single", key, kind: "practice", ex, alt: altOf(ctx, ex, () => pickWordEx(env, word, state.step, "practice", { audio: false })), step: state.step, cost: time(settings, ex), planItem: built.item };
      } else if (type === "conjugation") {
        const table = content.conjugations.find((item) => item.id === id)!;
        const ex = pickConjEx(env, table, state.step, "practice", { audio: ctx.audio });
        if (ex) entry = { t: "single", key, kind: "practice", ex, alt: null, step: state.step, cost: time(settings, ex) };
      } else {
        // A unit gets one question of its step, like a notebook sentence (PRD §10.8, «هر کدام با یک تمرین»).
        const unit = content.units.find((item) => item.id === id)!;
        const ex = pickUnitEx(env, unit, state.step, { audio: ctx.audio });
        if (ex) entry = { t: "single", key, kind: "practice", ex, alt: altOf(ctx, ex, () => pickUnitEx(env, unit, state.step, { audio: false })), step: state.step, cost: time(settings, ex) };
      }
      if (entry && used + entry.cost <= budget) add(entry);
    }
  }

  // ── New material (step 7) ──
  const summary = { newWords: 0, newUnits: 0, newConj: 0 };
  if (scope === "mixed" || scope === "vocab" || scope === "grammar") {
    const vocab = learner.skills.find((skill) => skill.skill === "vocab") ?? { skill: "vocab" as const, level: content.levels[0], knownBelow: content.levels[0] };
    const grammarOpen = !fromStart || introducedCardWords(content, learner.items) >= num(settings, "gate.grammar_words");
    let wordRoom = wordsBlocked ? 0 : Math.max(0, Math.min(caps.words, wordsCapToday - learner.today.newWords));
    let unitRoom = Math.max(0, Math.min(caps.units, caps.unitsDaily - learner.today.newUnits));
    let conjRoom = Math.max(0, Math.min(caps.conj, caps.conjDaily - learner.today.newConj));
    const chosenWords: number[] = [];
    const chosenUnits = new Map(items.units);
    const chosenConj = new Map(items.conjugations);
    const skills = new Set<SkillName>();
    if (scope !== "grammar") skills.add("vocab");
    if (scope !== "vocab" && grammarOpen) skills.add("grammar");
    const progress: Partial<Record<SkillName, number>> = {
      vocab: vocabProgress(content, items, vocab, settings).progress,
      grammar: grammarProgress(content, items, grammarLevel(content, items), settings).progress,
    };
    // Listening's pack is a new text, else three drills; reading's is a new text (PRD §10.2 step 7).
    const textPacks: Partial<Record<Track, Entry | null>> = {};
    const textPack = (track: Track) => {
      if (!(track in textPacks)) textPacks[track] = scope === "mixed" && textTracks.includes(track) ? newTextEntry(track, true) : null;
      return textPacks[track] ?? null;
    };
    const barOf = (track: Track) => textProgress(content, tenv.states, track, tenv.levelOf(track), settings).progress;
    const standIn = drillStandIn(skills, progress);
    if (textPack("listening")) progress.listening = barOf("listening");
    else if (scope === "mixed" && drillsOpen) progress.listening = standIn;
    if (progress.listening !== undefined) skills.add("listening");
    if (textPack("reading")) {
      progress.reading = barOf("reading");
      skills.add("reading");
    }
    const packs: Partial<Record<SkillName, number>> = { vocab: 0, grammar: 0, listening: 0, reading: 0 };
    let first = true;
    let left = budget - used;
    const known = (wordId: number) => env.known(wordId) || chosenWords.includes(wordId);
    let queueUsed = 0;
    /** What a pack may cost: the time left and a little more (PRD §10.2, `session.overrun`). */
    const room = () => left * (1 + num(settings, "session.overrun"));

    const vocabPack = (): Entry[] | null => {
      if (wordRoom <= 0) return null;
      const { words, fromQueue } = nextNewWords(
        { content, learner, settings, now, taken: (id) => items.words.has(id) || chosenWords.includes(id), known, queueUsed },
        Math.min(SHAPE.packWords, wordRoom),
        [...chosenWords].reverse().concat(learner.recentIntroWordIds),
      );
      const out: Entry[] = [];
      let total = 0;
      for (const [i, word] of words.entries()) {
        const built = wordItem(ctx, word, 1, true);
        if (!built.primary) continue;
        // The queue's words come first; only they count in `queue.daily`, also when a later word is in the queue too.
        if (i < fromQueue) built.item.queued = true;
        const alt = altOf(ctx, built.primary, () => pickWordEx(env, word, 1, "review", { audio: false }));
        const cost = num(settings, "time.intro_card") + exCost(settings, [built.primary, built.item.followup]);
        // "Up to three": a short session in backlog mode still gets the one or two that fit (PRD §10.6 example, T21).
        if (total + cost > room()) break;
        total += cost;
        out.push({ t: "newword", key: itemKey("word", word.id), word, ex: built.primary, alt, cost, planItem: built.item });
      }
      return out.length ? out : null;
    };
    const grammarPack = (): Entry[] | null => {
      if (unitRoom > 0) {
        const unit = nextUnit(content, chosenUnits, settings);
        if (unit) {
          const entry = newUnitEntry(ctx, unit);
          if (entry) return [entry];
        }
      }
      if (conjRoom <= 0) return null;
      const tables = conjCandidates(content, chosenUnits, chosenConj, known).slice(0, Math.min(SHAPE.packConj, conjRoom));
      const out: Entry[] = [];
      let total = 0;
      for (const table of tables) {
        const built = conjItem(ctx, table, 1, true);
        if (!built.primary) continue;
        const cost = num(settings, "time.intro_card") + exCost(settings, [built.primary, built.item.followup]);
        if (total + cost > room()) break;
        total += cost;
        out.push({ t: "newconj", key: itemKey("conjugation", table.id), table, ex: built.primary, cost, planItem: built.item });
      }
      return out.length ? out : null;
    };

    while (left > 0 && skills.size > 0) {
      const skill = nextSkill(skills, progress, packs, first)!;
      first = false;
      const text = skill === "listening" || skill === "reading" ? textPack(skill) : null;
      const pack =
        skill === "vocab" ? vocabPack() : skill === "grammar" ? grammarPack() : text ? [text] : skill === "listening" ? nullIfEmpty(nextDrills(SHAPE.packDrills, room())) : null;
      const cost = pack?.reduce((sum, entry) => sum + entry.cost, 0) ?? 0;
      if (!pack || cost > room()) {
        // A text that does not fit leaves listening its drills.
        if (text && skill === "listening") {
          textPacks.listening = null;
          progress.listening = Math.max(progress.listening ?? 0, standIn);
          if (drillsOpen) continue;
        }
        skills.delete(skill);
        continue;
      }
      for (const entry of pack) {
        if (entry.t === "drill") {
          addDrills([entry]);
          continue;
        }
        if (entry.t === "text") {
          addText(entry);
          // One new text per track in a mixed session; listening goes on with drills (PRD §10.5).
          textPacks[entry.pick.track] = null;
          // A text comes in one track only: the other track's pack is chosen again if it was the same text.
          const other = textPacks[otherTrack(entry.pick.track)];
          if (other?.t === "text" && other.pick.text.id === entry.pick.text.id) delete textPacks[otherTrack(entry.pick.track)];
          if (entry.pick.track === "listening" && drillsOpen) progress.listening = Math.max(progress.listening ?? 0, standIn);
          else skills.delete(entry.pick.track);
          continue;
        }
        add(entry);
        if (entry.t === "newword") {
          chosenWords.push(entry.word.id);
          if (entry.planItem?.queued) queueUsed++;
          wordRoom--;
          summary.newWords++;
        } else if (entry.t === "newunit") {
          chosenUnits.set(entry.unit.id, placeholder("grammar_unit", entry.unit.id, now));
          unitRoom--;
          summary.newUnits++;
        } else if (entry.t === "newconj") {
          chosenConj.set(entry.table.id, placeholder("conjugation", entry.table.id, now));
          conjRoom--;
          summary.newConj++;
        }
      }
      packs[skill] = (packs[skill] ?? 0) + 1;
      left = budget - used;
    }
  }

  // ── «شنیداری» and «خواندن» (PRD §10.4): due attempts, then new texts while time is left; listening fills the rest with drills ──
  if (textScope && textTracks.length > 0) {
    const track = textTracks[0];
    let longer = null as Entry | null;
    /** The session's first text may be longer than the session: it is asked about first (§10.4, «پیش از جلسه متن»). */
    const place = (entry: Entry) => {
      if (used + entry.cost <= budget) {
        addText(entry);
        return true;
      }
      if (textsPlanned.size > 0) return false;
      if (opts.text === "confirmed") {
        addText(entry);
        return true;
      }
      if (opts.text !== "later") longer ??= entry;
      return false;
    };
    for (const pick of dueTexts(tenv, [track])) if (!textsPlanned.has(pick.text.id)) place(textEntry(pick, false));
    for (let entry = newTextEntry(track, false); entry && place(entry); entry = newTextEntry(track, false));
    if (longer && textsPlanned.size === 0 && longer.t === "text") {
      return { kind: "ask_text_session", minutes: Math.max(1, Math.round(longer.cost / 60)), textId: longer.pick.text.id, track, effects };
    }
  }
  if (scope === "listening") addDrills(nextDrills(Number.POSITIVE_INFINITY, budget - used));

  // ── What is left (step 8): more reviews, then more notebook, then sentence drills ──
  if (scope !== "notebook" && scope !== "extra" && !textScope) {
    let misses = 0;
    for (const key of leftover) {
      if (budget - used < minCost || misses >= MISSES) break;
      // A notebook entry may have taken the item meanwhile: one card per item (rule 14).
      if (inPlan.has(key)) continue;
      const entry = dueEntry(key);
      if (!entry) continue;
      if (used + entry.cost <= budget) {
        add(entry);
        if (entry.t === "round") rounds++;
        misses = 0;
      } else misses++;
    }
    for (const note of noteLeft) {
      if (budget - used < minCost) break;
      const entry = noteEntry(note);
      if (entry && !inPlan.has(entry.key) && used + entry.cost <= budget) add(entry);
    }
  }

  if (scope === "mixed") addDrills(nextDrills(Number.POSITIVE_INFINITY, budget - used));

  if (entries.length === 0) return { kind: "nothing_left", effects };
  const plan = assemble(ctx, opts, fullBudget, entries, planItems, summary);
  return { kind: "plan", plan, effects };
}

/** The exercises an entry already holds, to keep a drill off a sentence the plan uses. */
function entryExercises(entry: Entry): Ex[] {
  if (entry.t === "text") return [];
  if (entry.t === "single" || entry.t === "newword" || entry.t === "newconj" || entry.t === "drill") return [entry.ex];
  if (entry.t === "newunit") return [...entry.g0, ...entry.questions];
  return entry.questions;
}

const nullIfEmpty = <T,>(list: T[]): T[] | null => (list.length > 0 ? list : null);

/** The items of `source` by position, each one taken from it only when first asked for. */
function lazyList<T>(source: Iterator<T>): (index: number) => T | undefined {
  const seen: T[] = [];
  let done = false;
  return (index) => {
    while (!done && seen.length <= index) {
      const next = source.next();
      if (next.done) done = true;
      else seen.push(next.value);
    }
    return seen[index];
  };
}

/** Stands for an item chosen in this session, so the unlock rules see it as opened. */
const placeholder = (type: ItemType, id: number, now: Date): ItemStateE => newItemState(type, id, now);

/** A new unit: lesson, three warm-ups and the first round at step 1 (PRD §6.5, §10.1). */
function newUnitEntry(ctx: Ctx, unit: UnitC): Entry | null {
  const { env, settings } = ctx;
  const round = buildRound(env, unit, 1, { audio: ctx.audio });
  if (!round) return null;
  const targets = shuffle(
    env.rng,
    (ctx.content.unitTargets.get(unit.id) ?? []).filter((target) => target.blanks === 1),
  );
  const g0: Ex[] = [];
  for (const target of targets) {
    if (g0.length >= SHAPE.warmups) break;
    const ex = buildG0(env, unit, target);
    if (ex) g0.push(ex);
  }
  const cost = num(settings, "time.grammar_lesson") + g0.length * num(settings, "time.g0") + exCost(settings, round.questions);
  return { t: "newunit", key: itemKey("grammar_unit", unit.id), unit, g0, questions: round.questions, alts: round.alts, step: round.step, cost };
}

/** Turns the chosen entries into the saved plan with its cards in order (PRD §10.7). */
function assemble(
  ctx: Ctx,
  opts: BuildOptions,
  budget: number,
  entries: Entry[],
  items: Record<string, PlanItem>,
  summary: { newWords: number; newUnits: number; newConj: number },
): SessionPlan {
  const { content, env, learner, settings } = ctx;
  const groups = orderEntries(entries, seeded(opts.seed, "order"));
  let n = 0;
  const id = () => `k${++n}`;
  const queue: Card[] = [];
  const rounds: SessionPlan["rounds"] = {};
  for (const entry of groups) {
    const block = `b${n + 1}`;
    if (entry.t === "single") {
      queue.push({ id: id(), t: "ex", item: entry.key, kind: entry.kind, ex: entry.ex, alt: entry.alt ?? null, ...(entry.note ? { note: entry.note } : {}) });
    } else if (entry.t === "drill") {
      queue.push({ id: id(), t: "drill", item: entry.key, ex: entry.ex });
    } else if (entry.t === "text") {
      const { pick } = entry;
      if (entry.keyWords.length > 0) queue.push({ id: id(), t: "textwords", item: entry.key, block, words: entry.keyWords });
      const stages = stagesOf(pick.attempt);
      const cost = attemptCost(pick.text, pick.track, pick, settings);
      stages.slice(pick.resume ? Math.max(0, stages.indexOf(pick.resume.stage)) : 0).forEach((stage, i) =>
        queue.push({
          id: id(),
          t: "text",
          item: entry.key,
          block,
          text: {
            textId: pick.text.id,
            track: pick.track,
            attempt: pick.attempt,
            stage,
            set: pick.set,
            borrowed: pick.borrowed,
            rules: stageRules(pick.text, pick.track, pick.attempt, stage),
            cost,
            resume: i === 0 ? pick.resume : null,
          },
        }),
      );
    } else if (entry.t === "newword") {
      queue.push({ id: id(), t: "intro", item: entry.key, block, fresh: true });
      queue.push({ id: id(), t: "ex", item: entry.key, kind: "review", ex: entry.ex, alt: entry.alt ?? null, block, fresh: true });
    } else if (entry.t === "newconj") {
      queue.push({ id: id(), t: "table", item: entry.key, block, fresh: true });
      queue.push({ id: id(), t: "ex", item: entry.key, kind: "review", ex: entry.ex, alt: null, block, fresh: true });
    } else {
      const fresh = entry.t === "newunit";
      if (entry.t === "newunit" || entry.lesson) queue.push({ id: id(), t: "lesson", item: entry.key, block, ...(fresh ? { fresh } : {}) });
      if (entry.t === "newunit") for (const ex of entry.g0) queue.push({ id: id(), t: "g0", item: entry.key, ex, block, fresh });
      entry.questions.forEach((ex, i) =>
        queue.push({
          id: id(),
          t: "round",
          item: entry.key,
          kind: "review",
          ex,
          alt: entry.alts[i] ?? null,
          block,
          step: entry.step,
          ...(fresh ? { fresh } : {}),
          ...(i === entry.questions.length - 1 ? { roundEnd: true } : {}),
        }),
      );
      const unit = content.units.find((item) => itemKey("grammar_unit", item.id) === entry.key)!;
      rounds[block] = { item: entry.key, step: entry.step, last: lastStepOfUnit(env, unit), answers: [] };
    }
  }

  // What the browser needs to show and to run the same rules (PRD §10.7).
  const keys = new Set(queue.map((card) => card.item));
  const states: SessionPlan["states"] = {};
  const words: SessionPlan["words"] = {};
  const lessons: SessionPlan["lessons"] = {};
  const tables: SessionPlan["tables"] = {};
  const texts: SessionPlan["texts"] = {};
  const textStates: SessionPlan["textStates"] = {};
  const textStateMap = new Map(learner.texts.map((state) => [`${state.textId}:${state.track}`, state]));
  const addWord = (wordId: number) => {
    const word = content.words.get(wordId);
    if (word && !words[wordId]) words[wordId] = wordCard(env, word);
  };
  const pairs = new Map<string, ConfusionE>();
  const minCount = num(settings, "confusion.min_count");
  for (const card of queue) {
    if (card.t === "textwords") for (const wordId of card.words ?? []) addWord(wordId);
    if (card.t !== "text" || !card.text || texts[card.text.textId]) continue;
    const text = content.texts.find((item) => item.id === card.text!.textId)!;
    texts[text.id] = textView(content, text, card.text.track);
    textStates[card.item] = textStateMap.get(`${text.id}:${card.text.track}`) ?? null;
  }
  for (const key of keys) {
    if (key.startsWith("l:") || key.startsWith("x:")) continue;
    if (key.startsWith("t:")) {
      const target = content.targets.get(Number(key.slice(2)));
      const unit = target && content.units.find((item) => item.id === target.targetId);
      if (unit) lessons[unit.id] = lessonView(env, unit);
      continue;
    }
    states[key] = ctx.states.get(key) ?? null;
    const { type, id: itemId } = parseItemKey(key);
    if (type === "word") {
      addWord(itemId);
      for (const pair of learner.confusions) {
        if (pair.wordId !== itemId && pair.otherWordId !== itemId) continue;
        pairs.set(`${pair.wordId}:${pair.otherWordId}`, pair);
        if (pair.count >= minCount - 1) addWord(pair.wordId === itemId ? pair.otherWordId : pair.wordId);
      }
      const partner = strongestPartner(learner.confusions, itemId);
      if (partner) addWord(partner);
    } else if (type === "grammar_unit") {
      const unit = content.units.find((item) => item.id === itemId);
      if (unit) lessons[unit.id] = lessonView(env, unit);
    } else {
      const table = content.conjugations.find((item) => item.id === itemId);
      if (table) tables[table.id] = tableView(content, table);
    }
  }
  const reviews = entries.filter((entry) => entry.t === "single" || entry.t === "round" || entry.t === "drill" || (entry.t === "text" && entry.pick.attempt > 1)).length;
  const newTexts = entries.filter((entry) => entry.t === "text" && entry.pick.attempt === 1 && !entry.pick.resume).length;
  const resumeText = entries.some((entry) => entry.t === "text" && !!entry.pick.resume);
  return {
    version: 1,
    scope: opts.scope,
    budgetSec: budget,
    noAudio: opts.noAudio,
    seed: opts.seed,
    queue,
    doneCount: 0,
    plannedCount: queue.length,
    nextCard: n + 1,
    items,
    states,
    words,
    lessons,
    tables,
    texts,
    textStates,
    pairs: [...pairs.values()],
    pairsAtStart: [...pairs.keys()],
    latency: learner.latency,
    rounds,
    counters: { answered: 0, ok: 0, wrongStreak: 0, rescuePending: false, practice: {}, correct: 0, wrong: 0 },
    summary: { reviews, newItems: summary.newWords + summary.newUnits + summary.newConj + newTexts, ...summary, newTexts, resumeText },
  };
}

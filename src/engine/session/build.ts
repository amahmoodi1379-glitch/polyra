import { newItemState, strongestPartner } from "../answer";
import { buildG0, buildWordEx, type BuildEnv } from "../build";
import { genderButtons, levelIndex, type ConjC, type Content, type UnitC, type WordC } from "../content";
import type { Ex } from "../ex";
import { exerciseDef, SHAPE } from "../exercises";
import { isNewCard, retrievability } from "../fsrs";
import { grammarProgress, grammarLevel, indexItems, vocabProgress, type ItemIndex } from "../levels";
import { notebookOrder, openEntries } from "../notebook";
import { paced, updatePace, type PaceMode } from "../pace";
import { buildRound, CONJ_LAST_STEP, lastStepOfUnit, lastStepOfWord, pickConjEx, pickTargetEx, pickWordEx, type Purpose } from "../pick";
import { seeded, shuffle } from "../random";
import { num, type Settings } from "../settings";
import { itemKey, parseItemKey, type ConfusionE, type ItemStateE, type ItemType, type LearnerSnapshot, type NotebookE, type SkillName } from "../state";
import { addDays, tehranDayStart } from "../time";
import { conjCandidates, introducedCardWords, nextNewWords, nextUnit } from "./newmaterial";
import { orderEntries, type Entry } from "./order";
import type { Card, PlanItem, Scope, SessionPlan } from "./types";
import { lessonView, makeEnv, tableView, wordCard } from "./views";

/**
 * Builds a session (PRD §10.2–§10.9) for the vocabulary and grammar skills. Texts, phonics, sentence
 * listening, production and placement samples come in later phases and are left out here.
 */

export type BuildOptions = {
  scope: Scope;
  /** Minutes the learner chose (PRD §3.1); «امروز وقت کم دارم» uses `quick.minutes`. */
  lengthMin: number;
  noAudio: boolean;
  /** The answer to the word-cap question (PRD §3.7). */
  cap: "more" | "none" | null;
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
};

export type BuildResult =
  | { kind: "ask_word_cap"; learned: number; canMore: boolean; effects: BuildEffects }
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
const exCost = (settings: Settings, list: (Ex | null | undefined)[]) =>
  list.reduce((sum, ex) => sum + (ex ? (ex.code === "G0" ? num(settings, "time.g0") : time(settings, ex)) : 0), 0);

/** Due (PRD §9.1): due by the end of today, not resting, not frozen. */
export function isDue(state: ItemStateE, now: Date, today: string): boolean {
  if (state.frozen) return false;
  if (state.deferredUntil && Date.parse(state.deferredUntil) > now.getTime()) return false;
  return Date.parse(state.fsrs.due) < tehranDayStart(addDays(today, 1)).getTime();
}

/** Items the visible content still has, so a retired word never comes back in a session. */
function stillThere(content: Content, state: ItemStateE): boolean {
  if (state.itemType === "word") return content.words.has(state.itemId);
  if (state.itemType === "grammar_unit") return content.units.some((unit) => unit.id === state.itemId);
  return content.conjugations.some((table) => table.id === state.itemId);
}

/** The new-material caps of a session length (PRD §10.5), halved in slow pace (PRD §9.10). */
export function sessionCaps(settings: Settings, lengthMin: number, mode: PaceMode) {
  const perSession = Math.ceil((num(settings, "new.words_per_5min") * lengthMin) / 5);
  return {
    words: paced(perSession, mode, settings),
    wordsSoft: paced(Math.max(num(settings, "new.words_daily_soft"), perSession), mode, settings),
    wordsHard: num(settings, "new.words_daily_hard"),
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

function wordItem(ctx: Ctx, word: WordC, step: number, isNew: boolean): { primary: Ex | null; item: PlanItem } {
  const { env, audio } = ctx;
  const last = lastStepOfWord(word);
  const key = itemKey("word", word.id);
  const state = ctx.states.get(key);
  const pick = (at: number, purpose: Purpose, formOnly = false, withAudio = audio) => pickWordEx(env, word, at, purpose, { formOnly, audio: withAudio });
  const alt = (ex: Ex | null, at: number, purpose: Purpose, formOnly = false) => (ex && ex.audio && audio ? pick(at, purpose, formOnly, false) : null);

  let primary: Ex | null;
  if (state && state.probation !== "none") {
    // The first real review of a probation card is typed: W5a, or a step-3 meaning exercise (PRD §9.7).
    primary = word.mastery === "recognize" ? pick(3, "review") : (buildWordEx(env, word, "W5a") ?? pick(step, "review"));
  } else {
    primary = pick(step, "review");
  }
  const nextStep = Math.min(last, step + 1);
  const followup = step < last ? pick(nextStep, "followup") : null;
  const followupForm = pick(last, "followup", true);
  const fallStep = Math.max(1, step - 1);
  const fallback = [pick(fallStep, "practice"), pick(fallStep, "practice")].filter((ex): ex is Ex => !!ex);
  const gender = genderButtons(word, ctx.content.language) ? buildWordEx(env, word, "W2d") : null;
  return {
    primary,
    item: {
      key,
      isNew,
      last,
      followup,
      followupAlt: alt(followup, nextStep, "followup"),
      followupForm,
      followupFormAlt: alt(followupForm, last, "followup", true),
      fallback,
      fallbackAlt: fallback.map((ex) => alt(ex, fallStep, "practice")),
      gender,
    },
  };
}

function conjItem(ctx: Ctx, table: ConjC, step: number, isNew: boolean): { primary: Ex | null; item: PlanItem } {
  const { env, audio } = ctx;
  const pick = (at: number, purpose: Purpose) => pickConjEx(env, table, at, purpose, { audio });
  const primary = pick(step, "review");
  const followup = step < CONJ_LAST_STEP ? pick(step + 1, "followup") : null;
  const fallStep = Math.max(1, step - 1);
  const fallback = [pick(fallStep, "practice"), pick(fallStep, "practice")].filter((ex): ex is Ex => !!ex);
  return {
    primary,
    item: {
      key: itemKey("conjugation", table.id),
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

const altOf = (ctx: Ctx, ex: Ex, rebuild: () => Ex | null) => (ex.audio && ctx.audio ? rebuild() : null);

// ───────────────────────────── the build ─────────────────────────────

export function buildSession(content: Content, learner: LearnerSnapshot, settings: Settings, now: Date, today: string, opts: BuildOptions): BuildResult {
  const { scope } = opts;
  const lengthMin = scope === "quick" ? num(settings, "quick.minutes") : opts.lengthMin;
  const budget = lengthMin * 60;
  const env = makeEnv(content, learner, settings, seeded(opts.seed, "build"));
  const items = indexItems(learner.items);
  const states = new Map(learner.items.map((item) => [itemKey(item.itemType, item.itemId), item]));
  const ctx: Ctx = { content, learner, settings, now, today, env, audio: !opts.noAudio, items, states };

  // Step 1: pace, backlog and the word cap (PRD §10.2).
  const pace = updatePace(
    learner.enrollment.paceMode,
    learner.paceReviews.filter((review) => !review.firstTyping),
    settings,
  );
  const threshold = backlogThreshold(settings, learner.sessionLength);
  const dueStates = learner.items.filter((state) => isDue(state, now, today) && stillThere(content, state));
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
      const effects = { paceMode: pace.mode, backlog, becameSlow: pace.becameSlow, spread, lastSpreadDate, wordsCapToday, capPromptShown: true };
      return { kind: "ask_word_cap", learned: learner.today.newWords, canMore: wordsCapToday < hard, effects };
    }
  }
  const effects: BuildEffects = { paceMode: pace.mode, backlog, becameSlow: pace.becameSlow, spread, lastSpreadDate, wordsCapToday, capPromptShown };

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

  const wantWords = scope !== "grammar";
  const wantGrammar = scope !== "vocab";

  // ── Reviews (step 4), R ascending, with the round cap ──
  const roundCap = Math.ceil((num(settings, "cap.rounds_per_5min") * lengthMin) / 5);
  let rounds = 0;
  const dueEntry = (key: string): Entry | null => {
    const state = states.get(key)!;
    const { type, id } = parseItemKey(key);
    if (type === "word") {
      if (!wantWords) return null;
      const word = content.words.get(id)!;
      const built = wordItem(ctx, word, state.step, false);
      if (!built.primary) return null;
      const alt = altOf(ctx, built.primary, () => pickWordEx(env, word, state.step, "review", { audio: false }));
      return { t: "single", key, kind: "review", ex: built.primary, alt, step: state.step, cost: exCost(settings, [built.primary, built.item.followup]), planItem: built.item };
    }
    if (type === "conjugation") {
      if (!wantGrammar) return null;
      const table = content.conjugations.find((item) => item.id === id)!;
      const built = conjItem(ctx, table, state.step, false);
      if (!built.primary) return null;
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
    if (!round) return null;
    // The lesson comes again before the round of a unit that failed its first round or is stuck (PRD §6.2, §9.2).
    const lesson = isNewCard(state.fsrs) || (state.roundsCount >= num(settings, "grammar.unlock_after_rounds") && state.step < 2);
    return { t: "round", key, step: round.step, questions: round.questions, lesson, cost: exCost(settings, round.questions) + (lesson ? num(settings, "time.grammar_lesson") : 0) };
  };
  const reviewBudget = share("review") * budget;
  let spent = 0;
  const leftover: string[] = [];
  const dueKeys = [...eligible].sort((a, b) => a.r - b.r).map((item) => item.key);
  if (scope !== "notebook" && scope !== "extra") {
    for (const key of dueKeys) {
      const entry = dueEntry(key);
      if (!entry) continue;
      if (spent + entry.cost <= (scope === "quick" ? budget : reviewBudget)) {
        add(entry);
        if (entry.t === "round") rounds++;
        spent += entry.cost;
      } else {
        leftover.push(key);
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
      if (!unit || !state || inPlan.has(itemKey("grammar_unit", unit.id))) return null;
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
      if (!table || !state || inPlan.has(key)) return null;
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
    if (!word || !state || inPlan.has(key)) return null;
    const built = wordItem(ctx, word, state.step, false);
    const ex = note.refType === "word_gender" ? buildWordEx(env, word, "W2d") : pickWordEx(env, word, state.step, "practice", { audio: ctx.audio });
    if (!ex) return null;
    const alt = note.refType === "word_gender" ? null : altOf(ctx, ex, () => pickWordEx(env, word, state.step, "practice", { audio: false }));
    return { t: "single", key, kind: "practice", ex, alt, step: state.step, cost: time(settings, ex), note: { refType: note.refType, refId: note.refId }, planItem: built.item };
  };
  const noteLeft: NotebookE[] = [];
  if (scope !== "extra") {
    const noteBudget = scope === "notebook" ? budget : scope === "quick" ? budget - used : share("notebook") * budget;
    let noteSpent = 0;
    for (const note of entriesOpen) {
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
      if (!state || !stillThere(content, state) || inPlan.has(key)) continue;
      const { type, id } = parseItemKey(key);
      let entry: Entry | null = null;
      if (type === "word") {
        const word = content.words.get(id)!;
        const built = wordItem(ctx, word, state.step, false);
        const ex = pickWordEx(env, word, state.step, "practice", { audio: ctx.audio });
        if (ex) entry = { t: "single", key, kind: "practice", ex, alt: null, step: state.step, cost: time(settings, ex), planItem: built.item };
      } else if (type === "conjugation") {
        const table = content.conjugations.find((item) => item.id === id)!;
        const ex = pickConjEx(env, table, state.step, "practice", { audio: ctx.audio });
        if (ex) entry = { t: "single", key, kind: "practice", ex, alt: null, step: state.step, cost: time(settings, ex) };
      }
      if (entry && used + entry.cost <= budget) add(entry);
    }
  }

  // ── New material (step 7) ──
  const summary = { newWords: 0, newUnits: 0, newConj: 0 };
  if (scope === "mixed" || scope === "vocab" || scope === "grammar") {
    const vocab = learner.skills.find((skill) => skill.skill === "vocab") ?? { skill: "vocab" as const, level: content.levels[0], knownBelow: content.levels[0] };
    const fromStart = !vocab.knownBelow || levelIndex(content, vocab.knownBelow) <= 0;
    const grammarOpen = !fromStart || introducedCardWords(content, learner.items) >= num(settings, "gate.grammar_words");
    let wordRoom = wordsBlocked ? 0 : Math.max(0, Math.min(caps.words, wordsCapToday - learner.today.newWords));
    let unitRoom = Math.max(0, Math.min(caps.units, caps.unitsDaily - learner.today.newUnits));
    let conjRoom = Math.max(0, Math.min(caps.conj, caps.conjDaily - learner.today.newConj));
    const chosenWords: number[] = [];
    const chosenUnits = new Map(items.units);
    const chosenConj = new Map(items.conjugations);
    const progress: Partial<Record<SkillName, number>> = {
      vocab: vocabProgress(content, items, vocab, settings).progress,
      grammar: grammarProgress(content, items, grammarLevel(content, items), settings).progress,
    };
    const packs: Partial<Record<SkillName, number>> = { vocab: 0, grammar: 0 };
    const skills = new Set<SkillName>();
    if (scope !== "grammar") skills.add("vocab");
    if (scope !== "vocab" && grammarOpen) skills.add("grammar");
    let first = true;
    let left = budget - used;
    const known = (wordId: number) => env.known(wordId) || chosenWords.includes(wordId);
    let queueUsed = 0;

    const vocabPack = (): Entry[] | null => {
      if (wordRoom <= 0) return null;
      const { words } = nextNewWords(
        { content, learner, settings, now, taken: (id) => items.words.has(id) || chosenWords.includes(id), known, queueUsed },
        Math.min(SHAPE.packWords, wordRoom),
        [...chosenWords].reverse().concat(learner.recentIntroWordIds),
      );
      const out: Entry[] = [];
      for (const word of words) {
        const built = wordItem(ctx, word, 1, true);
        if (!built.primary) continue;
        const alt = altOf(ctx, built.primary, () => pickWordEx(env, word, 1, "review", { audio: false }));
        const cost = num(settings, "time.intro_card") + exCost(settings, [built.primary, built.item.followup]);
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
      for (const table of tables) {
        const built = conjItem(ctx, table, 1, true);
        if (!built.primary) continue;
        const cost = num(settings, "time.intro_card") + exCost(settings, [built.primary, built.item.followup]);
        out.push({ t: "newconj", key: itemKey("conjugation", table.id), table, ex: built.primary, cost, planItem: built.item });
      }
      return out.length ? out : null;
    };

    while (left > 0 && skills.size > 0) {
      const skill = nextSkill(skills, progress, packs, first)!;
      first = false;
      const pack = skill === "vocab" ? vocabPack() : grammarPack();
      const cost = pack?.reduce((sum, entry) => sum + entry.cost, 0) ?? 0;
      if (!pack || cost > left * (1 + num(settings, "session.overrun"))) {
        skills.delete(skill);
        continue;
      }
      for (const entry of pack) {
        add(entry);
        if (entry.t === "newword") {
          chosenWords.push(entry.word.id);
          if (learner.queue.some((row) => row.wordId === entry.word.id)) queueUsed++;
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

  // ── What is left (step 8): more reviews, then more notebook ──
  if (scope !== "notebook" && scope !== "extra") {
    for (const key of leftover) {
      const entry = dueEntry(key);
      if (entry && used + entry.cost <= budget) {
        add(entry);
        if (entry.t === "round") rounds++;
      }
    }
    for (const note of noteLeft) {
      const entry = noteEntry(note);
      if (entry && !inPlan.has(entry.key) && used + entry.cost <= budget) add(entry);
    }
  }

  if (entries.length === 0) return { kind: "nothing_left", effects };
  const plan = assemble(ctx, opts, budget, entries, planItems, summary);
  return { kind: "plan", plan, effects };
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
  return { t: "newunit", key: itemKey("grammar_unit", unit.id), unit, g0, questions: round.questions, step: round.step, cost };
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
          alt: null,
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
  const addWord = (wordId: number) => {
    const word = content.words.get(wordId);
    if (word && !words[wordId]) words[wordId] = wordCard(env, word);
  };
  const pairs = new Map<string, ConfusionE>();
  const minCount = num(settings, "confusion.min_count");
  for (const key of keys) {
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
  const reviews = entries.filter((entry) => entry.t === "single" || entry.t === "round").length;
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
    pairs: [...pairs.values()],
    pairsAtStart: [...pairs.keys()],
    rounds,
    counters: { answered: 0, ok: 0, wrongStreak: 0, rescuePending: false, practice: {}, correct: 0, wrong: 0 },
    summary: { reviews, newItems: summary.newWords + summary.newUnits + summary.newConj, ...summary },
  };
}

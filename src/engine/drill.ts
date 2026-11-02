import { baseEx, sentenceViewOf, tileCase, tileWords, translationChoices, type BuildEnv } from "./build";
import type { SentenceC } from "./content";
import { dictationWords } from "./dictation";
import type { Ex } from "./ex";
import { SHAPE } from "./exercises";
import { shuffle } from "./random";
import { exerciseOn, num, type Settings } from "./settings";
import type { DrillStateE } from "./state";
import { cleanAnswer, hasWordChar, words } from "./text";

/**
 * «تمرین شنیدن جمله» (PRD §7.6): bank sentences heard alone, up to three times each, harder each
 * time (L1 translation, L2 tiles, L3 dictation). No card, no step, no notebook: only how many times a
 * sentence came and when.
 */

export const DRILL_CODES = ["L1", "L2", "L3"] as const;

/** The exercise of a sentence's next showing, or null when it has come `drill.max_count` times. */
export const drillCode = (count: number, settings: Settings): string | null => (count < num(settings, "drill.max_count") ? (DRILL_CODES[count] ?? null) : null);

/** Item key of a sentence's drill in a session plan. */
export const drillKey = (sentenceId: number) => `l:${sentenceId}`;

/** The words heard and written, names and numbers included; kept per sentence, as content does not change. */
const spoken = new WeakMap<SentenceC, number>();
export function spokenWords(sentence: SentenceC): number {
  let count = spoken.get(sentence);
  if (count === undefined) spoken.set(sentence, (count = words(cleanAnswer(sentence.text, true)).filter(hasWordChar).length));
  return count;
}

/** The settings a suitable sentence is checked against, read once for a whole content. */
type DrillRules = { maxWords: number; gapMs: number; codeAt: (count: number) => string | null };
const rulesOf = (settings: Settings): DrillRules => {
  const codes = DRILL_CODES.map((_, count) => drillCode(count, settings)).map((code) => (code && exerciseOn(settings, code) ? code : null));
  return { maxWords: num(settings, "drill.max_words"), gapMs: num(settings, "drill.gap_days") * 86_400_000, codeAt: (count) => codes[count] ?? null };
};

function readyWith(rules: DrillRules, env: BuildEnv, sentence: SentenceC, state: DrillStateE | undefined, now: Date): string | null {
  if (!sentence.bank) return null;
  const code = rules.codeAt(state?.count ?? 0);
  if (!code) return null;
  if (state?.lastAt && now.getTime() - Date.parse(state.lastAt) < rules.gapMs) return null;
  if (code === "L3" && sentence.tokens.some((token) => token.kind === "number")) return null;
  for (const token of sentence.tokens) if (token.kind === "word" && (token.wordId === null || !env.known(token.wordId))) return null;
  return spokenWords(sentence) > rules.maxWords ? null : code;
}

/**
 * A suitable sentence (PRD §7.6): a bank sentence of at most `drill.max_words` words, every word known,
 * not drilled in the last `drill.gap_days` days, with a showing left whose exercise is on; L3 skips a
 * sentence with a number.
 */
export const drillReady = (env: BuildEnv, sentence: SentenceC, state: DrillStateE | undefined, now: Date): string | null => readyWith(rulesOf(env.settings), env, sentence, state, now);

export type DrillPick = { sentence: SentenceC; code: string };

/**
 * Suitable sentences in their order (PRD §7.6): those further along first (third showing, then
 * second, then first), then the oldest last showing; sentences never heard after them, at random.
 * The new ones are drawn one at a time, so a session looks at only as many sentences as it takes.
 */
export function* drillOrder(env: BuildEnv, drills: ReadonlyMap<number, DrillStateE>, now: Date): Generator<DrillPick> {
  const rules = rulesOf(env.settings);
  const heard: (DrillPick & { count: number; lastAt: number })[] = [];
  for (const state of drills.values()) {
    const sentence = env.content.sentences.get(state.sentenceId);
    const code = sentence && readyWith(rules, env, sentence, state, now);
    if (sentence && code) heard.push({ sentence, code, count: state.count, lastAt: state.lastAt ? Date.parse(state.lastAt) : 0 });
  }
  for (const { sentence, code } of shuffle(env.rng, heard).sort((a, b) => b.count - a.count || a.lastAt - b.lastAt)) yield { sentence, code };
  // A shuffle that stops where the session stops taking.
  const pool = [...env.content.sentences.values()];
  for (let i = 0; i < pool.length; i++) {
    const j = i + Math.floor(env.rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    const sentence = pool[i];
    if (drills.has(sentence.id)) continue;
    const code = readyWith(rules, env, sentence, undefined, now);
    if (code) yield { sentence, code };
  }
}

/** Every suitable sentence, in order. */
export const drillSentences = (env: BuildEnv, drills: ReadonlyMap<number, DrillStateE>, now: Date): DrillPick[] => [...drillOrder(env, drills, now)];

/** The sentence's exercise for this showing; the text and translation come only with the feedback. */
export function buildDrillEx(env: BuildEnv, sentence: SentenceC, code: string): Ex | null {
  const { content } = env;
  const key = drillKey(sentence.id);
  const extra: Partial<Ex> = { sentenceId: sentence.id, listen: sentence.speak };
  const q = { sentence: sentenceViewOf(sentence, content, { translation: true }) };
  if (code === "L1") {
    const set = translationChoices(env, sentence);
    return set ? baseEx(env, code, key, q, { kind: "choice", ...set }, extra) : null;
  }
  if (code === "L2") {
    const cased = tileCase(sentence, content);
    const order = tileWords(sentence.text).map(cased);
    if (order.length < 2) return null;
    let tiles = shuffle(env.rng, order);
    for (let tries = 0; tiles.join(" ") === order.join(" ") && tries < SHAPE.shuffleTries; tries++) tiles = shuffle(env.rng, order);
    return baseEx(env, code, key, q, { kind: "tiles", tiles, orders: [order] }, extra);
  }
  const names = sentence.tokens.filter((token) => token.kind === "name").map((token) => token.surface);
  return baseEx(env, code, key, q, { kind: "dictation", words: dictationWords(sentence.text, names) }, extra);
}

/**
 * Sentence listening's word gate (PRD §10.3): `gate.drill_words` introduced card words for a learner
 * who started from the lowest level, none for one placed higher. Null when open; the button also
 * needs a suitable sentence.
 */
export function drillGate(fromStart: boolean, introducedCardWords: number, settings: Settings): { need: number; left: number } | null {
  const need = num(settings, "gate.drill_words");
  return fromStart && introducedCardWords < need ? { need, left: need - introducedCardWords } : null;
}

/** The sentence after one more showing, whatever the answer (PRD §7.6, T38). */
export const afterDrill = (sentenceId: number, before: DrillStateE | null, now: Date): DrillStateE => ({ sentenceId, count: (before?.count ?? 0) + 1, lastAt: now.toISOString() });

/**
 * The listening button's numbers (PRD §3.3): sentences heard and sentences heard every time, and
 * `playable` when a suitable sentence makes an exercise; the search stops at the first one.
 */
export function drillCounts(env: BuildEnv, drills: readonly DrillStateE[], now: Date): { heard: number; done: number; playable: boolean } {
  let playable = false;
  for (const { sentence, code } of drillOrder(env, new Map(drills.map((drill) => [drill.sentenceId, drill])), now)) {
    if (buildDrillEx(env, sentence, code) === null) continue;
    playable = true;
    break;
  }
  return { heard: drills.length, done: drills.filter((drill) => drillCode(drill.count, env.settings) === null).length, playable };
}

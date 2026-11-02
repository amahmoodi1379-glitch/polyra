import type { Content } from "./content";
import { exerciseDef } from "./exercises";
import { phonicsKey } from "./phonics";
import { CONJ_LAST_STEP, lastStepOfUnit, lastStepOfWord } from "./pick";
import { activeCards, isDue, type BuildOptions, type BuildResult } from "./session/build";
import { mayFollow } from "./session/advance";
import { shownEx, type PlayResult } from "./session/play";
import type { Card, SessionPlan } from "./session/types";
import { exerciseOn, flag, num, type Settings } from "./settings";
import { isItemKey, itemKey, parseItemKey, type ItemStateE, type LearnerSnapshot, type TextStateE } from "./state";
import { dueTexts, indexTextStates, lastTouch, otherTrack, textStateKey, touched, wasBorrowed } from "./texts";

/**
 * The rules that never break (PRD §16.3, «قانون‌های همیشگی»), checked on a learner and a session.
 * The random test and the simulator call it after every build and every card. Rules 11, 13 and 15
 * are not the engine's to see here: the server's tests cover answer ids, the end message and the
 * build preview.
 */

export type Violation = { rule: number; detail: string };

type Played = Extract<PlayResult, { done: true }>;

export type InvariantInput = {
  content: Content;
  settings: Settings;
  /** The learner after the last change. */
  learner: LearnerSnapshot;
  now: Date;
  today: string;
  /** A build that just ran, with its options and the learner it ran on. */
  build?: { result: BuildResult; opts: BuildOptions; before: LearnerSnapshot };
  /** A card that was just played, with the plan it was played on and whether the version without sound was shown. */
  played?: { result: Played; plan: SessionPlan; alt: boolean };
};

export function checkInvariants(input: InvariantInput): Violation[] {
  const out: Violation[] = [];
  if (input.build) checkBuild(input, input.build, out);
  if (input.played) checkPlayed(input, input.played, out);
  checkLearner(input, out);
  return out;
}

/** The content item a card belongs to; a notebook sentence of a unit (`t:`) belongs to its unit. A drilled sentence has none. */
/** A speaking card shows visible content only: a sentence that is not a text's, a dialogue or a find-the-mistake text of the content (PRD §8b). */
function prodShown(content: Content, card: Card): boolean {
  const prod = card.prod!;
  if (prod.kind === "speak") {
    const sentence = content.sentences.get(prod.view.sentence.id);
    return !!sentence && !sentence.inText;
  }
  if (prod.kind === "dialogue") return content.dialogues.some((dialogue) => dialogue.id === prod.view.id);
  return content.errorfixes.some((item) => item.id === prod.view.id);
}

function cardRef(content: Content, card: Card): Pick<ItemStateE, "itemType" | "itemId"> | null {
  // A grammar target: a conjugation-table question (`t:`) or the placement sample's sentence (`g:`, PRD §11.4).
  if (card.item.startsWith("t:") || card.item.startsWith("g:")) {
    const target = content.targets.get(Number(card.item.slice(2)));
    return target ? { itemType: "grammar_unit", itemId: target.targetId } : null;
  }
  if (!isItemKey(card.item)) return null;
  const { type, id } = parseItemKey(card.item);
  return { itemType: type, itemId: id };
}

const exercisesOf = (card: Card) => [card.ex, card.alt].filter((ex) => !!ex);

function checkBuild(input: InvariantInput, build: NonNullable<InvariantInput["build"]>, out: Violation[]) {
  const { content, settings, now, today } = input;
  const { result, opts, before } = build;
  const active = activeCards(content);
  const scope = opts.scope;

  // 1. No empty session while something in scope is due.
  if (result.kind === "plan" && result.plan.queue.length === 0) out.push({ rule: 1, detail: "a plan with no cards" });
  if (result.kind === "nothing_left" && ["mixed", "vocab", "grammar", "quick"].includes(scope)) {
    const deferred = new Set(result.effects.spread.map((item) => item.key));
    const due = before.items.filter((state) => {
      if (!isDue(state, now, today) || !active(state)) return false;
      if (scope === "vocab" && state.itemType !== "word") return false;
      if (scope === "grammar" && state.itemType === "word") return false;
      return !deferred.has(itemKey(state.itemType, state.itemId));
    });
    if (due.length > 0 && result.effects.unbuildable.length === 0) out.push({ rule: 1, detail: `nothing left with ${due.length} due in scope ${scope}` });
  }
  // «شنیداری» and «خواندن» are never empty while an attempt of the track is due (PRD §10.4), unless the learner said «بعداً».
  if (result.kind === "nothing_left" && (scope === "listening" || scope === "reading") && opts.text !== "later" && (scope === "reading" || !opts.noAudio)) {
    const env = { content, settings, now, known: () => true, states: indexTextStates(before.texts), levelOf: () => content.levels[0] };
    if (dueTexts(env, [scope]).length > 0) out.push({ rule: 1, detail: `nothing left with a due ${scope} attempt` });
  }

  // 5. Spreading the backlog never moves `fsrs.due` (the learner after the build's writes against the one before).
  const after = new Map(input.learner.items.map((state) => [itemKey(state.itemType, state.itemId), state]));
  for (const { key } of result.effects.spread) {
    const was = before.items.find((state) => itemKey(state.itemType, state.itemId) === key);
    if (was && after.get(key)?.fsrs.due !== was.fsrs.due) out.push({ rule: 5, detail: `${key} due moved` });
  }
  if (result.kind !== "plan") return;
  const plan = result.plan;

  const textStates = indexTextStates(before.texts);
  const gapMs = num(settings, "text.cross_gap_days") * 86_400_000;
  const textTracks = new Map<number, string>();
  plan.queue.forEach((card, index) => {
    if (card.t === "text" && card.text) {
      const { textId, track, borrowed } = card.text;
      // 7. A text comes in one track: borrowed by the other only `text.cross_gap_days` after the last time in it.
      const other = textStates.get(textStateKey(textId, otherTrack(track)));
      const last = lastTouch(other);
      if (touched(other) && (!borrowed || wasBorrowed(other) || (last !== null && now.getTime() - last < gapMs))) out.push({ rule: 7, detail: `text ${textId} in ${track} after ${otherTrack(track)}` });
      if (textTracks.has(textId) && textTracks.get(textId) !== track) out.push({ rule: 7, detail: `text ${textId} in both tracks of one session` });
      textTracks.set(textId, track);
      // 10. No listening text without sound.
      if (plan.noAudio && track === "listening") out.push({ rule: 10, detail: `listening text ${textId} without sound` });
    }
    // 8. Only visible content in open levels, never a frozen card.
    // A drilled sentence is a bank sentence of the learner's content (PRD §7.6); a text and its key words belong to a visible text.
    const ref = cardRef(content, card);
    const isText = card.t === "text" || card.t === "textwords";
    const shownOk = isText
      ? content.texts.some((text) => `x:${text.id}` === card.item)
      : card.t === "phonics" || card.t === "phonicsq"
        ? content.phonics.some((lesson) => phonicsKey(lesson.id) === card.item)
        : card.t === "drill"
          ? !!content.sentences.get(card.ex?.sentenceId ?? -1)?.bank
          : card.prod
            ? prodShown(content, card)
            : !!ref && active(ref);
    if (!shownOk) out.push({ rule: 8, detail: `${card.item} is not active content` });
    // 10. No exercise with sound in a session without sound.
    const shown = shownEx(plan, card);
    if (plan.noAudio && shown?.audio) out.push({ rule: 10, detail: `${card.item} ${shown.code} needs sound` });
    // 12. No switched-off exercise or feature.
    for (const ex of exercisesOf(card)) if (!exerciseOn(settings, ex.code)) out.push({ rule: 12, detail: `${card.item} ${ex.code} is switched off` });
    if (card.t === "confusion" && !flag(settings, "feature.confusion_card")) out.push({ rule: 12, detail: "confusion card while switched off" });
    // 10. No phonics round without sound; one round at most, only in the auto mode's mixed and vocabulary sessions or in «الفبا و تلفظ» (PRD §8.4).
    if (card.t === "phonics") {
      if (plan.noAudio) out.push({ rule: 10, detail: `phonics round ${card.item} without sound` });
      if (plan.queue.filter((other) => other.t === "phonics").length > 1) out.push({ rule: 10, detail: "two phonics rounds in one session" });
      const auto = (scope === "mixed" || scope === "vocab") && before.enrollment.phonicsAuto;
      if (scope !== "phonics" && !auto) out.push({ rule: 10, detail: `phonics round in a ${scope} session without the auto mode` });
    }
    // 14. Never two exercises of one item in a row.
    if (index > 0 && !mayFollow(plan.queue[index - 1], card)) out.push({ rule: 14, detail: `${card.item} twice in a row at card ${index} (${plan.queue[index - 1].t}, ${card.t}), scope ${plan.scope}` });
  });
}

function checkPlayed(input: InvariantInput, played: NonNullable<InvariantInput["played"]>, out: Violation[]) {
  const { content, settings } = input;
  const { result, plan, alt } = played;
  const { card, ex } = result;
  const word = card.item.startsWith("w:") ? content.words.get(parseItemKey(card.item).id) : undefined;
  // G0 (the new unit's unscored questions) is outside the ladders.
  if (ex && ex.code !== "G0") {
    const def = exerciseDef(ex.code);
    // 2. A scored review of a word tests meaning.
    if (word && card.kind === "review" && !def.meaning) out.push({ rule: 2, detail: `${card.item} reviewed with ${ex.code}` });
    // 3. A word to recognize is never typed.
    if (word?.mastery === "recognize" && def.typed) out.push({ rule: 3, detail: `${card.item} typed with ${ex.code}` });
    // 10. Without sound (the whole session or since «الان نمی‌توانم گوش بدهم»), no exercise with sound when a version without exists.
    if ((plan.noAudio || alt) && ex.audio && card.alt) out.push({ rule: 10, detail: `${card.item} ${ex.code} shown with sound` });
    // 12. No switched-off exercise.
    if (!exerciseOn(settings, ex.code)) out.push({ rule: 12, detail: `${card.item} ${ex.code} shown while switched off` });
  }
  // 9. Unscored practice (G0, «تمرین بیشتر») changes nothing.
  if (card.t === "g0" || plan.scope === "extra") {
    if (result.state || result.roundState || result.notebook.length > 0 || result.pair) out.push({ rule: 9, detail: `${card.item} (${card.t}, ${plan.scope}) changed the learner` });
  }
  // 14. The next card is never another exercise of the same item.
  const next = result.advanced.plan.queue[0];
  if (next && !mayFollow(card, next)) out.push({ rule: 14, detail: `${card.item} then ${next.item} (${next.t})` });
  // 1. A session never runs out of cards before it says it is finished.
  if (result.advanced.finished !== (result.advanced.plan.queue.length === 0)) out.push({ rule: 1, detail: "finished does not match an empty queue" });
}

function checkLearner(input: InvariantInput, out: Violation[]) {
  const { content, settings, learner } = input;
  const units = new Map(content.units.map((unit) => [unit.id, unit]));
  // 4. Every step is between 1 and the item's last step.
  for (const state of learner.items) {
    let last: number | null = null;
    if (state.itemType === "word") {
      const word = content.words.get(state.itemId);
      if (word) last = lastStepOfWord(word);
    } else if (state.itemType === "grammar_unit") {
      const unit = units.get(state.itemId);
      if (unit) last = lastStepOfUnit({ content }, unit);
    } else last = CONJ_LAST_STEP;
    if (state.step < 1 || (last !== null && state.step > last)) out.push({ rule: 4, detail: `${state.itemType} ${state.itemId} at step ${state.step} of ${last}` });
  }
  // 6. No daily cap is passed.
  const today = learner.today;
  const caps: [string, number, string][] = [
    ["words", today.newWords, "new.words_daily_hard"],
    ["units", today.newUnits, "new.units_daily"],
    ["tables", today.newConj, "new.conj_daily"],
    ["queue", today.queueWords, "queue.daily"],
  ];
  for (const [what, count, key] of caps) if (count > num(settings, key)) out.push({ rule: 6, detail: `${count} new ${what} today, cap ${num(settings, key)}` });
  if (today.wordsCapToday !== null && today.newWords > today.wordsCapToday) out.push({ rule: 6, detail: `${today.newWords} new words, today's cap ${today.wordsCapToday}` });
  // 7. A text in both tracks: one borrowed it, every time in the other track at least `text.cross_gap_days` before.
  const states = indexTextStates(learner.texts);
  const gapMs = num(settings, "text.cross_gap_days") * 86_400_000;
  for (const state of learner.texts) {
    if (state.track !== "listening") continue;
    const other = states.get(textStateKey(state.textId, "reading"));
    if (!touched(state) || !touched(other)) continue;
    const [lender, borrower] = wasBorrowed(state) ? [other!, state] : wasBorrowed(other) ? [state, other!] : [null, null];
    if (!lender || !borrower) {
      out.push({ rule: 7, detail: `text ${state.textId} in both tracks, neither borrowed` });
      continue;
    }
    const first = firstTouch(borrower);
    const last = lastTouch(lender);
    if (first !== null && last !== null && first - last < gapMs) out.push({ rule: 7, detail: `text ${state.textId} borrowed ${Math.round((first - last) / 86_400_000)} days after its other track` });
  }
}

/** When the learner first worked on the text in a track. */
function firstTouch(state: TextStateE): number | null {
  const times = [state.lastAttemptAt, ...state.scores.map((score) => score.at)].filter((time): time is string => !!time).map((time) => Date.parse(time));
  return times.length ? Math.min(...times) : null;
}

import { randomUUID } from "node:crypto";
import { applyRound, newItemState } from "@/engine/answer";
import type { Content } from "@/engine/content";
import { grammarLevel, grammarProgress, indexItems, vocabProgress } from "@/engine/levels";
import { buildSession, type BuildEffects, type BuildOptions } from "@/engine/session/build";
import type { Scope, SessionPlan } from "@/engine/session/types";
import { num, type Settings } from "@/engine/settings";
import { parseItemKey, type LearnerSnapshot } from "@/engine/state";
import { tehranDate } from "@/engine/time";
import type { Prisma, Session } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { engineSettings } from "@/server/settings/read";
import { canPractice, startTrialIfFirst } from "./access";
import { learnerContent, type Audience } from "./content";
import { asDate, loadLearner } from "./learner";
import { addDaily, applyNotebookOps, saveItemState } from "./writes";

/**
 * Sessions on the server (PRD §10.8, §15.4): build or resume one, close one, and the bundle the
 * browser plays. The plan is saved in `session.plan` and changed after every answer.
 */

export type Learner = { id: number; is_admin: boolean; is_tester: boolean };

/** Where the learner stood when the session was built, for the end screen (PRD §3.9). */
export type StartInfo = { vocab: { level: string; station: number }; grammar: { level: string; station: number } };

export type EndSummary = {
  correct: number;
  wrong: number;
  newWordsToday: number;
  newUnitsToday: number;
  knownWords: number;
  canDo: string | null;
  station: { skill: "vocab" | "grammar"; level: string; number: number; total: number; count: number } | null;
  streak: { counted: boolean; count: number; freezeEarned: boolean; freezes: number };
  tomorrow: number;
};

/** What `session.plan` holds: the engine's plan and two notes of the server's. */
export type StoredPlan = SessionPlan & { start?: StartInfo; end?: EndSummary };

export type Bundle = {
  id: string;
  language: string;
  scope: Scope;
  plan: SessionPlan;
  nextSeq: number;
  createdAt: string;
  settings: Settings;
  /** Lower-case lemma to word ids, for a typed answer that is another word (PRD §9.9). */
  lexicon: [string, number[]][];
  /** The sound tip under the first audio cards of the learner's very first session (PRD §3.5). */
  soundTip: boolean;
};

export type StartRequest = { language: string; scope: Scope; noAudio: boolean; cap: BuildOptions["cap"] };

export type StartResult =
  | { kind: "session"; bundle: Bundle }
  | { kind: "ask_word_cap"; learned: number; canMore: boolean }
  | { kind: "nothing_left" }
  | { kind: "empty_notebook" }
  | { kind: "locked" }
  | { kind: "not_enrolled" };

export type LearnContext = { settings: Settings; content: Content; audience: Audience; now: Date; today: string };

export async function learnContext(user: Learner, language: string, now: Date): Promise<LearnContext> {
  const audience: Audience = user.is_admin || user.is_tester ? "tester" : "public";
  const [settings, content] = await Promise.all([engineSettings(), learnerContent(language, audience)]);
  return { settings, content, audience, now, today: tehranDate(now) };
}

export const lexiconOf = (content: Content): [string, number[]][] => [...content.lemmaIndex.entries()];

export function bundleOf(row: Pick<Session, "id" | "language" | "scope" | "plan" | "next_seq" | "created_at">, ctx: LearnContext, soundTip: boolean): Bundle {
  const stored = { ...(row.plan as unknown as StoredPlan) };
  delete stored.start;
  delete stored.end;
  const plan: SessionPlan = stored;
  return {
    id: row.id,
    language: row.language,
    scope: row.scope as Scope,
    plan,
    nextSeq: row.next_seq,
    createdAt: row.created_at.toISOString(),
    settings: ctx.settings,
    lexicon: lexiconOf(ctx.content),
    soundTip,
  };
}

export function startInfo(content: Content, learner: Pick<LearnerSnapshot, "items" | "skills">, settings: Settings): StartInfo {
  const items = indexItems(learner.items);
  const vocab = learner.skills.find((skill) => skill.skill === "vocab")!;
  const level = grammarLevel(content, items);
  return {
    vocab: { level: vocab.level, station: vocabProgress(content, items, vocab, settings).station },
    grammar: { level, station: grammarProgress(content, items, level, settings).station },
  };
}

/** The open session of a language, if any. */
export const openSession = (userId: number, language: string) => db.session.findFirst({ where: { user_id: userId, language, ended_at: null }, orderBy: { created_at: "desc" } });

/** When an open session stops being resumable (PRD §10.8): 6 hours after its last answer or its build. */
export function expiresAt(row: Pick<Session, "created_at" | "last_answer_at">, settings: Settings): Date {
  return new Date((row.last_answer_at ?? row.created_at).getTime() + num(settings, "session.resume_hours") * 3_600_000);
}

/** What a build writes before the session starts (PRD §10.2, step 1): pace, the spread backlog, the word cap. */
async function writeEffects(tx: Prisma.TransactionClient, userId: number, language: string, effects: BuildEffects, today: string) {
  await tx.enrollment.update({
    where: { user_id_language: { user_id: userId, language } },
    data: { pace_mode: effects.paceMode, last_spread_date: effects.lastSpreadDate ? asDate(effects.lastSpreadDate) : null },
  });
  const byDay = new Map<string, Map<string, number[]>>();
  for (const item of effects.spread) {
    const { type, id } = parseItemKey(item.key);
    const day = byDay.get(item.deferredUntil) ?? new Map<string, number[]>();
    day.set(type, [...(day.get(type) ?? []), id]);
    byDay.set(item.deferredUntil, day);
  }
  for (const [until, types] of byDay) {
    for (const [type, ids] of types) {
      await tx.itemState.updateMany({ where: { user_id: userId, item_type: type as "word", item_id: { in: ids } }, data: { deferred_until: new Date(until) } });
    }
  }
  await addDaily(tx, { userId, language }, today, {}, { words_cap_today: effects.wordsCapToday, cap_prompt_shown: effects.capPromptShown });
}

/**
 * «شروع» and the skill buttons (PRD §10.8): resumes the open session of the same scope within six
 * hours, else closes it and builds a new one.
 */
export async function startSession(user: Learner, request: StartRequest, now = new Date()): Promise<StartResult> {
  const { language, scope } = request;
  const enrollment = await db.enrollment.findUnique({ where: { user_id_language: { user_id: user.id, language } } });
  if (!enrollment) return { kind: "not_enrolled" };
  const ctx = await learnContext(user, language, now);

  const open = await openSession(user.id, language);
  if (open) {
    const expires = expiresAt(open, ctx.settings);
    const plan = open.plan as unknown as StoredPlan;
    if (now < expires && open.scope === scope && plan.queue.length > 0) return { kind: "session", bundle: bundleOf(open, ctx, await isFirstSession(user.id, language, open.id)) };
    await closeSession(open, now < expires ? "replaced" : "expired", now < expires ? now : expires, ctx);
  }
  if (!(await canPractice(db, user, enrollment, now))) return { kind: "locked" };

  const learner = await loadLearner(db, user.id, language, ctx.content.levels[0], now, ctx.today, ctx.settings);
  if (!learner) return { kind: "not_enrolled" };
  const id = randomUUID();
  const built = buildSession(ctx.content, learner, ctx.settings, now, ctx.today, { scope, lengthMin: learner.sessionLength, noAudio: request.noAudio, cap: request.cap, seed: id });
  if (built.kind === "plan") {
    const stored: StoredPlan = { ...built.plan, start: startInfo(ctx.content, learner, ctx.settings) };
    const row = await db.$transaction(async (tx) => {
      await writeEffects(tx, user.id, language, built.effects, ctx.today);
      return tx.session.create({
        data: {
          id,
          user_id: user.id,
          language,
          scope,
          planned_length_min: Math.round(built.plan.budgetSec / 60),
          no_audio: request.noAudio,
          plan: stored as unknown as Prisma.InputJsonValue,
          created_at: now,
        },
      });
    });
    return { kind: "session", bundle: bundleOf(row, ctx, await isFirstSession(user.id, language, row.id)) };
  }
  await db.$transaction((tx) => writeEffects(tx, user.id, language, built.effects, ctx.today));
  if (built.kind === "ask_word_cap") return { kind: "ask_word_cap", learned: built.learned, canMore: built.canMore };
  return { kind: built.kind };
}

/** The first session of a language gets the sound tip (PRD §3.5). */
async function isFirstSession(userId: number, language: string, sessionId: string) {
  return !(await db.session.findFirst({ where: { user_id: userId, language, id: { not: sessionId } }, select: { id: true } }));
}

/**
 * The line under «شروع» (PRD §10.2, «زیرنویس دکمه شروع»): the same build with nothing written. A
 * learner at the word cap sees the session they would get without new words.
 */
export async function previewSession(user: Learner, language: string, now = new Date()) {
  const ctx = await learnContext(user, language, now);
  const learner = await loadLearner(db, user.id, language, ctx.content.levels[0], now, ctx.today, ctx.settings);
  if (!learner) return null;
  const options = { scope: "mixed" as const, lengthMin: learner.sessionLength, noAudio: false, cap: null, seed: "preview" };
  let built = buildSession(ctx.content, learner, ctx.settings, now, ctx.today, options);
  if (built.kind === "ask_word_cap") built = buildSession(ctx.content, learner, ctx.settings, now, ctx.today, { ...options, cap: "none" });
  const quick = buildSession(ctx.content, learner, ctx.settings, now, ctx.today, { ...options, scope: "quick" });
  return {
    minutes: learner.sessionLength,
    reviews: built.kind === "plan" ? built.plan.summary.reviews : 0,
    newItems: built.kind === "plan" ? built.plan.summary.newItems : 0,
    empty: built.kind !== "plan",
    quick: quick.kind === "plan",
    learner,
    ctx,
  };
}

/**
 * Closes a session (PRD §10.8). A round with three answers or more is scored as it stands (PRD §6.5,
 * rule 8); the rest of the queue has no effect. The first close of a language starts its free period.
 */
export async function closeSession(row: Session, reason: "finished" | "expired" | "replaced", endedAt: Date, ctx: LearnContext, tx?: Prisma.TransactionClient) {
  const run = async (client: Prisma.TransactionClient) => {
    const plan = row.plan as unknown as StoredPlan;
    const who = { userId: row.user_id, language: row.language };
    if (reason !== "finished") {
      for (const [block, round] of Object.entries(plan.rounds)) {
        if (round.answers.length === 0 || !plan.queue.some((card) => card.block === block)) continue;
        const { id } = parseItemKey(round.item);
        const before = plan.states[round.item] ?? newItemState("grammar_unit", id, endedAt);
        const outcome = applyRound(before, round.step, round.answers, { settings: ctx.settings, now: endedAt, today: tehranDate(endedAt), latency: plan.latency }, round.last);
        if (!outcome.scored) continue;
        const isNew = await saveItemState(client, who, outcome.state);
        if (isNew) await addDaily(client, who, tehranDate(endedAt), { new_units: 1 });
        await applyNotebookOps(client, who, outcome.notebook, endedAt, tehranDate(endedAt), ctx.settings);
      }
    }
    await client.session.update({ where: { id: row.id }, data: { ended_at: endedAt, end_reason: reason } });
    await startTrialIfFirst(client, row.user_id, row.language, endedAt, num(ctx.settings, "trial.hours"));
  };
  return tx ? run(tx) : db.$transaction(run);
}

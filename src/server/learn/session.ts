import { randomUUID } from "node:crypto";
import type { Content, Track } from "@/engine/content";
import { grammarLevel, grammarProgress, indexItems, vocabProgress } from "@/engine/levels";
import { buildSession, type BuildEffects, type BuildOptions } from "@/engine/session/build";
import { closeRounds } from "@/engine/session/play";
import type { Scope, SessionPlan } from "@/engine/session/types";
import { num, type Settings } from "@/engine/settings";
import { parseItemKey, type LearnerSnapshot, type SkillName } from "@/engine/state";
import { tehranDate } from "@/engine/time";
import type { Prisma, Session } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { logError } from "@/server/errors";
import { engineSettings } from "@/server/settings/read";
import { unlockedModules } from "@/server/billing/subscriptions";
import { canPractice, startTrialIfFirst } from "./access";
import { learnerContent, type Audience } from "./content";
import { updateLevels } from "./levels";
import { asDate, loadLearner } from "./learner";
import { placementRunning } from "./placement";
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
  /** At most one message (PRD §3.11). «shorter» without `to` reminds a 10-minute learner of «امروز وقت کم دارم». */
  message: EndMessage | null;
  /** «مسیر عمومی را تا B2 تمام کردی» (PRD §3.13): once, in place of the end screen, with what was learned. */
  pathDone?: { level: string; words: number; units: number; texts: number; days: number } | null;
};
export type EndMessage =
  /** «یک سطح پایین‌تر برویم؟» (PRD §11.7); `applied` once «بله» was pressed. */
  | { kind: "leveldown"; skill: SkillName; from: string; to: string; applied?: boolean }
  | { kind: "shorter"; from: number; to: number | null }
  /** «از این سطح متن‌ها بلندترند. جلسه‌ها را ۱۵ دقیقه‌ای کنم؟» (PRD §3.11 row 3). */
  | { kind: "longer"; to: number }
  /** «زیاد «این را بلدم» زدی…» (PRD §3.11 row 4): the skill whose exam is on offer. */
  | { kind: "skipTest"; skill: "vocab" | "grammar"; next: string }
  | { kind: "slowPace" }
  | { kind: "phonicsOff" }
  /** «اپ را به صفحه گوشی‌ات اضافه کن» (PRD §3.11 row 7): Chrome's install window, or Safari's two steps on an iPhone. */
  | { kind: "install"; ios: boolean }
  /** The placement sample failed (PRD §11.4): «… از A2 ادامه می‌دهیم». Before every other message (DECISIONS.md). */
  | { kind: "sample"; skill: "vocab" | "grammar"; level: string };

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

/** `text`: the answer to «پیش از جلسه متن» (PRD §10.11). */
/** `replace`: «یک جلسه بی‌صدا برایت ساختم» (PRD §10.12, T92): the open session closes as `replaced` even when it could go on. */
export type StartRequest = { language: string; scope: Scope; noAudio: boolean; cap: BuildOptions["cap"]; text?: BuildOptions["text"]; replace?: boolean };

export type StartResult =
  | { kind: "session"; bundle: Bundle }
  | { kind: "ask_word_cap"; learned: number; canMore: boolean }
  /** «امروز یک متن داریم؛ حدود … دقیقه طول می‌کشد» (PRD §10.11). */
  | { kind: "ask_text_session"; minutes: number; textId: number; track: Track }
  | { kind: "nothing_left" }
  | { kind: "empty_notebook" }
  | { kind: "locked" }
  | { kind: "not_enrolled" }
  /** «این جلسه بدون صدا ممکن نیست» (PRD §10.12): listening and phonics need sound. */
  | { kind: "needs_audio" };

/** `modules`: the separate modules (PRD §12.2) the learner's plan opens, already applied to `content`. */
export type LearnContext = { settings: Settings; content: Content; audience: Audience; modules: string[]; now: Date; today: string };

export async function learnContext(user: Learner, language: string, now: Date): Promise<LearnContext> {
  const audience: Audience = user.is_admin || user.is_tester ? "tester" : "public";
  const modules = audience === "public" ? await unlockedModules(db, user.id, language, now) : [];
  const [settings, content] = await Promise.all([engineSettings(), learnerContent(language, audience, modules)]);
  return { settings, content, audience, modules, now, today: tehranDate(now) };
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
  const level = grammarLevel(content, items, learner.skills.find((skill) => skill.skill === "grammar")?.knownBelow ?? null);
  return {
    vocab: { level: vocab.level, station: vocabProgress(content, items, vocab, settings).station },
    grammar: { level, station: grammarProgress(content, items, level, settings).station },
  };
}

/** The open session of a language, if any. */
export const openSession = (userId: number, language: string) => db.session.findFirst({ where: { user_id: userId, language, ended_at: null }, orderBy: { created_at: "desc" } });

/** A session takes no answer more than a day after its build (PRD §15.4, step 9). */
export const SESSION_LIFE_MS = 24 * 3_600_000;

/**
 * When an open session stops being resumable (PRD §10.8): `session.resume_hours` after its last answer
 * or its build, and never past its one day.
 */
export function expiresAt(row: Pick<Session, "created_at" | "last_answer_at">, settings: Settings): Date {
  const resume = (row.last_answer_at ?? row.created_at).getTime() + num(settings, "session.resume_hours") * 3_600_000;
  return new Date(Math.min(resume, row.created_at.getTime() + SESSION_LIFE_MS));
}

/**
 * What a build writes before the session starts (PRD §10.2, step 1): pace, the spread backlog, the word
 * cap. Going to slow pace leaves a note for the end of the next finished session (PRD §3.11 row 6); back
 * at normal pace the note is no longer true.
 */
async function writeEffects(tx: Prisma.TransactionClient, userId: number, language: string, effects: BuildEffects, today: string, textLater = false) {
  const notice = effects.becameSlow ? { slow_notice_due: true } : effects.paceMode === "normal" ? { slow_notice_due: false } : {};
  // «بعداً» on «پیش از جلسه متن»: not asked again today (PRD §10.11).
  const later = textLater ? { text_prompt_date: asDate(today) } : {};
  await tx.enrollment.update({
    where: { user_id_language: { user_id: userId, language } },
    data: { pace_mode: effects.paceMode, last_spread_date: effects.lastSpreadDate ? asDate(effects.lastSpreadDate) : null, ...notice, ...later },
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
  await addDaily(
    tx,
    { userId, language },
    today,
    {},
    { words_cap_today: effects.wordsCapToday, cap_prompt_shown: effects.capPromptShown, ...(effects.textSession ? { text_session_done: true } : {}) },
  );
}

/**
 * «شروع» and the skill buttons (PRD §10.8): resumes the open session of the same scope within six
 * hours, else closes it and builds a new one.
 */
export async function startSession(user: Learner, request: StartRequest, now = new Date()): Promise<StartResult> {
  const { language, scope } = request;
  const enrollment = await db.enrollment.findUnique({ where: { user_id_language: { user_id: user.id, language } } });
  if (!enrollment) return { kind: "not_enrolled" };
  // A placement test left half-way comes first (PRD §11.1): the home shows «ادامه تعیین سطح».
  if (await placementRunning(user.id, language)) return { kind: "not_enrolled" };
  if (request.noAudio && (scope === "listening" || scope === "phonics")) return { kind: "needs_audio" };
  const ctx = await learnContext(user, language, now);

  const open = await openSession(user.id, language);
  if (open) {
    const expires = expiresAt(open, ctx.settings);
    const plan = open.plan as unknown as StoredPlan;
    if (now < expires && open.scope === scope && plan.queue.length > 0 && !request.replace) return { kind: "session", bundle: bundleOf(open, ctx, await isFirstSession(user.id, language, open.id)) };
    await closeSession(open, now < expires ? "replaced" : "expired", now < expires ? now : expires, ctx);
  }
  if (!(await canPractice(db, user, enrollment, now))) return { kind: "locked" };

  const learner = await loadLearner(db, user.id, language, ctx.content.levels[0], now, ctx.today, ctx.settings);
  if (!learner) return { kind: "not_enrolled" };
  const id = randomUUID();
  const text = request.text ?? null;
  const built = buildSession(ctx.content, learner, ctx.settings, now, ctx.today, { scope, lengthMin: learner.sessionLength, noAudio: request.noAudio, cap: request.cap, text, seed: id });
  const later = text === "later";
  if (built.effects.unbuildable.length > 0) {
    // The learner never notices (the item waits); the teacher sees it on «خطاها» (PRD §15.9).
    void logError("learn.build", new Error(`Due items with no exercise (${language}): ${built.effects.unbuildable.join(", ")}`), { userId: user.id });
  }
  if (built.kind === "plan") {
    const stored: StoredPlan = { ...built.plan, start: startInfo(ctx.content, learner, ctx.settings) };
    const row = await db.$transaction(async (tx) => {
      await writeEffects(tx, user.id, language, built.effects, ctx.today, later);
      return tx.session.create({
        data: {
          id,
          user_id: user.id,
          language,
          scope,
          is_text_session: built.effects.textSession,
          planned_length_min: Math.round(built.plan.budgetSec / 60),
          no_audio: request.noAudio,
          plan: stored as unknown as Prisma.InputJsonValue,
          created_at: now,
        },
      });
    });
    return { kind: "session", bundle: bundleOf(row, ctx, await isFirstSession(user.id, language, row.id)) };
  }
  await db.$transaction((tx) => writeEffects(tx, user.id, language, built.effects, ctx.today, later));
  if (built.kind === "ask_word_cap") return { kind: "ask_word_cap", learned: built.learned, canMore: built.canMore };
  if (built.kind === "ask_text_session") return { kind: "ask_text_session", minutes: built.minutes, textId: built.textId, track: built.track };
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
  // «پیش از جلسه متن» comes after the press; the line shows the session «شروع» there would build.
  if (built.kind === "ask_text_session") built = buildSession(ctx.content, learner, ctx.settings, now, ctx.today, { ...options, text: "confirmed" });
  const quick = buildSession(ctx.content, learner, ctx.settings, now, ctx.today, { ...options, scope: "quick" });
  // «برای امروز چیزی نمانده» offers more practice on today's items when there are any (PRD §10.8).
  const extra = built.kind !== "plan" && buildSession(ctx.content, learner, ctx.settings, now, ctx.today, { ...options, scope: "extra" }).kind === "plan";
  return {
    minutes: learner.sessionLength,
    reviews: built.kind === "plan" ? built.plan.summary.reviews : 0,
    newItems: built.kind === "plan" ? built.plan.summary.newItems : 0,
    resumeText: built.kind === "plan" && built.plan.summary.resumeText,
    empty: built.kind !== "plan",
    quick: quick.kind === "plan",
    extra,
    learner,
    ctx,
  };
}

/**
 * Closes a session (PRD §10.8). A round with three answers or more is scored as it stands (PRD §6.5,
 * rule 8), and any round's answers count in the notebook; the rest of the queue has no effect. Skill levels move either way. The first close of a language starts its free period.
 */
export async function closeSession(row: Session, reason: "finished" | "expired" | "replaced", endedAt: Date, ctx: LearnContext, tx?: Prisma.TransactionClient) {
  const run = async (client: Prisma.TransactionClient) => {
    const plan = row.plan as unknown as StoredPlan;
    const who = { userId: row.user_id, language: row.language };
    if (reason !== "finished") {
      for (const outcome of closeRounds(plan, { settings: ctx.settings, now: endedAt, today: tehranDate(endedAt), latency: plan.latency })) {
        if (outcome.scored) {
          const isNew = await saveItemState(client, who, outcome.state);
          if (isNew) await addDaily(client, who, tehranDate(endedAt), { new_units: 1 });
        }
        // Even an unscored round sends its wrong sentences to the notebook (PRD §6.5, rule 8).
        await applyNotebookOps(client, who, outcome.notebook, endedAt, tehranDate(endedAt), ctx.settings);
      }
    }
    // Levels move with every close, finished or left (PRD §9.6, DECISIONS.md).
    await updateLevels(client, who, ctx, endedAt);
    await client.session.update({ where: { id: row.id }, data: { ended_at: endedAt, end_reason: reason } });
    // «اولین جلسه» and «پایان جلسه» for the analytics (PRD §15.6).
    const before = await client.session.count({ where: { user_id: row.user_id, language: row.language, ended_at: { not: null }, id: { not: row.id } } });
    const props = { session: row.id, reason, answers: Math.max(0, row.next_seq - 1) };
    await client.event.createMany({
      data: [
        ...(before === 0 ? [{ user_id: row.user_id, language: row.language, name: "first_session", props, ts: endedAt }] : []),
        { user_id: row.user_id, language: row.language, name: "session_end", props, ts: endedAt },
      ],
    });
    await startTrialIfFirst(client, row.user_id, row.language, endedAt, num(ctx.settings, "trial.hours"));
  };
  return tx ? run(tx) : db.$transaction(run);
}

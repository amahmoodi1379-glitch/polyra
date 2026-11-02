import { scenarioById, type ScenarioId } from "@/lib/rehearse";
import type { LanguageCode } from "@/server/content/languages";
import { logError } from "@/server/errors";
import { rehearse, type RehearseResult } from "./rehearse";
import type { Learner } from "./session";

/**
 * A scenario of «آزمایش مثل زبان‌آموز» runs after the button's answer: a month of sessions takes about a
 * minute, longer than a page should wait. The page asks for its state every few seconds. Kept in the
 * server's memory (one app server, DECISIONS.md): a restart forgets a run, and the account keeps the
 * days played so far.
 */

export type RehearseJob = {
  scenario: ScenarioId;
  language: LanguageCode;
  startedAt: number;
  /** Days played so far, of `days`. */
  day: number;
  days: number;
  state: "running" | "done" | "failed";
  result: RehearseResult | null;
  /** The «خطاها» code of a failed run. */
  code: string | null;
};

const store = globalThis as unknown as { __polyraRehearse?: Map<string, RehearseJob> };
const jobs = (store.__polyraRehearse ??= new Map<string, RehearseJob>());
const keyOf = (userId: number, language: string) => `${userId}:${language}`;

export function rehearseJob(userId: number, language: LanguageCode): RehearseJob | null {
  return jobs.get(keyOf(userId, language)) ?? null;
}

/** Starts a run unless one is already running for this account and language. */
export function startRehearse(user: Learner & { phone: string | null }, language: LanguageCode, scenarioId: string): "started" | "busy" | "unknown" {
  const scenario = scenarioById(scenarioId);
  if (!scenario) return "unknown";
  const key = keyOf(user.id, language);
  if (jobs.get(key)?.state === "running") return "busy";
  const job: RehearseJob = { scenario: scenario.id, language, startedAt: Date.now(), day: 0, days: scenario.days, state: "running", result: null, code: null };
  jobs.set(key, job);
  void rehearse(user, language, scenario.id, new Date(), (day) => {
    job.day = day;
  }).then(
    (result) => {
      job.day = job.days;
      job.result = result;
      job.state = "done";
    },
    async (error: unknown) => {
      job.state = "failed";
      job.code = await logError("admin.rehearse", error, { userId: user.id });
    },
  );
  return "started";
}

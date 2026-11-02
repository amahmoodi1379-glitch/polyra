import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkInvariants } from "@/engine/invariants";
import { tehranDate } from "@/engine/time";
import { SCENARIOS, scenarioSessions } from "@/lib/rehearse";
import { loadDemo } from "@/server/content/demo";
import { forgetContent } from "@/server/learn/content";
import { startFromZero } from "@/server/learn/enroll";
import { homeData } from "@/server/learn/home";
import { loadLearner } from "@/server/learn/learner";
import { nextSession, rehearse, textsOverview } from "@/server/learn/rehearse";
import { learnContext } from "@/server/learn/session";
import { resetDb, testDb } from "./db";

/**
 * «آزمایش مثل زبان‌آموز» (DECISIONS.md, 2 November 2026) on the French demo: each scenario plays its days
 * through the app's own session functions on the teacher's account, and nothing else changes.
 */

const NOW = new Date("2026-10-20T08:00:00Z");
let phones = 0;

async function person(extra: { is_tester?: boolean; is_admin?: boolean } = {}) {
  const phone = `+98912100${String(++phones).padStart(4, "0")}`;
  const user = await testDb.user.create({ data: { phone, session_length_min: 15, ...extra } });
  return { id: user.id, is_admin: user.is_admin, is_tester: user.is_tester, phone };
}

beforeAll(async () => {
  await resetDb();
  await testDb.language.createMany({ data: [{ code: "fr" }, { code: "de" }] });
  expect(await loadDemo()).toMatchObject({ kind: "loaded" });
  forgetContent();
}, 120_000);

afterAll(() => testDb.$disconnect());

describe("scenarios", () => {
  it("a month every day: thirty days of finished sessions, the last yesterday, and the engine's rules hold today", async () => {
    const teacher = await person({ is_admin: true });
    const scenario = SCENARIOS.find((item) => item.id === "month")!;
    const result = await rehearse(teacher, "fr", "month", NOW);
    expect(result.sessions).toBe(scenarioSessions(scenario));
    const sessions = await testDb.session.findMany({ where: { user_id: teacher.id }, orderBy: { created_at: "asc" } });
    expect(sessions).toHaveLength(30);
    expect(sessions.every((row) => row.ended_at !== null)).toBe(true);
    expect(tehranDate(sessions[0].created_at)).toBe(tehranDate(new Date(NOW.getTime() - 30 * 86_400_000)));
    expect(tehranDate(sessions.at(-1)!.created_at)).toBe(tehranDate(new Date(NOW.getTime() - 86_400_000)));
    // Nothing is in the future.
    const late = await testDb.reviewLog.count({ where: { user_id: teacher.id, ts: { gt: NOW } } });
    expect(late).toBe(0);

    const home = await homeData(teacher, "fr", NOW);
    expect(home?.streak.count).toBeGreaterThanOrEqual(29);
    const ctx = await learnContext(teacher, "fr", NOW);
    const learner = (await loadLearner(testDb, teacher.id, "fr", ctx.content.levels[0], NOW, ctx.today, ctx.settings))!;
    expect(learner.items.filter((item) => item.itemType === "word").length).toBeGreaterThan(20);
    expect(checkInvariants({ content: ctx.content, settings: ctx.settings, learner, now: NOW, today: ctx.today })).toEqual([]);

    const next = await nextSession(teacher, "fr", NOW);
    expect(next?.empty).toBe(false);
    expect(next!.lines.some((line) => line.kind === "word")).toBe(true);
  }, 300_000);

  it("«شنونده و خواننده»: texts in both tracks reach their later attempts, and the overview shows them", async () => {
    const teacher = await person({ is_admin: true });
    expect(await textsOverview(teacher, "fr", NOW)).toBeNull();
    const scenario = SCENARIOS.find((item) => item.id === "texts")!;
    const result = await rehearse(teacher, "fr", "texts", NOW);
    // A second session on a day may find nothing left.
    expect(result.sessions).toBeGreaterThan(scenarioSessions(scenario) / 2);
    expect(result.sessions).toBeLessThanOrEqual(scenarioSessions(scenario));

    const states = await testDb.textState.findMany({ where: { user_id: teacher.id } });
    expect(states.some((state) => state.track === "listening" && state.attempts_done > 0)).toBe(true);
    expect(states.some((state) => state.track === "reading" && state.attempts_done > 0)).toBe(true);
    expect(states.some((state) => state.attempts_done >= 2)).toBe(true);
    // A text comes in one track only (PRD §7, «هر متن برای هر کاربر فقط در یک مسیر»), with no borrowing this soon.
    const tracksOf = new Map<number, Set<string>>();
    for (const state of states) tracksOf.set(state.text_id, new Set([...(tracksOf.get(state.text_id) ?? []), state.track]));
    expect([...tracksOf.values()].every((tracks) => tracks.size === 1)).toBe(true);

    const overview = (await textsOverview(teacher, "fr", NOW))!;
    expect(overview.available).toBe(7);
    expect(overview.tracks.map((track) => track.track)).toEqual(["listening", "reading"]);
    // A track that saw every A1 text with four first rounds of its own moves up (rule 2 of §7.5); the demo has no A2 text.
    for (const track of overview.tracks) {
      const own = states.filter((state) => state.track === track.track && state.first_score !== null).length;
      if (track.level === "A1") expect(track).toMatchObject({ need: 7, firstRounds: own });
      else expect(track).toMatchObject({ level: "A2", need: 0, firstRounds: 0 });
    }
    expect(overview.tracks.every((track) => track.waiting === null && track.nextNew === null)).toBe(true);
    expect(overview.texts).toHaveLength(states.length);
    expect(overview.texts.every((text) => text.attempts === 2 && text.attemptsDone <= 2)).toBe(true);

    const ctx = await learnContext(teacher, "fr", NOW);
    const learner = (await loadLearner(testDb, teacher.id, "fr", ctx.content.levels[0], NOW, ctx.today, ctx.settings))!;
    expect(checkInvariants({ content: ctx.content, settings: ctx.settings, learner, now: NOW, today: ctx.today })).toEqual([]);
  }, 300_000);

  it("many mistakes fill the notebook; back after a long break leaves the last session thirty days ago", async () => {
    const weak = await person({ is_tester: true });
    await rehearse(weak, "fr", "mistakes", NOW);
    expect(await testDb.notebookEntry.count({ where: { user_id: weak.id } })).toBeGreaterThan(0);

    const away = await person({ is_admin: true });
    await rehearse(away, "fr", "returning", NOW);
    const last = await testDb.session.findFirst({ where: { user_id: away.id }, orderBy: { created_at: "desc" } });
    expect(Math.round((NOW.getTime() - last!.created_at.getTime()) / 86_400_000)).toBe(31);
  }, 300_000);

  it("fresh starts again from zero; only the caller's own rows change", async () => {
    const other = await person({ is_tester: true });
    await startFromZero(other, "fr", NOW);
    await rehearse(other, "fr", "week", NOW);
    const before = await testDb.reviewLog.count({ where: { user_id: other.id } });

    const teacher = await person({ is_admin: true });
    await rehearse(teacher, "fr", "week", NOW);
    await rehearse(teacher, "fr", "fresh", NOW);
    expect(await testDb.session.count({ where: { user_id: teacher.id } })).toBe(0);
    expect(await testDb.enrollment.count({ where: { user_id: teacher.id, language: "fr" } })).toBe(1);
    expect(await testDb.reviewLog.count({ where: { user_id: other.id } })).toBe(before);
  }, 300_000);

  it("a learner account cannot play a scenario", async () => {
    const learner = await person();
    await expect(rehearse(learner, "fr", "week", NOW)).rejects.toThrow();
    const tester = await person({ is_tester: true });
    await expect(rehearse(tester, "fr", "nope", NOW)).rejects.toThrow();
  });
});

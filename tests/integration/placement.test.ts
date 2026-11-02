import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RawAnswer } from "@/engine/ex";
import type { SampleState } from "@/engine/placement";
import { addDays, tehranDate } from "@/engine/time";
import { loadDemo } from "@/server/content/demo";
import { forgetContent } from "@/server/learn/content";
import { beginPlacement, placementInput, placementRunning, placementScreen, recordSample, takeSampleNotice, type PlacementScreen, type StoredRun } from "@/server/learn/placement";
import { placementOverview, rehearsePlacement } from "@/server/learn/rehearse";
import { learnContext, startSession } from "@/server/learn/session";
import { travelDays } from "@/server/learn/time-travel";
import { rightAnswer, wrongAnswer } from "@/sim/answers";
import { resetDb, testDb } from "./db";

/**
 * Placement on the server (PRD §11): the run kept between answers, grading on the server, «ادامه نمی‌دهم»,
 * what the end writes, the sample's count and failure, and the panel's view of it. The French demo is A1;
 * its second thirty words are moved to A2 so the test has two levels.
 */

const NOW = new Date("2026-10-20T08:00:00Z");
let phones = 0;

async function person(extra: { is_tester?: boolean; is_admin?: boolean } = { is_tester: true }) {
  const phone = `+98912300${String(++phones).padStart(4, "0")}`;
  const user = await testDb.user.create({ data: { phone, session_length_min: 15, ...extra } });
  return { id: user.id, is_admin: user.is_admin, is_tester: user.is_tester, phone };
}
type Person = Awaited<ReturnType<typeof person>>;

/** The question on screen as the server keeps it, with its answer key. */
async function kept(user: Person) {
  const row = await testDb.placementRun.findFirstOrThrow({ where: { user_id: user.id, language: "fr", state: "running" } });
  return (row.result as unknown as StoredRun).progress.current;
}

/** Answers every question with `pick` (right, wrong or «نمی‌دانم») and every text fully right, to the end. */
async function play(user: Person, pick: (screen: Extract<PlacementScreen, { kind: "question" }>) => "right" | "wrong" | "idk", limit = 200) {
  let screen = await placementScreen(user, "fr", NOW);
  let answered = 0;
  while (screen && screen.kind !== "done" && answered < limit) {
    if (screen.kind === "question") {
      const current = await kept(user);
      if (current?.kind !== "question") throw new Error("no question kept");
      const how = pick(screen);
      const answer: RawAnswer = how === "right" ? rightAnswer(current.ex) : how === "wrong" ? wrongAnswer(current.ex) : { idk: true };
      screen = await placementInput(user, "fr", { answer }, { part: screen.part, number: screen.number }, NOW);
    } else {
      screen = await placementInput(user, "fr", { answers: {} }, { part: screen.track, number: 0 }, NOW);
    }
    answered++;
  }
  return { screen, answered };
}

beforeAll(async () => {
  await resetDb();
  await testDb.language.createMany({ data: [{ code: "fr" }, { code: "de" }] });
  expect(await loadDemo()).toMatchObject({ kind: "loaded" });
  // The second half of the card words become A2: a tester sees approved content in every level.
  const words = await testDb.word.findMany({ where: { language: "fr", no_card: false }, orderBy: { intro_order: "asc" }, select: { id: true } });
  await testDb.word.updateMany({ where: { id: { in: words.slice(30).map((row) => row.id) } }, data: { level: "A2" } });
  forgetContent();
}, 120_000);

afterAll(() => testDb.$disconnect());

describe("placement on the server", () => {
  it("begins once per language: the enrollment is placement, the free period does not start, the run waits on the home", async () => {
    const user = await person();
    expect(await beginPlacement(user, "fr", NOW)).toBe("started");
    const enrollment = await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } });
    expect(enrollment).toMatchObject({ start_mode: "placement", placement_done: false, trial_started_at: null });
    expect(await placementRunning(user.id, "fr")).toBe(true);
    expect(await beginPlacement(user, "fr", NOW)).toBe("running");
    // No session while the test runs: the app sends the learner back to it.
    expect(await startSession(user, { language: "fr", scope: "mixed", noAudio: false, cap: null }, NOW)).toEqual({ kind: "not_enrolled" });
    expect(await testDb.event.count({ where: { user_id: user.id, name: "placement_start" } })).toBe(1);
  });

  it("a question reaches the browser without its answer; a stale answer changes nothing; the server grades and logs each one", async () => {
    const user = await person();
    await beginPlacement(user, "fr", NOW);
    const first = await placementScreen(user, "fr", NOW);
    expect(first).toMatchObject({ kind: "question", part: "vocab", level: "A1", number: 1, size: 10 });
    if (first?.kind !== "question") return;
    expect(first.ex.a.kind === "choice" && first.ex.a.correct).toBe("");
    expect(first.ex.code).toBe("W1a");
    const current = await kept(user);
    if (current?.kind !== "question") throw new Error("no question");
    // An answer to another question (a double tap) is not counted.
    const stale = await placementInput(user, "fr", { answer: rightAnswer(current.ex) }, { part: "vocab", number: 5 }, NOW);
    expect(stale).toMatchObject({ kind: "question", number: 1 });
    const second = await placementInput(user, "fr", { answer: rightAnswer(current.ex) }, { part: "vocab", number: 1 }, NOW);
    expect(second).toMatchObject({ kind: "question", number: 2 });
    // The same answer again is stale now.
    expect(await placementInput(user, "fr", { answer: rightAnswer(current.ex) }, { part: "vocab", number: 1 }, NOW)).toMatchObject({ number: 2 });
    const logs = await testDb.reviewLog.findMany({ where: { user_id: user.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ kind: "placement", item_type: "word", exercise_code: "W1a", result: "correct" });
  });

  it("T29 on the server: three «نمی‌دانم» end it; every skill A1, phonics on, no sample", async () => {
    const user = await person();
    await beginPlacement(user, "fr", NOW);
    const { screen, answered } = await play(user, () => "idk");
    expect(answered).toBe(3);
    expect(screen).toMatchObject({ kind: "done", result: { pv: null, fv: "A1", fg: "A1", listening: "A1", reading: "A1", phonicsAuto: true } });
    const enrollment = await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } });
    expect(enrollment).toMatchObject({ placement_done: true, phonics_auto: true });
    const skills = await testDb.skillLevel.findMany({ where: { user_id: user.id } });
    expect(skills.map((row) => [row.skill, row.level, row.known_below]).sort()).toEqual([
      ["grammar", "A1", "A1"],
      ["listening", "A1", "A1"],
      ["reading", "A1", "A1"],
      ["vocab", "A1", "A1"],
    ]);
    expect(await testDb.itemState.count({ where: { user_id: user.id } })).toBe(0);
    const run = await testDb.placementRun.findFirstOrThrow({ where: { user_id: user.id } });
    expect(run.state).toBe("done");
    expect(run.sample_state).toEqual({ vocab: null, grammar: null });
    expect(await placementRunning(user.id, "fr")).toBe(false);
    expect(await beginPlacement(user, "fr", NOW)).toBe("taken");
    // The result screen shows again when the page is opened later.
    expect(await placementScreen(user, "fr", NOW)).toMatchObject({ kind: "done" });
  });

  it("A1 passed, A2 failed, grammar A1 passed: vocabulary and grammar A2, a sample of A1 words and A1 grammar; sessions then start", async () => {
    const user = await person();
    await beginPlacement(user, "fr", NOW);
    const { screen } = await play(user, (question) => (question.part === "vocab" && question.level === "A2" ? "wrong" : "right"));
    expect(screen).toMatchObject({ kind: "done", result: { pv: "A1", fv: "A2", stopped: false } });
    if (screen?.kind !== "done") return;
    const { result } = screen;
    expect(result.blocks.map((block) => [block.part, block.level, block.passed])).toEqual([
      ["vocab", "A1", true],
      ["vocab", "A2", false],
      ["grammar", "A1", true],
    ]);
    expect(result.fg).toBe("A2");
    const vocab = await testDb.skillLevel.findFirstOrThrow({ where: { user_id: user.id, skill: "vocab" } });
    expect(vocab).toMatchObject({ level: "A2", known_below: "A2" });
    const cards = await testDb.itemState.findMany({ where: { user_id: user.id, probation: "sample" } });
    expect(cards).toHaveLength(30);
    expect(cards.every((card) => card.source === "placement")).toBe(true);
    const run = await testDb.placementRun.findFirstOrThrow({ where: { user_id: user.id } });
    const sample = run.sample_state as unknown as SampleState;
    expect(sample.vocab).toMatchObject({ level: "A1", result: "open" });
    expect(sample.grammar).toMatchObject({ level: "A1", result: "open", days: [tehranDate(NOW), addDays(tehranDate(NOW), 1)] });
    expect(await testDb.event.count({ where: { user_id: user.id, name: "placement_end" } })).toBe(1);

    // The first session holds the sample.
    const started = await startSession(user, { language: "fr", scope: "mixed", noAudio: false, cap: null }, NOW);
    expect(started.kind).toBe("session");
    if (started.kind !== "session") return;
    const items = started.bundle.plan.queue.map((card) => card.item);
    expect(items.some((item) => item.startsWith("g:"))).toBe(true);
    expect(items.some((item) => cards.some((card) => item === `w:${card.item_id}`))).toBe(true);

    // Moving time moves the grammar sample's days too.
    await travelDays(user, "fr", 1, NOW);
    const moved = (await testDb.placementRun.findFirstOrThrow({ where: { user_id: user.id } })).sample_state as unknown as SampleState;
    expect(moved.grammar!.days).toEqual([addDays(tehranDate(NOW), -1), tehranDate(NOW)]);
  });

  it("T32 on the server: the seventh wrong sample word puts vocabulary back to A1 and removes the cards not asked yet; the message comes once", async () => {
    const user = await person();
    await beginPlacement(user, "fr", NOW);
    await play(user, (question) => (question.part === "vocab" && question.level === "A2" ? "wrong" : "right"));
    const ctx = await learnContext(user, "fr", NOW);
    const run = await testDb.placementRun.findFirstOrThrow({ where: { user_id: user.id } });
    const ids = (run.sample_state as unknown as SampleState).vocab!.wordIds;
    for (let i = 0; i < 7; i++) {
      await testDb.$transaction(async (tx) => {
        // What a session does before: the answered card is no longer on probation.
        await tx.itemState.updateMany({ where: { user_id: user.id, item_type: "word", item_id: ids[i] }, data: { probation: "none" } });
        await recordSample(tx, user.id, "fr", { kind: "vocab", wordId: ids[i], ok: false }, ctx);
      });
    }
    const vocab = await testDb.skillLevel.findFirstOrThrow({ where: { user_id: user.id, skill: "vocab" } });
    expect(vocab).toMatchObject({ level: "A1", known_below: "A1" });
    expect(await testDb.itemState.count({ where: { user_id: user.id, probation: "sample" } })).toBe(0);
    expect(await testDb.itemState.count({ where: { user_id: user.id, item_type: "word" } })).toBe(7);
    expect(await testDb.$transaction((tx) => takeSampleNotice(tx, user.id, "fr"))).toEqual({ kind: "vocab", level: "A1" });
    expect(await testDb.$transaction((tx) => takeSampleNotice(tx, user.id, "fr"))).toBeNull();
  });

  it("«ادامه نمی‌دهم» ends the test where it is: the block fails, the rest keeps A1", async () => {
    const user = await person();
    await beginPlacement(user, "fr", NOW);
    await play(user, () => "right", 12);
    const stopped = await placementInput(user, "fr", { stop: true }, null, NOW);
    expect(stopped).toMatchObject({ kind: "done", result: { pv: "A1", fv: "A2", fg: "A1", listening: "A1", reading: "A1", stopped: true } });
    expect(await placementRunning(user.id, "fr")).toBe(false);
  });

  it("the panel: readiness of each level, a made-up learner of A1 takes the test, and its result and sample show", async () => {
    const teacher = await person({ is_admin: true });
    const before = await placementOverview(teacher, "fr", NOW);
    expect(before.readiness.find((row) => row.level === "A1")).toMatchObject({ open: true, words: 30 });
    expect(before.readiness.find((row) => row.level === "A2")).toMatchObject({ open: true, words: 30, grammar: 0 });
    expect(before.last).toBeNull();
    const result = await rehearsePlacement(teacher, "fr", "A1", NOW);
    expect(result).toMatchObject({ pv: "A1", fv: "A2" });
    const after = await placementOverview(teacher, "fr", NOW);
    expect(after.last?.result).toMatchObject({ pv: "A1" });
    expect(after.last?.sample?.vocab?.wordIds).toHaveLength(30);
    expect(after.marks.vocab).toEqual({ need: 24, failAt: 7 });
    // A beginner fails the first block.
    expect(await rehearsePlacement(teacher, "fr", null, NOW)).toMatchObject({ pv: null, fv: "A1", phonicsAuto: true });
  }, 120_000);
});

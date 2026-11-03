import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ExamState } from "@/engine/exam";
import type { RawAnswer } from "@/engine/ex";
import { textAnswers } from "@/sim/answers";
import { addDays, plusDays, tehranDate } from "@/engine/time";
import { loadDemo } from "@/server/content/demo";
import { forgetContent } from "@/server/learn/content";
import { startFromZero } from "@/server/learn/enroll";
import { beginExam, examInput, examScreen, type ExamScreen } from "@/server/learn/exam";
import { homeData } from "@/server/learn/home";
import { rightAnswer, wrongAnswer } from "@/sim/answers";
import { seeded } from "@/engine/random";
import { resetDb, testDb } from "./db";

/**
 * «پرش از این سطح» on the server (PRD §11.6, T33) with the French demo; its second thirty card words and
 * three of its texts are moved to A2, so a tester has a level to skip to. Grading happens here; cards are
 * not touched; a pass moves the skill, a fail waits a week.
 */

const NOW = new Date("2026-10-24T08:00:00Z");
let phones = 0;

async function person(extra: { is_tester?: boolean } = { is_tester: true }) {
  const phone = `+98912500${String(++phones).padStart(4, "0")}`;
  const user = await testDb.user.create({ data: { phone, session_length_min: 15, ...extra } });
  const learner = { id: user.id, is_admin: user.is_admin, is_tester: user.is_tester, phone };
  await startFromZero(learner, "fr", NOW);
  return learner;
}
type Person = Awaited<ReturnType<typeof person>>;

const kept = async (user: Person, skill = "vocab") => (await testDb.levelExam.findFirstOrThrow({ where: { user_id: user.id, skill: skill as never, finished_at: null } })).state as unknown as ExamState;

/** Answers right `right` times, then wrong, to the end. */
async function take(user: Person, skill: "vocab" | "listening", right: number, at = NOW): Promise<Extract<ExamScreen, { kind: "done" }>> {
  let screen = await examScreen(user, "fr", skill, at);
  let given = 0;
  for (let i = 0; i < 40 && screen && screen.kind !== "done"; i++) {
    const current = (await kept(user, skill)).current!;
    if (screen.kind === "question" && current.kind === "question") {
      const answer: RawAnswer = given++ < right ? rightAnswer(current.ex) : wrongAnswer(current.ex);
      screen = await examInput(user, "fr", skill, { answer }, screen.number, at);
    } else if (screen.kind === "text") {
      const answers = textAnswers({ texts: { [screen.view.id]: screen.view } } as never, { text: { textId: screen.view.id, set: screen.info.set } } as never, seeded("x"), right > 0 ? 1 : 0) as { answers: Record<string, never> };
      screen = await examInput(user, "fr", skill, { answers: answers.answers }, screen.number, at);
    }
  }
  if (screen?.kind !== "done") throw new Error("the exam did not end");
  return screen;
}

beforeAll(async () => {
  await resetDb();
  await testDb.language.createMany({ data: [{ code: "fr", coming_soon_fa: "سطح A2 حدود آذر می‌آید." }, { code: "de" }] });
  expect(await loadDemo()).toMatchObject({ kind: "loaded" });
  const words = await testDb.word.findMany({ where: { language: "fr", no_card: false }, orderBy: { intro_order: "asc" }, select: { id: true } });
  await testDb.word.updateMany({ where: { id: { in: words.slice(30).map((row) => row.id) } }, data: { level: "A2" } });
  const texts = await testDb.text.findMany({ where: { language: "fr" }, orderBy: { id: "asc" }, select: { id: true } });
  await testDb.text.updateMany({ where: { id: { in: texts.slice(4).map((row) => row.id) } }, data: { level: "A2" } });
  forgetContent();
}, 120_000);

afterAll(() => testDb.$disconnect());

describe("the level exam on the server (PRD §11.6)", () => {
  it("the skill sheet: vocabulary ready for a tester, grammar hidden with six units, «سطح بعد به‌زودی» with the language's line for a learner", async () => {
    const tester = await person();
    const home = (await homeData(tester, "fr", NOW))!;
    expect(home.skills.find((tile) => tile.skill === "vocab")!.exam).toEqual({ kind: "ready", next: "A2" });
    // A1 has six units, fewer than the fifteen an exam asks.
    expect(home.skills.find((tile) => tile.skill === "grammar")!.exam).toBeNull();
    const learner = await person({ is_tester: false });
    const theirs = (await homeData(learner, "fr", NOW))!;
    expect(theirs.skills.find((tile) => tile.skill === "vocab")!.exam).toEqual({ kind: "soon" });
    expect(theirs.comingSoon).toBe("سطح A2 حدود آذر می‌آید.");
    expect(await beginExam(learner, "fr", "vocab", NOW)).toBe("unavailable");
  });

  it("T33: 12 of 15 passes: vocabulary A2 and known_below A2, answers logged as exam, no card made", async () => {
    const user = await person();
    expect(await beginExam(user, "fr", "vocab", NOW)).toBe("started");
    expect(await beginExam(user, "fr", "vocab", NOW)).toBe("running");
    const first = await examScreen(user, "fr", "vocab", NOW);
    expect(first).toMatchObject({ kind: "question", number: 1, size: 15, level: "A1" });
    if (first?.kind === "question") {
      expect(first.ex.code).toBe("W5a");
      expect(first.ex.a.kind === "type" && Array.isArray(first.ex.a.typo)).toBe(true);
    }
    const done = await take(user, "vocab", 15);
    expect(done).toMatchObject({ kind: "done", level: "A1", next: "A2", result: { passed: true, score: 12, size: 15 }, retryOn: null });
    expect(await testDb.skillLevel.findFirstOrThrow({ where: { user_id: user.id, skill: "vocab" } })).toMatchObject({ level: "A2", known_below: "A2" });
    expect(await testDb.levelExam.findFirstOrThrow({ where: { user_id: user.id } })).toMatchObject({ skill: "vocab", level: "A1", score: 12, passed: true });
    expect(await testDb.reviewLog.count({ where: { user_id: user.id, kind: "exam" } })).toBe(12);
    expect(await testDb.itemState.count({ where: { user_id: user.id } })).toBe(0);
    // At A2 now: B1 is open to a tester but has no words, so «سطح بعد به‌زودی».
    const home = (await homeData(user, "fr", NOW))!;
    expect(home.skills.find((tile) => tile.skill === "vocab")!.exam).toEqual({ kind: "soon" });
  });

  it("T33: 11 of 15 fails: nothing changes and the next try is a week later, with its date on the sheet", async () => {
    const user = await person();
    await beginExam(user, "fr", "vocab", NOW);
    const done = await take(user, "vocab", 11);
    expect(done.result).toEqual({ passed: false, score: 11, size: 15 });
    expect(done.retryOn).toBe(addDays(tehranDate(NOW), 7));
    expect(await testDb.skillLevel.findFirstOrThrow({ where: { user_id: user.id, skill: "vocab" } })).toMatchObject({ level: "A1", known_below: "A1" });
    const home = (await homeData(user, "fr", plusDays(NOW, 3)))!;
    expect(home.skills.find((tile) => tile.skill === "vocab")!.exam).toMatchObject({ kind: "wait", next: "A2" });
    expect(await beginExam(user, "fr", "vocab", plusDays(NOW, 3))).toBe("unavailable");
    expect(await beginExam(user, "fr", "vocab", plusDays(NOW, 7))).toBe("started");
  });

  it("an answer to another question changes nothing; leaving keeps the exam for later", async () => {
    const user = await person();
    await beginExam(user, "fr", "vocab", NOW);
    const first = await examScreen(user, "fr", "vocab", NOW);
    if (first?.kind !== "question") throw new Error("a question");
    const stale = await examInput(user, "fr", "vocab", { answer: { idk: true } }, 7, NOW);
    expect(stale).toMatchObject({ kind: "question", number: 1 });
    expect(await testDb.reviewLog.count({ where: { user_id: user.id } })).toBe(0);
    const second = await examInput(user, "fr", "vocab", { answer: { idk: true } }, 1, NOW);
    expect(second).toMatchObject({ kind: "question", number: 2 });
    const home = (await homeData(user, "fr", NOW))!;
    expect(home.skills.find((tile) => tile.skill === "vocab")!.exam).toEqual({ kind: "running", next: "A2" });
    expect(await examScreen(user, "fr", "vocab", plusDays(NOW, 1))).toMatchObject({ kind: "question", number: 2 });
  });

  it("listening: two untouched A1 texts, all right passes; both texts get used_in_test", async () => {
    const user = await person();
    expect(await beginExam(user, "fr", "listening", NOW)).toBe("started");
    const first = await examScreen(user, "fr", "listening", NOW);
    expect(first).toMatchObject({ kind: "text", number: 1, size: 2 });
    if (first?.kind === "text") expect(first.view.sentences.every((sentence) => sentence.translation === "" && sentence.glosses.length === 0)).toBe(true);
    const done = await take(user, "listening", 1);
    expect(done.result).toMatchObject({ passed: true, score: 100 });
    expect(await testDb.skillLevel.findFirstOrThrow({ where: { user_id: user.id, skill: "listening" } })).toMatchObject({ level: "A2" });
    const used = await testDb.textState.findMany({ where: { user_id: user.id } });
    expect(used).toHaveLength(2);
    expect(used.every((row) => row.used_in_test && row.track === "listening" && row.attempts_done === 0)).toBe(true);
  });
});

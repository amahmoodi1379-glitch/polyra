import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { loadDemo } from "@/server/content/demo";
import { suspectItems, textsOutOfPlace } from "@/server/content/health/suspects";
import { dashboard } from "@/server/insights/dashboard";
import { learningReport } from "@/server/insights/learning";
import { resetDb, testDb } from "./db";

/**
 * «یادگیری واقعی», «داشبورد» and the answer-based half of «سلامت محتوا» (PRD §13.2, §13.11), from rows
 * written the way the app writes them.
 */

const NOW = new Date("2026-11-01T08:00:00Z");
const DAY = 86_400_000;
const at = (days: number) => new Date(NOW.getTime() + days * DAY);
let phones = 0;

async function person(extra: { is_tester?: boolean; created_at?: Date } = {}) {
  return testDb.user.create({ data: { phone: `+98912800${String(++phones).padStart(4, "0")}`, session_length_min: 15, ...extra } });
}

type Row = { user: number; type?: string; item: number; kind?: "intro" | "review" | "followup" | "self" | "dialogue" | "errorfix"; code?: string; result: "correct" | "near" | "wrong" | "idk" | "self_ok" | "self_near" | "self_no"; step?: number; rated?: boolean; ts: Date; ms?: number; sentence?: number };

const answers = (rows: Row[]) =>
  testDb.reviewLog.createMany({
    data: rows.map((row, i) => ({
      id: randomUUID(),
      user_id: row.user,
      language: "fr",
      kind: row.kind ?? "review",
      item_type: row.type ?? "word",
      item_id: row.item,
      exercise_code: row.code ?? "W2a",
      step_before: row.step ?? null,
      result: row.result,
      fsrs_rating: row.rated === false ? null : 3,
      latency_ms: row.ms ?? 4000,
      sentence_id: row.sentence ?? null,
      seq: i + 1,
      ts: row.ts,
    })),
  });

let words: { id: number; level: string }[] = [];

beforeAll(async () => {
  await resetDb();
  await testDb.language.createMany({ data: [{ code: "fr" }, { code: "de" }] });
  expect(await loadDemo()).toMatchObject({ kind: "loaded" });
  words = await testDb.word.findMany({ where: { language: "fr", no_card: false }, select: { id: true, level: true }, orderBy: { id: "asc" }, take: 3 });
  await testDb.word.update({ where: { id: words[2].id }, data: { level: "A2" } });
}, 120_000);

beforeEach(async () => {
  await testDb.$executeRawUnsafe(
    `TRUNCATE "review_log", "session", "enrollment", "item_state", "confusion_pair", "writing_entry", "text_state", "subscription", "order", "plan", "user" RESTART IDENTITY CASCADE`,
  );
});

afterAll(() => testDb.$disconnect());

const filter = (extra: Partial<Parameters<typeof learningReport>[0]> = {}) => ({ language: "fr", level: null, from: at(-60), to: at(1), testers: false, ...extra });

describe("«یادگیری واقعی» (PRD §13.11)", () => {
  it("puts each graded review in its step and its interval since the item's previous rating; the first review apart", async () => {
    const learner = await person();
    const tester = await person({ is_tester: true });
    const [a, b] = words;
    await answers([
      // Word a: rated at its intro, then reviews 1, 5 and 40 days later.
      { user: learner.id, item: a.id, kind: "intro", result: "correct", ts: at(-50) },
      { user: learner.id, item: a.id, result: "correct", step: 1, ts: at(-49) },
      { user: learner.id, item: a.id, result: "wrong", step: 2, ts: at(-44) },
      { user: learner.id, item: a.id, result: "near", step: 3, ts: at(-4) },
      // A follow-up the same day is not a review; an unrated review is not counted.
      { user: learner.id, item: a.id, kind: "followup", result: "wrong", rated: false, ts: at(-4) },
      // Word b: its first review was wrong.
      { user: learner.id, item: b.id, kind: "intro", result: "correct", ts: at(-10) },
      { user: learner.id, item: b.id, result: "wrong", step: 1, ts: at(-9) },
      // A tester's answers stay out unless asked for.
      { user: tester.id, item: a.id, kind: "intro", result: "correct", ts: at(-10) },
      { user: tester.id, item: a.id, result: "correct", step: 1, ts: at(-9) },
    ]);
    const report = await learningReport(filter());
    expect(report.grid[1].d1).toEqual({ n: 2, ok: 1 });
    expect(report.grid[2].d2_7).toEqual({ n: 1, ok: 0 });
    expect(report.grid[3].d31).toEqual({ n: 1, ok: 1 });
    expect(report.grid[4].d1).toEqual({ n: 0, ok: 0 });
    expect(report.first).toEqual({ n: 2, ok: 1 });

    const withTesters = await learningReport(filter({ testers: true }));
    expect(withTesters.grid[1].d1).toEqual({ n: 3, ok: 2 });

    // The period: only what was answered in it, though the interval reaches back before it.
    const recent = await learningReport(filter({ from: at(-5) }));
    expect(recent.grid[3].d31).toEqual({ n: 1, ok: 1 });
    expect(recent.grid[1].d1).toEqual({ n: 0, ok: 0 });
    expect(recent.first).toEqual({ n: 0, ok: 0 });
  });

  it("each exercise code's accuracy, «نمی‌دانم» and median time; a level keeps only its items", async () => {
    const learner = await person();
    const [a, , c] = words;
    await answers([
      { user: learner.id, item: a.id, code: "W2a", result: "correct", ts: at(-3), ms: 2000 },
      { user: learner.id, item: a.id, code: "W2a", result: "idk", ts: at(-2), ms: 4000 },
      { user: learner.id, item: a.id, code: "W2a", result: "wrong", ts: at(-1), ms: 9000 },
      { user: learner.id, item: c.id, code: "W6a", result: "near", ts: at(-1), ms: 6000 },
    ]);
    const all = await learningReport(filter());
    expect(all.codes).toEqual([
      { code: "W2a", n: 3, ok: 1, idk: 1, medianMs: 4000 },
      { code: "W6a", n: 1, ok: 1, idk: 0, medianMs: 6000 },
    ]);
    const a2 = await learningReport(filter({ level: "A2" }));
    expect(a2.codes.map((row) => row.code)).toEqual(["W6a"]);
  });

  it("learners of the period: slow pace, a freeze, sticky words, the pairs most mixed up", async () => {
    const [one, two, idle] = [await person(), await person(), await person()];
    const [a, b] = words;
    for (const user of [one, two, idle]) await testDb.enrollment.create({ data: { user_id: user.id, language: "fr", pace_mode: user === one ? "slow" : "normal", freeze_count: user === two ? 1 : 0 } });
    for (const user of [one, two]) await testDb.session.create({ data: { user_id: user.id, language: "fr", scope: "mixed", planned_length_min: 15, plan: {}, created_at: at(-2) } });
    await testDb.session.create({ data: { user_id: idle.id, language: "fr", scope: "mixed", planned_length_min: 15, plan: {}, created_at: at(-90) } });
    await testDb.itemState.create({ data: { user_id: one.id, language: "fr", item_type: "word", item_id: a.id, fsrs: {}, fail_count: 4 } });
    await testDb.itemState.create({ data: { user_id: two.id, language: "fr", item_type: "word", item_id: b.id, fsrs: {}, fail_count: 3 } });
    await testDb.confusionPair.create({ data: { user_id: one.id, language: "fr", word_id: a.id, other_word_id: b.id, count: 3, last_at: at(-2) } });
    await testDb.confusionPair.create({ data: { user_id: two.id, language: "fr", word_id: b.id, other_word_id: a.id, count: 2, last_at: at(-2) } });
    const { learners } = await learningReport(filter());
    expect(learners).toMatchObject({ active: 2, slow: 1, freeze: 1, sticky: 1 });
    const lemmas = await testDb.word.findMany({ where: { id: { in: [a.id, b.id] } }, orderBy: { id: "asc" }, select: { lemma: true } });
    expect(learners.pairs).toEqual([{ a: lemmas[0].lemma, b: lemmas[1].lemma, count: 5, people: 2 }]);
  });

  it("speaking by level, dialogues and find-the-mistake by item, writing by week", async () => {
    const learner = await person();
    const sentence = await testDb.sentence.findFirstOrThrow({ where: { language: "fr" }, orderBy: { id: "asc" } });
    const dialogue = await testDb.dialogue.findFirstOrThrow({ where: { language: "fr" } });
    const errorfix = await testDb.errorfixItem.findFirstOrThrow({ where: { language: "fr" } });
    await answers([
      { user: learner.id, type: "sentence", item: sentence.id, sentence: sentence.id, kind: "self", code: "S1", result: "self_ok", rated: false, ts: at(-1) },
      { user: learner.id, type: "sentence", item: sentence.id, sentence: sentence.id, kind: "self", code: "S1", result: "self_near", rated: false, ts: at(-1) },
      { user: learner.id, type: "sentence", item: sentence.id, sentence: sentence.id, kind: "self", code: "S1", result: "self_no", rated: false, ts: at(-1) },
      { user: learner.id, type: "dialogue", item: dialogue.id, kind: "dialogue", code: "S3", result: "correct", rated: false, ts: at(-1) },
      { user: learner.id, type: "dialogue", item: dialogue.id, kind: "dialogue", code: "S3", result: "wrong", rated: false, ts: at(-1) },
      { user: learner.id, type: "errorfix_item", item: errorfix.id, kind: "errorfix", code: "S4", result: "correct", rated: false, ts: at(-1) },
    ]);
    const task = await testDb.writingTask.findFirst({ where: { language: "fr" } });
    if (task) {
      await testDb.writingEntry.createMany({ data: [{ user_id: learner.id, writing_task_id: task.id, text: "a", created_at: at(-1) }, { user_id: learner.id, writing_task_id: task.id, text: "b", created_at: at(-9) }] });
    }
    const { production } = await learningReport(filter());
    expect(production.speak).toEqual([{ level: sentence.level, ok: 1, near: 1, no: 1 }]);
    expect(production.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "dialogue", id: dialogue.id, n: 2, ok: 1 }),
        expect.objectContaining({ kind: "errorfix", id: errorfix.id, n: 1, ok: 1 }),
      ]),
    );
    if (task) expect(production.writing.map((row) => row.n)).toEqual([1, 1]);
  });

  it("the funnel: started, a first session, a second and third day, still there at the end of the free days, bought", async () => {
    const [stays, leaves, never] = [await person(), await person(), await person()];
    const plan = await testDb.plan.create({ data: { language: "fr", name_fa: "ماهانه", duration_days: 30, price_toman: 100_000, module_codes: [] } });
    for (const user of [stays, leaves, never]) await testDb.enrollment.create({ data: { user_id: user.id, language: "fr", created_at: at(-10), trial_started_at: at(-10), trial_ends_at: at(-7) } });
    const session = (user: number, days: number, ended = true) =>
      testDb.session.create({ data: { user_id: user, language: "fr", scope: "mixed", planned_length_min: 15, plan: {}, created_at: at(days), ended_at: ended ? at(days) : null } });
    for (const days of [-10, -9, -8, -7]) await session(stays.id, days);
    await session(leaves.id, -10, false);
    await testDb.order.create({ data: { user_id: stays.id, plan_id: plan.id, language: "fr", amount_toman: 100_000, final_amount: 100_000, gateway: "mock", status: "paid" } });
    const { funnel } = await learningReport(filter());
    expect(funnel).toEqual({ signup: 3, firstSession: 1, day2: 1, day3: 1, trialEnd: 1, purchase: 1 });
  });
});

describe("«سلامت محتوا» from answers (PRD §13.11)", () => {
  it("an item mostly wrong or mostly «نمی‌دانم» at one step, from 30 answers; a text far too hard for its place", async () => {
    const learners = await Promise.all(Array.from({ length: 12 }, () => person()));
    const [a, b, c] = words;
    const rows: Row[] = [];
    for (let i = 0; i < 30; i++) {
      rows.push({ user: learners[i % 12].id, item: a.id, result: i < 10 ? "correct" : "wrong", step: 2, ts: at(-1) });
      rows.push({ user: learners[i % 12].id, item: b.id, result: i < 25 ? "correct" : "idk", step: 2, ts: at(-1) });
      rows.push({ user: learners[i % 12].id, item: c.id, result: i < 20 ? "correct" : "idk", step: 3, ts: at(-1) });
    }
    // 29 answers at another step say nothing yet.
    for (let i = 0; i < 29; i++) rows.push({ user: learners[0].id, item: b.id, result: "wrong", step: 4, ts: at(-1) });
    await answers(rows);
    const suspects = await suspectItems("fr");
    expect(suspects.map((row) => [row.id, row.step])).toEqual([[a.id, 2]]);
    expect(suspects[0]).toMatchObject({ n: 30, ok: 10, idk: 0, href: `/admin/content/words/${a.id}` });
    // Over 40% «نمی‌دانم» with enough right answers still counts.
    await answers(Array.from({ length: 13 }, () => ({ user: learners[1].id, item: c.id, result: "idk" as const, step: 3, ts: at(-1) })));
    expect((await suspectItems("fr")).map((row) => row.id)).toEqual(expect.arrayContaining([a.id, c.id]));

    const texts = await testDb.text.findMany({ where: { language: "fr" }, orderBy: { id: "asc" }, take: 2 });
    for (const [i, user] of learners.entries()) {
      await testDb.textState.create({ data: { user_id: user.id, text_id: texts[0].id, track: "reading", first_score: 0.2 } });
      if (i < 9) await testDb.textState.create({ data: { user_id: user.id, text_id: texts[1].id, track: "reading", first_score: 1 } });
    }
    const flagged = await textsOutOfPlace("fr");
    expect(flagged).toEqual([expect.objectContaining({ id: texts[0].id, track: "reading", n: 12, mean: expect.closeTo(0.2, 5) })]);
  });
});

describe("«داشبورد» (PRD §13.2)", () => {
  it("counts learners only: sign-ups, free days ending, subscriptions, sessions a day; and content by type, level and status", async () => {
    const recent = await person({ created_at: at(-0.5) });
    const older = await person({ created_at: at(-20) });
    await person({ is_tester: true });
    await testDb.enrollment.create({ data: { user_id: recent.id, language: "fr", trial_started_at: at(-2), trial_ends_at: at(1) } });
    await testDb.enrollment.create({ data: { user_id: older.id, language: "fr", trial_started_at: at(-2), trial_ends_at: at(1) } });
    // A free period ending soon but already bought is not «رو به پایان».
    await testDb.subscription.create({ data: { user_id: older.id, language: "fr", starts_at: at(-1), ends_at: at(29), source: "manual" } });
    await testDb.session.create({ data: { user_id: recent.id, language: "fr", scope: "mixed", planned_length_min: 15, plan: {}, created_at: at(-0.2) } });
    await testDb.session.create({ data: { user_id: recent.id, language: "fr", scope: "mixed", planned_length_min: 15, plan: {}, created_at: at(-0.1) } });

    const data = await dashboard(NOW);
    expect(data.signups).toEqual({ day: 1, week: 1, month: 2, all: 2 });
    expect(data.ending).toEqual({ fr: 1, de: 0 });
    expect(data.subscriptions).toEqual({ fr: 1, de: 0 });
    expect(data.sessions).toEqual([{ day: "2026-11-01", language: "fr", n: 2, people: 1 }]);
    const fr = data.content.find((block) => block.language === "fr")!;
    const wordsA1 = fr.rows.filter((row) => row.slug === "words" && row.level === "A1").reduce((sum, row) => sum + row.n, 0);
    expect(wordsA1).toBe(await testDb.word.count({ where: { language: "fr", level: "A1" } }));
    expect(fr.rows.some((row) => row.slug === "tables" && row.level !== null)).toBe(true);
    expect(fr.rows.filter((row) => row.slug === "phonics").every((row) => row.level === null)).toBe(true);
  });
});

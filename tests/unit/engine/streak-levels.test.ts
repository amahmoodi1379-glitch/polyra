import { describe, expect, it } from "vitest";
import { newItemState } from "@/engine/answer";
import { indexItems, overallLevel, vocabLevelUp, vocabProgress } from "@/engine/levels";
import type { ItemStateE } from "@/engine/state";
import { catchUp, finishDay, type StreakState } from "@/engine/streak";
import { addDays, weekStart } from "@/engine/time";
import { content, defaults, settings, word } from "./kit";

// 2026-10-10 is a Saturday.
const SAT = "2026-10-10";
const none = () => 0;
const streak = (count: number, last: string, extra: Partial<StreakState> = {}): StreakState => ({
  streakCount: count,
  streakLastDate: last,
  streakForgivenWeek: null,
  streakForgivenCount: 0,
  freezeCount: 0,
  freezeCheckedWeek: weekStart(last),
  ...extra,
});

describe("streak (PRD §3.9)", () => {
  it("the week starts on Saturday", () => {
    expect(weekStart(SAT)).toBe(SAT);
    expect(weekStart("2026-10-16")).toBe(SAT);
    expect(weekStart("2026-10-17")).toBe("2026-10-17");
  });

  it("T66: one missed day uses the forgiveness day: 5 becomes 6", () => {
    const out = finishDay(streak(5, SAT), addDays(SAT, 2), none, defaults);
    expect(out.state.streakCount).toBe(6);
    expect(out.event.forgiven).toBe(1);
  });

  it("T66: two missed days without a freeze break the streak; the next session makes it 1", () => {
    const out = finishDay(streak(5, SAT), addDays(SAT, 3), none, defaults);
    expect(out.event.broken).toBe(true);
    expect(out.state.streakCount).toBe(1);
  });

  it("T66: the same with one freeze keeps the streak and uses the freeze", () => {
    const out = finishDay(streak(5, SAT, { freezeCount: 1 }), addDays(SAT, 3), none, defaults);
    expect(out.state).toMatchObject({ streakCount: 6, freezeCount: 0 });
  });

  it("T66: a second missed day in the same week without a freeze breaks the streak", () => {
    const used = streak(5, addDays(SAT, 3), { streakForgivenWeek: SAT, streakForgivenCount: 1 });
    expect(finishDay(used, addDays(SAT, 5), none, defaults).state.streakCount).toBe(1);
  });

  it("T66: a day with only «تمرین بیشتر» is a missed day (no finishDay for it)", () => {
    // Day 1 had only an extra session; day 2 is finished: day 1 is covered by forgiveness, not counted.
    expect(finishDay(streak(5, SAT), addDays(SAT, 2), none, defaults).state.streakCount).toBe(6);
  });

  it("T94: every day of a week above 15 minutes earns one freeze; a 14-minute day earns none; three weeks give the cap of 2", () => {
    const minutes = (perDay: Record<string, number>) => (date: string) => (perDay[date] ?? 0) * 60;
    const week = (start: string, value: number) => Object.fromEntries(Array.from({ length: 7 }, (_, i) => [addDays(start, i), value]));
    const fresh: StreakState = { streakCount: 0, streakLastDate: null, streakForgivenWeek: null, streakForgivenCount: 0, freezeCount: 0, freezeCheckedWeek: addDays(SAT, -7) };
    const nextSat = addDays(SAT, 7);
    expect(catchUp(fresh, nextSat, minutes(week(SAT, 16)), defaults).state.freezeCount).toBe(1);
    expect(catchUp(fresh, nextSat, minutes({ ...week(SAT, 16), [addDays(SAT, 3)]: 14 }), defaults).state.freezeCount).toBe(0);
    const three = { ...week(SAT, 16), ...week(addDays(SAT, 7), 16), ...week(addDays(SAT, 14), 16) };
    expect(catchUp(fresh, addDays(SAT, 21), minutes(three), defaults).state.freezeCount).toBe(2);
    expect(catchUp(fresh, addDays(SAT, 21), minutes(three), settings({ "freeze.max": 3 })).state.freezeCount).toBe(3);
  });
});

describe("levels and stations (PRD §3.2, §3.9, §9.6)", () => {
  const words = Array.from({ length: 120 }, (_, i) => word(i + 1, `mot${i + 1}`, `معنی ${i + 1}`, { level: i < 100 ? "A1" : "A2" }));
  const data = content({ words });
  const vocab = { skill: "vocab" as const, level: "A1", knownBelow: "A1" };
  const stateAt = (id: number, step: number): ItemStateE => ({ ...newItemState("word", id, new Date("2026-10-01T00:00:00Z")), step, firstReviewDone: true });

  it("T67: the 50th known word of the level is station 1", () => {
    const before = indexItems(Array.from({ length: 49 }, (_, i) => stateAt(i + 1, 2)));
    const after = indexItems(Array.from({ length: 50 }, (_, i) => stateAt(i + 1, 2)));
    expect(vocabProgress(data, before, vocab, defaults)).toMatchObject({ station: 0, stations: 2 });
    expect(vocabProgress(data, after, vocab, defaults)).toMatchObject({ station: 1, known: 50 });
  });

  it("vocabulary goes up with 90% known and 70% of those stable, only into an open level", () => {
    const most = indexItems(Array.from({ length: 90 }, (_, i) => stateAt(i + 1, i < 63 ? 4 : 2)));
    expect(vocabLevelUp(data, most, vocab, defaults)).toBe("A2");
    const unstable = indexItems(Array.from({ length: 90 }, (_, i) => stateAt(i + 1, i < 62 ? 4 : 2)));
    expect(vocabLevelUp(data, unstable, vocab, defaults)).toBeNull();
    expect(vocabLevelUp({ ...data, openLevels: ["A1"] }, most, vocab, defaults)).toBeNull();
    const progress = vocabProgress(data, most, vocab, defaults);
    expect(progress.progress).toBeCloseTo(0.5 * 0.9 + 0.5 * 0.63);
  });

  it("T95: vocabulary B1, grammar A2, listening A2, reading A1 is overall A2", () => {
    expect(overallLevel(data, { vocab: "B1", grammar: "A2", listening: "A2", reading: "A1" })).toBe("A2");
    // A skill not open yet counts as the lowest level.
    expect(overallLevel(data, { vocab: "B1", grammar: "B1", listening: null, reading: null })).toBe("A1");
  });
});

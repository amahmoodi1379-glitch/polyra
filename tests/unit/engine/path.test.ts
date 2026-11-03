/**
 * «پایان مسیر» (PRD §3.13, T103): every skill at the last level and ready to move on as if a level came
 * after it; not when the last level is not published, a skill is below it, or one rule is not met.
 */
import { describe, expect, it } from "vitest";
import { newItemState } from "@/engine/answer";
import type { Content } from "@/engine/content";
import { indexItems } from "@/engine/levels";
import { pathDone } from "@/engine/path";
import type { ItemStateE, SkillLevelE, TextStateE } from "@/engine/state";
import { plusDays } from "@/engine/time";
import { syntheticContent } from "../../../fixtures/synthetic";
import { settings } from "./kit";

const NOW = new Date("2026-09-01T08:00:00Z");
const s = settings();
const content: Content = syntheticContent({ perLevel: { words: [10, 10, 10, 10], units: [2, 2, 2, 2] }, textsPerLevel: 4 });
const top = (over: Partial<Record<SkillLevelE["skill"], Partial<SkillLevelE>>> = {}): SkillLevelE[] =>
  (["vocab", "grammar", "listening", "reading"] as const).map((skill) => ({ skill, level: "B2", knownBelow: "B2", ...over[skill] }));

const stable = (type: ItemStateE["itemType"], id: number): ItemStateE => ({ ...newItemState(type, id, plusDays(NOW, -60)), step: 6, firstReviewDone: true });
const b2Words = [...content.words.values()].filter((word) => word.level === "B2" && !word.noCard);
const b2Units = content.units.filter((unit) => unit.level === "B2");
const done = (track: "listening" | "reading"): TextStateE[] =>
  content.texts
    .filter((text) => text.level === "B2")
    .map((text, i) => ({
      textId: text.id,
      track,
      attemptsDone: 3,
      firstScore: 0.9,
      scores: [{ attempt: 1, set: "A" as const, score: 0.9, at: plusDays(NOW, -30 + i).toISOString() }],
      lastAttemptAt: plusDays(NOW, -10).toISOString(),
      nextAttemptAt: null,
      partial: null,
      partialUntil: null,
      usedInTest: false,
    }));
const items = () => indexItems([...b2Words.map((word) => stable("word", word.id)), ...b2Units.map((unit) => stable("grammar_unit", unit.id))]);
const texts = () => [...done("listening"), ...done("reading")];

describe("the end of the path (PRD §3.13, T103)", () => {
  it("every skill at B2 and ready to move on: done", () => {
    expect(pathDone(content, items(), top(), texts(), s, NOW)).toBe(true);
  });

  it("not with B2 unpublished, a skill below B2, a B2 unit not opened, words not stable, or a track's texts left", () => {
    expect(pathDone({ ...content, openLevels: ["A1", "A2", "B1"] }, items(), top(), texts(), s, NOW)).toBe(false);
    expect(pathDone(content, items(), top({ reading: { level: "B1" } }), texts(), s, NOW)).toBe(false);
    const oneUnit = indexItems([...b2Words.map((word) => stable("word", word.id)), stable("grammar_unit", b2Units[0].id)]);
    expect(pathDone(content, oneUnit, top(), texts(), s, NOW)).toBe(false);
    const shaky = indexItems([...b2Words.map((word) => ({ ...stable("word", word.id), step: 2 })), ...b2Units.map((unit) => stable("grammar_unit", unit.id))]);
    expect(pathDone(content, shaky, top(), texts(), s, NOW)).toBe(false);
    expect(pathDone(content, items(), top(), done("listening"), s, NOW)).toBe(false);
  });
});

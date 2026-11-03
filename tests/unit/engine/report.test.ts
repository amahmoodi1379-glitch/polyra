import { describe, expect, it } from "vitest";
import { answerWasCounted, notebookRefOf, rightAfterAll, type ReportedAnswer } from "@/engine/report";

/** «حق با تو بود» (PRD §13.10, T72): what is put back for a learner whose reported answer was right. */

const answer = (extra: Partial<ReportedAnswer>): ReportedAnswer => ({ itemType: "word", itemId: 7, code: "W6a", targetId: 30, stepBefore: 6, result: "wrong", ...extra });

describe("T72: «حق با تو بود»", () => {
  it("applies only to an answer recorded wrong or «نمی‌دانم»", () => {
    expect(answerWasCounted(answer({ result: "wrong" }))).toBe(true);
    expect(answerWasCounted(answer({ result: "idk" }))).toBe(true);
    expect(answerWasCounted(answer({ result: "near" }))).toBe(false);
    expect(answerWasCounted(answer({ result: "correct" }))).toBe(false);
  });

  it("finds the notebook entry that answer made (PRD §9.5)", () => {
    expect(notebookRefOf(answer({}))).toEqual({ refType: "word", refId: 7 });
    expect(notebookRefOf(answer({ code: "W2d" }))).toEqual({ refType: "word_gender", refId: 7 });
    expect(notebookRefOf(answer({ itemType: "conjugation", itemId: 4, code: "C2" }))).toEqual({ refType: "conjugation", refId: 4 });
    expect(notebookRefOf(answer({ itemType: "grammar_unit", itemId: 2, code: "G5a", targetId: 30 }))).toEqual({ refType: "grammar_target", refId: 30 });
    // A unit's answer with no sentence (a transform, a translation) made no entry.
    expect(notebookRefOf(answer({ itemType: "grammar_unit", itemId: 2, code: "G6", targetId: null }))).toBeNull();
    // Practised from the notebook: the target itself.
    expect(notebookRefOf(answer({ itemType: "grammar_target", itemId: 30, code: "G5a" }))).toEqual({ refType: "grammar_target", refId: 30 });
    expect(notebookRefOf(answer({ itemType: "text", itemId: 3 }))).toBeNull();
    expect(notebookRefOf(answer({ itemId: null }))).toBeNull();
  });

  it("puts the step back to the larger of now and before, one failure fewer, never below zero", () => {
    expect(rightAfterAll({ step: 4, failCount: 2 }, 6)).toEqual({ step: 6, failCount: 1 });
    // Climbed past it since: the step stays.
    expect(rightAfterAll({ step: 7, failCount: 1 }, 6)).toEqual({ step: 7, failCount: 0 });
    expect(rightAfterAll({ step: 3, failCount: 0 }, null)).toEqual({ step: 3, failCount: 0 });
  });
});

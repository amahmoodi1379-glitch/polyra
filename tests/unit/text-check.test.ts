import { describe, expect, it } from "vitest";
import { allowedTypes, checkQuestionSets, questionRange } from "@/server/content/text-check";

const sentences = [
  { text: "Le train part à 14h30.", tokens: [{ kind: "word" as const }, { kind: "number" as const }] },
  { text: "Marie attend sur le quai.", tokens: [{ kind: "name" as const }] },
  { text: "Elle lit un journal.", tokens: [{ kind: "word" as const }] },
];

const tf = (prompt: string) => ({ type: "tf", prompt, correct: true, prompt_fa: "پرسش" });
const sets = (reading: unknown[], listening: unknown[] = [tf("a"), tf("b"), tf("c")]) => ({
  reading: { A: reading, B: [tf("x"), tf("y"), tf("z")] },
  listening: { A: listening, B: [tf("u"), tf("v"), tf("w")] },
});

describe("text questions (PRD §7.3, §7.7)", () => {
  it("allows each type only in its tracks and bands", () => {
    expect(allowedTypes("listening", 1)).toEqual(["mcq", "tf", "order", "dict", "num"]);
    expect(allowedTypes("reading", 4)).toEqual(["mcq", "order", "find", "cloze", "ctx"]);
    expect(questionRange(1, "A", false)).toEqual([2, 8]);
    expect(questionRange(3, "A", true)).toEqual([4, 8]);
    expect(questionRange(3, "B", true)).toEqual([3, 8]);
  });

  it("accepts valid match, cloze, ctx and num questions of band 3", () => {
    const reading = [
      { type: "match", prompt: "?", prompt_fa: "؟", left: ["Marie", "Le train"], right: ["attend", "part", "lit"], pairs: [[1, 1], [0, 0]] },
      { type: "cloze", prompt: "?", prompt_fa: "؟", text_with_gaps: "Le {{1}} part à 14h30. Elle {{2}} un journal.", bank: ["train", "lit", "bus"], answers: ["train", "lit"] },
      { type: "ctx", word: "quai", prompt: "?", prompt_fa: "؟", options: ["a", "b", "c", "d"], correct: 2 },
    ];
    const listening = [{ type: "num", prompt: "?", prompt_fa: "؟", answer: "14h30", accepted: ["14h30", "14:30"] }, tf("a"), tf("b")];
    const result = checkQuestionSets(sets(reading, listening), { band: 3, placement: false, sentences });
    expect(result.problems).toEqual([]);
    expect(result.questions).toHaveLength(12);
  });

  it("names each broken question by its place", () => {
    const reading = [
      { type: "match", prompt: "?", prompt_fa: "؟", left: ["a", "b"], right: ["x", "y"], pairs: [[0, 1], [1, 1]] },
      { type: "cloze", prompt: "?", prompt_fa: "؟", text_with_gaps: "Le {{2}} part.", bank: ["train"], answers: ["train"] },
      { type: "ctx", word: "gare", prompt: "?", options: ["a", "b", "c", "d"], correct: 4 },
    ];
    const listening = [{ type: "num", prompt: "?", prompt_fa: "؟", answer: "deux", accepted: ["2"] }, tf("a"), tf("b")];
    const { problems } = checkQuestionSets(sets(reading, listening), { band: 3, placement: true, sentences });
    expect(problems.map((item) => [item.key, item.vars?.field])).toEqual([
      ["questionCount", "question_sets.reading.A"],
      ["matchInvalid", "question_sets.reading.A[0].pairs"],
      ["clozeInvalid", "question_sets.reading.A[1].text_with_gaps"],
      ["missing", "question_sets.reading.A[2].prompt_fa"],
      ["answerOutOfRange", "question_sets.reading.A[2].correct"],
      ["ctxWord", "question_sets.reading.A[2].word"],
      ["questionCount", "question_sets.listening.A"],
      ["numInvalid", "question_sets.listening.A[0].answer"],
    ]);
  });
});

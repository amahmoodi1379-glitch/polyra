import { describe, expect, it } from "vitest";
import { lengthFlags, targetOptions } from "@/server/content/kinds/sentence-store";

describe("length warnings (PRD §13.3 «همه»)", () => {
  const long = "Le ".repeat(70);

  it("warns once for any sentence over 200 characters and once for any option over 80", () => {
    expect(lengthFlags("t1", { sentences: ["Bonjour.", long, long] })).toEqual([{ label: "t1", problem: { key: "tooLong", vars: { field: "text", max: 200 } } }]);
    expect(lengthFlags("d1", { sentences: ["Oui."], options: ["Non.", long.slice(0, 81)], optionField: "choices" })).toEqual([
      { label: "d1", problem: { key: "tooLong", vars: { field: "choices", max: 80 } } },
    ]);
    expect(lengthFlags("ok", { sentences: [long.slice(0, 200)], options: [long.slice(0, 80)] })).toEqual([]);
  });

  it("takes a target's answers and wrong options, for one blank or two", () => {
    const target = { marked_text: "", hint: null, accepted_full: null };
    expect(targetOptions([{ ...target, blanks: 1, accepted: ["a"], distractors: ["b", "c", "d"] }, { ...target, blanks: 2, accepted: [["e"], ["f"]], distractors: [["g"], ["h"]] }])).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
      "f",
      "g",
      "h",
    ]);
  });
});

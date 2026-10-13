import { describe, expect, it } from "vitest";
import { arrange, automatic, movedRows, moveTo } from "@/lib/arrange";

describe("moving one row (PRD §13.2 «ترتیب»)", () => {
  it("puts the row at the given place and clamps places outside the list", () => {
    expect(moveTo([1, 2, 3, 4], 4, 1)).toEqual([4, 1, 2, 3]);
    expect(moveTo([1, 2, 3, 4], 1, 3)).toEqual([2, 3, 1, 4]);
    expect(moveTo([1, 2, 3, 4], 2, 0)).toEqual([2, 1, 3, 4]);
    expect(moveTo([1, 2, 3, 4], 2, 99)).toEqual([1, 3, 4, 2]);
    expect(moveTo([1, 2, 3, 4], 3, 2.4)).toEqual([1, 3, 2, 4]);
  });
});

describe("automatic places in the introduction order (PRD §5.8)", () => {
  it("puts a phrase right after the last of its parts, wherever the teacher dragged it", () => {
    // 10 = «s'il vous plaît» made of 2 and 4.
    expect(arrange([10, 1, 2, 3, 4, 5], [{ id: 10, after: [2, 4] }])).toEqual([1, 2, 3, 4, 10, 5]);
    // Moving a part moves the phrase with it.
    expect(arrange([1, 2, 3, 5, 4, 10], [{ id: 10, after: [2, 4] }])).toEqual([1, 2, 3, 5, 4, 10]);
    expect(arrange([4, 1, 2, 10, 3, 5], [{ id: 10, after: [2, 4] }])).toEqual([4, 1, 2, 10, 3, 5]);
  });

  it("keeps several followers of one word in their order and chains a sense after a phrase", () => {
    const anchored = [
      { id: 20, after: [1] },
      { id: 21, after: [1] },
      { id: 22, after: [20] },
    ];
    expect(arrange([21, 2, 20, 1, 22, 3], anchored)).toEqual([2, 1, 21, 20, 22, 3]);
  });

  it("ignores anchors outside the list and leaves words that wait on each other where they were", () => {
    expect(arrange([1, 7, 2], [{ id: 7, after: [99] }])).toEqual([1, 7, 2]);
    expect(
      arrange(
        [1, 7, 8, 2],
        [
          { id: 7, after: [8] },
          { id: 8, after: [7] },
        ],
      ),
    ).toEqual([1, 7, 8, 2]);
    expect(
      automatic(
        [1, 7, 8, 2],
        [
          { id: 7, after: [8] },
          { id: 9, after: [1] },
        ],
      ),
    ).toEqual(new Set([7]));
  });
});

describe("rows a reorder really moved (change log)", () => {
  it("names only the dragged rows, not the ones that shifted to make room", () => {
    expect(movedRows([1, 2, 3, 4, 5, 6], [5, 1, 2, 3, 4, 6])).toEqual([5]);
    expect(movedRows([1, 2, 3, 4, 5, 6], [2, 3, 4, 5, 1, 6])).toEqual([1]);
    // A swapped pair is one move; either of the two names it.
    const swapped = movedRows([1, 2, 3, 4, 5, 6], [6, 1, 2, 4, 3, 5]);
    expect(swapped).toHaveLength(2);
    expect(swapped).toContain(6);
    expect(movedRows([1, 2, 3], [1, 2, 3])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { knownBefore, usableSentences, type OrderedWord, type SentenceTokens } from "@/server/content/health/usable";

const word = (id: number, level: string, order: number | null, extra: Partial<OrderedWord> = {}): OrderedWord => ({
  id,
  level,
  intro_order: order,
  no_card: false,
  retired: false,
  dup_of_id: null,
  ...extra,
});

// je (no card), avoir #1, chat #2, manger #3, pomme #4 at A1; voiture at A2; vieux word retired; maison a duplicate of chat.
const words = new Map(
  [
    word(1, "A1", null, { no_card: true }),
    word(2, "A1", 1),
    word(3, "A1", 2),
    word(4, "A1", 3),
    word(5, "A1", 4),
    word(6, "A2", 1),
    word(7, "A1", 5, { retired: true }),
    word(8, "A1", 6, { dup_of_id: 3 }),
  ].map((item) => [item.id, item]),
);
const tok = (wordId: number | null, surface = `w${wordId}`) => ({ wordId, surface });
const sentence = (targets: number[], ids: (number | null)[]): SentenceTokens => ({ targets, tokens: ids.map((id) => tok(id, id === null ? "orange" : `w${id}`)) });

describe("usable sentences of a word (PRD §13.11)", () => {
  it("knows a word before another when it has no card, a lower level, or an earlier place in the order", () => {
    expect(knownBefore(words.get(1)!, words.get(2)!)).toBe(true);
    expect(knownBefore(words.get(3)!, words.get(4)!)).toBe(true);
    expect(knownBefore(words.get(5)!, words.get(4)!)).toBe(false);
    expect(knownBefore(words.get(5)!, words.get(6)!)).toBe(true);
    expect(knownBefore(words.get(6)!, words.get(5)!)).toBe(false);
    // A word not yet placed in the order comes after every placed word of its level.
    expect(knownBefore(word(9, "A1", null), words.get(5)!)).toBe(false);
    expect(knownBefore(words.get(5)!, word(9, "A1", null))).toBe(true);
  });

  it("counts a sentence for a word only when every other word comes earlier", () => {
    const counts = usableSentences(words, [
      sentence([4], [1, 2, 4]), // je avoir manger: usable
      sentence([4], [1, 4, 5]), // pomme comes later: blocked
      sentence([4, 5], [1, 4, 5, 3]), // usable for pomme only
      sentence([6], [1, 6, 5, 2]), // A2 word with A1 words: usable
    ]);
    expect(counts.get(4)).toMatchObject({ total: 3, usable: 1 });
    expect(counts.get(4)!.blockers).toEqual([{ key: "#5", wordId: 5, surface: "w5", reason: "later", count: 2 }]);
    expect(counts.get(5)).toMatchObject({ total: 1, usable: 1, blockers: [] });
    expect(counts.get(6)).toMatchObject({ total: 1, usable: 1 });
    expect(counts.has(2)).toBe(false);
  });

  it("blocks on unresolved candidates and retired words, and reads a duplicate as its original", () => {
    const counts = usableSentences(words, [
      sentence([4], [2, 4, null]),
      sentence([4], [2, 4, null, 7]),
      sentence([4], [4, 8]), // maison → chat (#2 in the order): usable
      sentence([2], [2, 8]), // for avoir, chat comes later
    ]);
    expect(counts.get(4)).toMatchObject({ total: 3, usable: 1 });
    expect(counts.get(4)!.blockers.map((blocker) => [blocker.reason, blocker.surface, blocker.count])).toEqual([
      ["unknown", "orange", 2],
      ["retired", "w7", 1],
    ]);
    expect(counts.get(2)!.blockers).toEqual([{ key: "#3", wordId: 3, surface: "w8", reason: "later", count: 1 }]);
  });

  it("counts a blocker once per sentence and the target's own other forms not at all", () => {
    const counts = usableSentences(words, [{ targets: [2, 2], tokens: [tok(2, "a"), tok(2, "ai"), tok(5, "pomme"), tok(5, "pommes")] }]);
    expect(counts.get(2)).toEqual({ total: 1, usable: 0, blockers: [{ key: "#5", wordId: 5, surface: "pomme", reason: "later", count: 1 }] });
  });

  it("lets the first words of a language use each other (PRD §14.9)", () => {
    const first = new Set([2, 3, 4]);
    const counts = usableSentences(words, [sentence([2], [2, 3, 4]), sentence([2], [2, 5])], first);
    expect(counts.get(2)).toMatchObject({ total: 2, usable: 1 });
    expect(counts.get(2)!.blockers.map((blocker) => blocker.wordId)).toEqual([5]);
  });
});

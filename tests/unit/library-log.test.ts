import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { wordDiff } from "@/lib/text-diff";
import { jsonColumns } from "@/server/content/library/revert";
import { difficultyScore } from "@/server/content/text-difficulty";

describe("word diff of a long edit (change log)", () => {
  it("marks only the words that changed and keeps spaces with their word", () => {
    expect(wordDiff("Pour ou les lèvres sont rondes.", "Pour ou les lèvres sont bien rondes.")).toEqual([
      { text: "Pour ou les lèvres sont ", kind: "same" },
      { text: "bien ", kind: "add" },
      { text: "rondes.", kind: "same" },
    ]);
    expect(wordDiff("un deux trois", "un trois")).toEqual([
      { text: "un ", kind: "same" },
      { text: "deux ", kind: "del" },
      { text: "trois", kind: "same" },
    ]);
    expect(wordDiff("", "سلام")).toEqual([{ text: "سلام", kind: "add" }]);
  });
});

describe("difficulty_score (PRD §7.5)", () => {
  it("is half the length within the band and half the share of same-level words, each clipped", () => {
    expect(difficultyScore(30, [30, 40], 0)).toBe(0);
    expect(difficultyScore(40, [30, 40], 1)).toBe(1);
    expect(difficultyScore(35, [30, 40], 0.5)).toBeCloseTo(0.5);
    expect(difficultyScore(80, [30, 40], 0.2)).toBeCloseTo(0.6);
    expect(difficultyScore(10, [30, 40], 1.4)).toBeCloseTo(0.5);
    expect(difficultyScore(35, [40, 40], 1)).toBeCloseTo(0.5);
  });
});

describe("JSON columns a revert writes", () => {
  it("lists every nullable JSON column of the content tables in prisma/schema.prisma", () => {
    const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const tables = new Map<string, { json: string[]; nullable: string[] }>();
    for (const block of schema.matchAll(/^model \w+ \{([\s\S]*?)^\}/gm)) {
      const table = block[1].match(/@@map\("(\w+)"\)/)?.[1];
      if (!table) continue;
      const fields = [...block[1].matchAll(/^\s+(\w+)\s+Json(\?)?/gm)];
      tables.set(table, { json: fields.map((field) => field[1]), nullable: fields.filter((field) => field[2]).map((field) => field[1]) });
    }
    for (const [table, columns] of Object.entries(jsonColumns)) {
      const found = tables.get(table);
      expect(found, table).toBeDefined();
      for (const column of found!.nullable) expect(columns, `${table}.${column}`).toContain(column);
      for (const column of columns) expect(found!.json, `${table}.${column}`).toContain(column);
    }
  });
});

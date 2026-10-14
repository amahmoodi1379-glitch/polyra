import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/csv";
import { csvOrder } from "@/server/content/transfer/words-csv";

describe("CSV files", () => {
  it("round-trips cells with quotes, separators, line breaks and edge spaces", () => {
    const rows = [
      ["code", "note_fa", "level"],
      ["chat", 'گفت: "سلام", بعد رفت', "A1"],
      ["chien", "خط اول\nخط دوم", "A1"],
      ["x;y", "\tبا تب", " فاصله "],
      ["", "", ""],
      ["vide", "", "B2"],
    ];
    const text = toCsv(rows);
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text.endsWith("\r\n")).toBe(true);
    expect(parseCsv(text)).toEqual(rows.filter((row) => row.some(Boolean)));
  });

  it("writes empty cells for null and undefined, and numbers and booleans as text", () => {
    expect(toCsv([[null, undefined, 3, false]])).toBe("\uFEFF,,3,false\r\n");
  });

  it("reads files saved with semicolons or tabs, LF or CR line ends, with or without a byte order mark", () => {
    expect(parseCsv("code;lemma\nchat;chat\n")).toEqual([
      ["code", "lemma"],
      ["chat", "chat"],
    ]);
    expect(parseCsv('code\tlemma\r\nchat\t"le, chat"')).toEqual([
      ["code", "lemma"],
      ["chat", "le, chat"],
    ]);
    expect(parseCsv("\uFEFFcode,lemma\rchat,chat\r")).toEqual([
      ["code", "lemma"],
      ["chat", "chat"],
    ]);
  });

  it("keeps a quote inside an unquoted cell as text", () => {
    expect(parseCsv('code,note\naujourd,l"ami')).toEqual([
      ["code", "note"],
      ["aujourd", 'l"ami'],
    ]);
  });
});

describe("csvOrder", () => {
  it("puts a whole level in file order", () => {
    expect(csvOrder([1, 2, 3, 4], [4, 2, 1, 3])).toEqual([4, 2, 1, 3]);
  });

  it("moves only the file's words, inside the places they held", () => {
    // 2 and 4 swap; 1, 3 and 5 stay where they were.
    expect(csvOrder([1, 2, 3, 4, 5], [4, 2])).toEqual([1, 4, 3, 2, 5]);
  });

  it("puts a new word after the file row before it", () => {
    expect(csvOrder([1, 2, 3], [2, 9, 3])).toEqual([1, 2, 9, 3]);
  });

  it("puts a new word that opens the file before the next placed row", () => {
    expect(csvOrder([1, 2, 3], [9, 3])).toEqual([1, 2, 9, 3]);
  });

  it("puts new words at the end when the file has no placed rows, keeping file order", () => {
    expect(csvOrder([1, 2], [8, 9])).toEqual([1, 2, 8, 9]);
    expect(csvOrder([], [8, 9])).toEqual([8, 9]);
  });
});

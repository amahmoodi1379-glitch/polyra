import { describe, expect, it } from "vitest";
import { safeMediaPath } from "@/server/backup/restore";
import { parentsFirst } from "@/server/backup/tables";
import { mediaFile } from "@/server/storage";

describe("full backup: table order and file paths", () => {
  it("puts each table after the tables it points at, ties by name", () => {
    const order = parentsFirst(["sentence_word", "word", "sentence", "concept", "user"], [
      { child: "sentence_word", parent: "word" },
      { child: "sentence_word", parent: "sentence" },
      { child: "word", parent: "concept" },
    ]);
    expect(order).toEqual(["concept", "sentence", "user", "word", "sentence_word"]);
  });

  it("refuses foreign keys that go round in a circle or point at their own table", () => {
    expect(() => parentsFirst(["a", "b"], [{ child: "a", parent: "b" }, { child: "b", parent: "a" }])).toThrow(/circle/);
    expect(() => parentsFirst(["a"], [{ child: "a", parent: "a" }])).toThrow(/itself/);
  });

  it("only writes files a backup of this app would hold", () => {
    expect(safeMediaPath("audio/2026-11/x_Y-1.mp3")).toBe("audio/2026-11/x_Y-1.mp3");
    for (const bad of ["audio/../x.mp3", "../audio/x.mp3", "backups/x.polyra", ".restore/x", "audio", "/audio/x.mp3", "audio/.hidden", "audio//x"]) {
      expect(safeMediaPath(bad)).toBeNull();
    }
  });

  it("serves only the audio folder under /media, never backups or a restore being uploaded", () => {
    expect(mediaFile(["audio", "2026-11", "a.mp3"])).not.toBeNull();
    expect(mediaFile(["backups", "polyra-backup-2026-11-18-10-00-00.polyra"])).toBeNull();
    expect(mediaFile([".restore", "abc.upload"])).toBeNull();
    expect(mediaFile(["audio"])).toBeNull();
    expect(mediaFile(["audio", "..", "backups", "x"])).toBeNull();
  });
});

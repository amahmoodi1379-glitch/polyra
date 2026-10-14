import { describe, expect, it } from "vitest";
import { errorCode, errorSeed } from "@/lib/error-code";
import { errorReport, kindOfWhere, type ErrorGroup } from "@/server/error-report";

describe("error codes (PRD §15.9)", () => {
  it("gives the same short code to the same error, and letters nobody confuses when reading it out", () => {
    const code = errorCode("render /admin/order|Cannot read properties of undefined (reading 'level')");
    expect(code).toMatch(/^E[2-9A-HJKMNP-Z]{6}$/);
    expect(errorCode("render /admin/order|Cannot read properties of undefined (reading 'level')")).toBe(code);
    expect(errorCode("render /admin/order|Cannot read properties of undefined (reading 'lemma')")).not.toBe(code);
    // A server error is coded from its digest, which is all the browser's error screen has.
    expect(errorCode("3028892782")).toBe(errorCode("3028892782"));
  });

  it("treats errors that differ only in numbers as the same error", () => {
    expect(errorSeed("action /admin/create", "Word 12 not found in batch 4")).toBe(errorSeed("action /admin/create", "Word 873 not found in batch 9"));
    expect(errorSeed("action /admin/create", "Word 12 not found")).not.toBe(errorSeed("action /admin/order", "Word 12 not found"));
  });

  it("spreads codes out: a thousand different errors get a thousand codes", () => {
    const codes = new Set(Array.from({ length: 1000 }, (_, index) => errorCode(`route /api/x|failure kind ${String.fromCharCode(65 + (index % 26))}${index}`)));
    expect(codes.size).toBe(1000);
  });
});

describe("the text «کپی برای Claude Code» copies", () => {
  const group: ErrorGroup = {
    code: "E4KQ7MZ",
    kind: "server",
    count: 3,
    users: 1,
    first: new Date("2026-10-12T08:14:00Z"),
    last: new Date("2026-10-14T09:02:00Z"),
    where: "action /admin/create",
    message: "Unique constraint failed",
    stack: "Error: Unique constraint failed\n    at createBatch (src/server/content/batches.ts:88:17)",
    requestId: "3017744921",
    phone: "+989120000001",
  };

  it("says what to do and holds everything known about the error", () => {
    expect(errorReport(group)).toBe(
      [
        "This error happened in Polyra. Find the cause and fix it.",
        "",
        "Code: E4KQ7MZ",
        "Seen: 3 times, first 2026-10-12T08:14:00.000Z, last 2026-10-14T09:02:00.000Z, signed-in users: 1",
        "Where: action /admin/create (on the server)",
        "Message: Unique constraint failed",
        "Digest: 3017744921",
        "Stack:",
        "Error: Unique constraint failed",
        "    at createBatch (src/server/content/batches.ts:88:17)",
      ].join("\n"),
    );
    // The learner's phone number never goes into the text.
    expect(errorReport(group)).not.toContain("912");
  });

  it("names a browser error by its page", () => {
    const text = errorReport({ ...group, kind: "browser", where: "browser /admin/audio", count: 1, users: 0, requestId: null, stack: null });
    expect(text).toContain("Seen: once, 2026-10-14T09:02:00.000Z\n");
    expect(text).toContain("Where: /admin/audio (in the browser)");
    expect(text).not.toContain("Digest");
    expect(kindOfWhere("browser /admin/audio")).toBe("browser");
    expect(kindOfWhere("render /admin")).toBe("server");
  });
});

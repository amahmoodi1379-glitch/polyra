import { describe, expect, it } from "vitest";
import { tehranDate, tehranDayStart } from "@/engine/time";

describe("Tehran day boundary (PRD §15.6)", () => {
  it("rolls over at 20:30 UTC, which is midnight in Tehran", () => {
    expect(tehranDate(new Date("2026-03-10T20:29:59Z"))).toBe("2026-03-10");
    expect(tehranDate(new Date("2026-03-10T20:30:00Z"))).toBe("2026-03-11");
  });

  it("finds the UTC start of a Tehran day", () => {
    expect(tehranDayStart("2026-03-11").toISOString()).toBe("2026-03-10T20:30:00.000Z");
  });
});

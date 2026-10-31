import { describe, expect, it } from "vitest";
import { leftInARow, mayOfferShorter, pickSessionMessage, shorterLength, type ClosedSession } from "@/engine/messages";
import { defaults, settings } from "./kit";

const left = (doneCount: number, endReason: ClosedSession["endReason"] = "expired"): ClosedSession => ({ endReason, doneCount, plannedCount: 20 });

describe("end-of-session messages (PRD §3.11)", () => {
  it("T80: with a level lower, shorter sessions and install all applying, only the level lower shows", () => {
    expect(pickSessionMessage([{ kind: "install" }, { kind: "shorter" }, { kind: "leveldown" }])).toEqual({ kind: "leveldown" });
    expect(pickSessionMessage([{ kind: "slowPace" }, { kind: "shorter" }])).toEqual({ kind: "shorter" });
    expect(pickSessionMessage([])).toBeNull();
  });

  it("asks for shorter sessions after three in a row left with fewer than half their cards done (PRD §10.8)", () => {
    expect(leftInARow([left(3), left(0, "replaced"), left(9)], defaults)).toBe(true);
    // Half done is not «fewer than half»; a finished one breaks the run; two are not three.
    expect(leftInARow([left(3), left(10), left(1)], defaults)).toBe(false);
    expect(leftInARow([left(3), left(20, "finished"), left(1)], defaults)).toBe(false);
    expect(leftInARow([left(3), left(1)], defaults)).toBe(false);
    expect(leftInARow([left(3), left(1)], settings({ "abandon.sessions": 2 }))).toBe(true);
  });

  it("asks again only after `abandon.cooldown_days`, one step shorter each time", () => {
    const asked = new Date("2026-10-01T10:00:00Z");
    expect(mayOfferShorter(null, asked, defaults)).toBe(true);
    expect(mayOfferShorter(asked, new Date("2026-10-31T09:59:00Z"), defaults)).toBe(false);
    expect(mayOfferShorter(asked, new Date("2026-10-31T10:00:00Z"), defaults)).toBe(true);
    const lengths = [10, 15, 20, 30];
    expect([30, 20, 15, 10].map((minutes) => shorterLength(minutes, lengths))).toEqual([20, 15, 10, null]);
  });
});

import { describe, expect, it } from "vitest";
import { isConnectionError } from "@/lib/report-error";
import { leftEarly } from "@/server/request-error";

describe("a dropped connection is not an error to fix", () => {
  it("knows each browser's words for a connection cut mid-way", () => {
    for (const message of ["Error in input stream", "Load failed", "network error", "Failed to fetch", "NetworkError when attempting to fetch resource.", "Connection closed."]) {
      expect(isConnectionError(new TypeError(message)), message).toBe(true);
    }
  });

  it("keeps real errors", () => {
    expect(isConnectionError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isConnectionError(new Error("Failed to fetch the words list"))).toBe(false);
  });

  it("on the server, a browser that left before the page was sent", () => {
    expect(leftEarly(new Error("The destination stream closed early."))).toBe(true);
    expect(leftEarly(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))).toBe(true);
    expect(leftEarly(new Error("relation \"word\" does not exist"))).toBe(false);
  });
});

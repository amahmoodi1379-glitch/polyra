import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { errorCode, errorSeed } from "@/lib/error-code";
import { logError } from "@/server/errors";
import { errorCounts, listErrors } from "@/server/errors-list";
import { resetDb, testDb } from "./db";

// The route reads who is asking from the request; here nobody is signed in and the address is fixed.
vi.mock("@/server/auth/session", () => ({ clientIp: async () => "10.9.9.9", getCurrentUser: async () => null }));

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const rows = () => testDb.errorLog.findMany({ orderBy: { ts: "asc" } });

describe("error_log (PRD §15.9)", () => {
  it("stores every repeat of an error under the same code", async () => {
    const first = await logError("action /admin/create", new Error("Word 12 not found"), { userId: 4 });
    const again = await logError("action /admin/create", new Error("Word 873 not found"));
    const other = await logError("action /admin/create", new Error("Batch is closed"));
    expect(first).toBe(errorCode(errorSeed("action /admin/create", "Word 12 not found")));
    expect(again).toBe(first);
    expect(other).not.toBe(first);
    const stored = await rows();
    expect(stored.map((row) => row.id.split("-")[0])).toEqual([first, first, other]);
    expect(stored[0]).toMatchObject({ id: first, where: "action /admin/create", message: "Word 12 not found", user_id: 4 });
    expect(stored[1].id).toMatch(new RegExp(`^${first}-[2-9A-Z]{4}$`));
    expect(stored[0].stack).toContain("Word 12 not found");
  });

  it("codes a server render error from its digest, the only thing the error screen knows", async () => {
    const code = await logError("render /admin/order", new Error("boom"), { requestId: "3028892782", seed: "3028892782" });
    expect(code).toBe(errorCode("3028892782"));
    expect((await rows())[0]).toMatchObject({ id: code, request_id: "3028892782" });
  });

  it("lists each error once with its count, newest first, and finds it by code, text or kind", async () => {
    await testDb.user.create({ data: { id: 4, phone: "+989120000004", session_length_min: 15 } });
    const repeated = await logError("action /admin/create", new Error("Word 1 not found"), { userId: 4 });
    await logError("action /admin/create", new Error("Word 2 not found"));
    const browser = await logError("browser /admin/audio", new Error("Cannot read properties of null (reading 'play')"), { userId: 4 });
    await logError("action /admin/create", new Error("Word 3 not found"), { userId: 4 });

    const all = await listErrors({});
    expect(all.items.map((item) => [item.code, item.kind, item.count, item.users])).toEqual([
      [repeated, "server", 3, 1],
      [browser, "browser", 1, 1],
    ]);
    expect(all.items[0]).toMatchObject({ message: "Word 3 not found", where: "action /admin/create", phone: "+989120000004" });
    expect(await errorCounts()).toEqual({ all: 2, server: 1, browser: 1 });

    expect((await listErrors({ kind: "browser" })).items.map((item) => item.code)).toEqual([browser]);
    expect((await listErrors({ q: browser.toLowerCase() })).items.map((item) => item.code)).toEqual([browser]);
    expect((await listErrors({ q: "not found" })).items.map((item) => item.code)).toEqual([repeated]);
    expect((await listErrors({ q: "100%" })).items).toEqual([]);
  });

  it("pages through many different errors", async () => {
    for (let index = 0; index < 23; index++) await logError(`route /api/x${String.fromCharCode(97 + index)}`, new Error("failed"));
    const second = await listErrors({ page: 2 });
    expect([second.total, second.pages, second.page, second.items.length]).toEqual([23, 2, 2, 3]);
    expect((await listErrors({ page: 9 })).page).toBe(2);
  });
});

describe("POST /api/errors: errors in the browser", () => {
  const post = async (body: string) => {
    const { POST } = await import("@/app/api/errors/route");
    return POST(new Request("http://localhost/api/errors", { method: "POST", body, headers: { "content-type": "application/json" } }));
  };

  it("stores the error and answers with its code", async () => {
    const response = await post(
      JSON.stringify({ message: "audio.duration is not a function", stack: "TypeError: audio.duration is not a function\n    at play", where: "/admin/audio" }),
    );
    const { code } = await response.json();
    expect(response.status).toBe(200);
    expect(code).toBe(errorCode(errorSeed("browser /admin/audio", "audio.duration is not a function")));
    expect((await rows())[0]).toMatchObject({ id: code, where: "browser /admin/audio", user_id: null });
  });

  it("refuses an empty or broken report, and too many from one address", async () => {
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify({ message: " " }))).status).toBe(400);
    expect((await post("x".repeat(30_000))).status).toBe(413);
    const statuses: number[] = [];
    for (let index = 0; index < 21; index++) statuses.push((await post(JSON.stringify({ message: `loop ${index}`, where: "/" }))).status);
    // One report came from the test above: the 20th of this address in ten minutes is the last let in.
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
    expect(await testDb.errorLog.count()).toBe(19);
  });
});

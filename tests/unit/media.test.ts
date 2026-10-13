import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { GET, HEAD } from "@/app/media/[...path]/route";
import { MEDIA_PREFIX, readMedia, saveMedia } from "@/server/storage";

const storage = mkdtempSync(join(tmpdir(), "polyra-media-"));
process.env.STORAGE_DIR = storage;
afterAll(() => rmSync(storage, { recursive: true, force: true }));

const bytes = Uint8Array.from({ length: 100 }, (_, index) => index);
const ask = (url: string, range?: string) => {
  const path = url.slice(MEDIA_PREFIX.length).split("/");
  return [new Request(`http://localhost${url}`, { headers: range ? { range } : {} }), { params: Promise.resolve({ path }) }] as const;
};

describe("stored files (PRD §13.8)", () => {
  it("saves a file under a new name and reads it back", async () => {
    const first = await saveMedia("audio", bytes, "mp3");
    const second = await saveMedia("audio", bytes, "mp3");
    expect(first).toMatch(/^\/media\/audio\/\d{4}-\d{2}\/[\w-]+\.mp3$/);
    expect(second).not.toBe(first);
    expect(await readMedia(first)).toEqual(bytes);
    expect(await readMedia("/elsewhere/a.mp3")).toBeNull();
  });

  it("serves a file whole, in a byte range, or not at all", async () => {
    const url = await saveMedia("audio", bytes, "mp3");

    const whole = await GET(...ask(url));
    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("audio/mpeg");
    expect(whole.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(bytes);

    const part = await GET(...ask(url, "bytes=10-19"));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 10-19/100");
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.slice(10, 20));

    const tail = await GET(...ask(url, "bytes=-5"));
    expect(new Uint8Array(await tail.arrayBuffer())).toEqual(bytes.slice(95));
    expect((await GET(...ask(url, "bytes=200-"))).status).toBe(416);

    const head = await HEAD(...ask(url));
    expect([head.status, head.headers.get("content-length"), await head.text()]).toEqual([200, "100", ""]);

    expect((await GET(...ask("/media/audio/../../etc/passwd"))).status).toBe(404);
    expect((await GET(...ask("/media/audio/none.mp3"))).status).toBe(404);
  });
});

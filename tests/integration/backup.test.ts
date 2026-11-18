import { createWriteStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { backupClient, backupStream } from "@/server/backup/file";
import { checkBackup, restoreBackup } from "@/server/backup/restore";
import { backupTables, quote } from "@/server/backup/tables";
import { resetDb, testDb } from "./db";

const storage = mkdtempSync(join(tmpdir(), "polyra-backup-"));
process.env.STORAGE_DIR = storage;
const files = mkdtempSync(join(tmpdir(), "polyra-backup-files-"));

beforeEach(async () => {
  await resetDb();
  rmSync(join(storage, "audio"), { recursive: true, force: true });
});
afterAll(async () => {
  await testDb.$disconnect();
  rmSync(storage, { recursive: true, force: true });
  rmSync(files, { recursive: true, force: true });
});

let counter = 0;
async function save(): Promise<string> {
  const file = join(files, `b${++counter}.polyra`);
  await pipeline(backupStream(), createWriteStream(file));
  return file;
}

/** Every row of every table as text, so two databases can be compared exactly. */
async function snapshot(): Promise<Record<string, string[]>> {
  const client = await backupClient();
  try {
    const out: Record<string, string[]> = {};
    for (const table of await backupTables(client)) {
      const rows = await client.query<{ row: string }>(`SELECT t::text AS row FROM ${quote(table.name)} t`);
      out[table.name] = rows.rows.map((row) => row.row).sort();
    }
    return out;
  } finally {
    await client.end();
  }
}

async function check(file: string) {
  const client = await backupClient();
  try {
    return await checkBackup(file, client);
  } finally {
    await client.end();
  }
}

async function content() {
  const admin = await testDb.user.create({ data: { phone: "+989120000001", session_length_min: 15, is_admin: true, admin_language: "fr" } });
  await testDb.user.create({ data: { phone: "+989120000009", session_length_min: 10 } });
  await testDb.language.createMany({ data: [{ code: "fr" }, { code: "de", coming_soon_fa: "به‌زودی" }] });
  const word = await testDb.word.create({
    data: { language: "fr", code: "maison", lemma: "maison", pos: "noun", gender: "f", level: "A1", meaning_fa: "خانه\tو «سرا»\nخط دوم", collocations: [{ text: "à la maison", translation_fa: "در خانه" }] },
  });
  await testDb.word.create({ data: { language: "fr", code: "chat", lemma: "chat", pos: "noun", gender: "m", level: "A1", meaning_fa: "گربه", parts: [], homophones: ["chas"] } });
  const sentence = await testDb.sentence.create({ data: { language: "fr", text: "C'est la maison.", translation_fa: "این خانه است.", text_hash: "h1", level: "A1" } });
  await testDb.sentenceWord.create({ data: { sentence_id: sentence.id, position: 2, surface: "maison", kind: "word", word_id: word.id, spans: [[9, 15]] } });
  // A JSON value that is the word null, next to columns that are empty.
  await testDb.$executeRawUnsafe(
    `INSERT INTO engine_setting (key, value, default_value, description_fa, updated_at) VALUES ('fsrs.weights', 'null'::jsonb, '[1, 2.5]'::jsonb, 'وزن‌ها', now())`,
  );
  await testDb.appSetting.create({ data: { key: "levels.fr", value: ["A1", "A2"] } });
  await testDb.event.create({ data: { name: "session_end", user_id: admin.id, props: { n: 1.25, big: 12345678901234 } } });
  mkdirSync(join(storage, "audio", "2026-11"), { recursive: true });
  writeFileSync(join(storage, "audio", "2026-11", "a.mp3"), Buffer.from([1, 2, 3, 250, 0, 9]));
  return { admin, word };
}

describe("full backup (moving to another server)", () => {
  it("puts every row and file back exactly, and ids go on after the largest", async () => {
    const { admin } = await content();
    const before = await snapshot();
    const file = await save();

    const checked = await check(file);
    expect(checked.ok).toBe(true);
    if (!checked.ok) return;
    expect(checked.summary.tables).toMatchObject({ word: 2, sentence: 1, user: 2, engine_setting: 1, sentence_word: 1 });
    expect(checked.summary.files).toBe(1);

    // The new server: other content, another admin signed in, no audio yet.
    await resetDb();
    rmSync(join(storage, "audio"), { recursive: true, force: true });
    await testDb.word.create({ data: { language: "de", code: "Haus", lemma: "Haus", pos: "noun", gender: "das", level: "A1", meaning_fa: "خانه" } });
    const result = await restoreBackup(file, { keep: { phone: admin.phone!, refreshTokenHash: "hash-of-this-device", userAgent: "test" } });
    expect(result.files).toBe(1);
    expect(result.keptSession).toBe(true);

    const after = await snapshot();
    const device = after.auth_device;
    expect(device).toHaveLength(1);
    expect({ ...after, auth_device: [] }).toEqual({ ...before, auth_device: [] });
    expect(readFileSync(join(storage, "audio", "2026-11", "a.mp3"))).toEqual(Buffer.from([1, 2, 3, 250, 0, 9]));
    expect((await testDb.engineSetting.findUniqueOrThrow({ where: { key: "fsrs.weights" } })).value).toBeNull();

    const next = await testDb.word.create({ data: { language: "fr", code: "chien", lemma: "chien", pos: "noun", gender: "m", level: "A1", meaning_fa: "سگ" } });
    expect(next.id).toBeGreaterThan(Math.max(...(await testDb.word.findMany()).filter((row) => row.id !== next.id).map((row) => row.id)));
  });

  it("refuses a file that is not a backup, is cut short, or comes from another version, and changes nothing", async () => {
    await content();
    const file = await save();
    const whole = gunzipSync(readFileSync(file)).toString("utf8");

    const plain = join(files, "plain.polyra");
    writeFileSync(plain, "hello");
    expect(await check(plain)).toMatchObject({ ok: false, reason: "notBackup" });

    const other = join(files, "other.polyra");
    writeFileSync(other, gzipSync("something else\n"));
    expect(await check(other)).toMatchObject({ ok: false, reason: "notBackup" });

    const cut = join(files, "cut.polyra");
    writeFileSync(cut, readFileSync(file).subarray(0, Math.floor(readFileSync(file).length / 2)));
    expect(await check(cut)).toMatchObject({ ok: false, reason: "incomplete" });

    const noEnd = join(files, "noend.polyra");
    writeFileSync(noEnd, gzipSync(whole.split("\n").filter((line) => !line.startsWith("E\t")).join("\n")));
    expect(await check(noEnd)).toMatchObject({ ok: false, reason: "incomplete" });

    const lost = join(files, "lost.polyra");
    const lines = whole.split("\n");
    lines.splice(lines.findIndex((line) => line.startsWith("T\tword\t")), 1);
    writeFileSync(lost, gzipSync(lines.join("\n")));
    expect(await check(lost)).toMatchObject({ ok: false, reason: "incomplete" });

    const newer = join(files, "newer.polyra");
    writeFileSync(newer, gzipSync(whole.replace('"migrations":[', '"migrations":["29990101000000_future",')));
    expect(await check(newer)).toMatchObject({ ok: false, reason: "newerBackup" });

    const older = join(files, "older.polyra");
    writeFileSync(older, gzipSync(whole.replace(/"migrations":\["[^"]+",/, '"migrations":[')));
    expect(await check(older)).toMatchObject({ ok: false, reason: "olderBackup" });

    const unsafe = join(files, "unsafe.polyra");
    writeFileSync(unsafe, gzipSync(whole.replace("F\taudio/2026-11/a.mp3", "F\taudio/../../etc/x")));
    expect(await check(unsafe)).toMatchObject({ ok: false, reason: "broken" });

    const before = await snapshot();
    await expect(restoreBackup(cut)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });

  it("rolls everything back when one row cannot go in", async () => {
    await content();
    const file = await save();
    const broken = join(files, "badrow.polyra");
    const whole = gunzipSync(readFileSync(file)).toString("utf8");
    // Same counts, but a word whose required column is empty.
    writeFileSync(broken, gzipSync(whole.replace(/("code": )"chat"/, "$1null")));
    await resetDb();
    await testDb.language.create({ data: { code: "fr" } });
    const before = await snapshot();
    await expect(restoreBackup(broken)).rejects.toThrow();
    expect(await snapshot()).toEqual(before);
  });
});

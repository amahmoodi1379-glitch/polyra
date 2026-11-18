import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { createGunzip, createGzip } from "node:zlib";
import { Client } from "pg";
import { mediaFolders, storageRoot } from "@/server/storage";
import { appliedMigrations, backupTables, quote, rowSelect } from "./tables";

/**
 * A full backup (moving the app to another server, DECISIONS.md): one gzip file of text lines that holds
 * every row of every table and every stored audio file.
 *
 *   polyra-backup 1                     the first line, so any other file is refused
 *   H <tab> {created_at, migrations, tables}
 *   T <tab> table <tab> row as JSON     one line per row, tables parents first
 *   F <tab> audio/2026-11/x.mp3 <tab> base64
 *   E <tab> {tables: {name: rows}, files, bytes}   the last line: a file cut short has none
 *
 * Rows are written by PostgreSQL itself (`to_jsonb`) and read back by it (`jsonb_to_recordset` with each
 * column's own type), so every value comes back exactly as it was; the app never parses them.
 */

export const BACKUP_MAGIC = "polyra-backup 1";
export const BACKUP_EXTENSION = ".polyra";
const ROWS_PER_FETCH = 500;

export type BackupHeader = { created_at: string; migrations: string[]; tables: string[] };
export type BackupEnd = { tables: Record<string, number>; files: number; bytes: number };

/** A database connection of its own, so long reads never hold one of the app's. */
export async function backupClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  const client = new Client({ connectionString });
  await client.connect();
  await client.query("SET statement_timeout = 0");
  return client;
}

/** Every stored file under the media folders, as paths relative to the storage folder. */
async function* mediaFiles(root: string): AsyncGenerator<string> {
  async function* walk(relative: string): AsyncGenerator<string> {
    let entries;
    try {
      entries = await readdir(path.join(root, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const inner = `${relative}/${entry.name}`;
      if (entry.isDirectory()) yield* walk(inner);
      else if (entry.isFile()) yield inner;
    }
  }
  for (const folder of mediaFolders) yield* walk(folder);
}

/** The lines of a full backup of this database and storage folder, read in one consistent snapshot. */
export async function* backupLines(now = new Date()): AsyncGenerator<string> {
  const client = await backupClient();
  try {
    yield `${BACKUP_MAGIC}\n`;
    const counts: Record<string, number> = {};
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const tables = await backupTables(client);
      const header: BackupHeader = { created_at: now.toISOString(), migrations: await appliedMigrations(client), tables: tables.map((table) => table.name) };
      yield `H\t${JSON.stringify(header)}\n`;
      for (const table of tables) {
        await client.query(`DECLARE backup_rows NO SCROLL CURSOR FOR SELECT ${rowSelect(table)} AS row FROM ${quote(table.name)} t`);
        let count = 0;
        for (;;) {
          const batch = await client.query<{ row: string }>(`FETCH ${ROWS_PER_FETCH} FROM backup_rows`);
          if (batch.rows.length === 0) break;
          count += batch.rows.length;
          yield batch.rows.map((row) => `T\t${table.name}\t${row.row}\n`).join("");
        }
        await client.query("CLOSE backup_rows");
        counts[table.name] = count;
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    const root = storageRoot();
    let files = 0;
    let bytes = 0;
    for await (const relative of mediaFiles(root)) {
      const data = await readFile(path.join(root, relative));
      files += 1;
      bytes += data.length;
      yield `F\t${relative}\t${data.toString("base64")}\n`;
    }
    const end: BackupEnd = { tables: counts, files, bytes };
    yield `E\t${JSON.stringify(end)}\n`;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** The backup as a gzip stream, for a download or a file on disk. */
export function backupStream(now = new Date()) {
  return Readable.from(backupLines(now)).pipe(createGzip());
}

export const backupName = (now: Date, kind: "full" | "before-restore" = "full") =>
  `polyra-${kind === "full" ? "backup" : "before-restore"}-${now.toISOString().slice(0, 19).replace(/[T:]/g, "-")}${BACKUP_EXTENSION}`;

/** The lines of a backup file on disk, one by one; throws when the file is not gzip or is cut short. */
export async function* readBackupLines(file: string): AsyncGenerator<string> {
  const input = createReadStream(file);
  const gunzip = createGunzip();
  input.on("error", (error) => gunzip.destroy(error));
  input.pipe(gunzip);
  const decoder = new StringDecoder("utf8");
  let rest = "";
  for await (const chunk of gunzip) {
    const lines = (rest + decoder.write(chunk as Buffer)).split("\n");
    rest = lines.pop() ?? "";
    yield* lines;
  }
  rest += decoder.end();
  if (rest) yield rest;
}

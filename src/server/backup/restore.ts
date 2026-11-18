import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ClientBase } from "pg";
import { mediaFolders, storageRoot } from "@/server/storage";
import { BACKUP_MAGIC, backupClient, readBackupLines, type BackupEnd, type BackupHeader } from "./file";
import { appliedMigrations, backupTables, quote, rowInsert, type BackupTable } from "./tables";

/**
 * Putting a full backup back (src/server/backup/file.ts): first the whole file is checked without
 * touching anything, then, in one database transaction, every table is emptied and filled from the file.
 * If anything fails, the transaction is rolled back and the server stays exactly as it was.
 */

export type BackupProblem =
  | { reason: "notBackup" }
  | { reason: "incomplete" }
  | { reason: "broken"; line: number }
  /** The backup was made by a newer version of the app than this server runs. */
  | { reason: "newerBackup" }
  /** The backup was made by an older version; the old server needs the latest version first. */
  | { reason: "olderBackup" };

export type BackupSummary = {
  created_at: string;
  tables: Record<string, number>;
  files: number;
  bytes: number;
};

export type CheckResult = { ok: true; summary: BackupSummary } | ({ ok: false } & BackupProblem);

const ROWS_PER_INSERT = 1000;
const CHARS_PER_INSERT = 4_000_000;
const SAFE_PATH = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/;

/** A stored file's path from a backup, if it is one this app would have written (no "..", a media folder). */
export function safeMediaPath(relative: string): string | null {
  if (!SAFE_PATH.test(relative)) return null;
  const [folder] = relative.split("/");
  return (mediaFolders as readonly string[]).includes(folder) ? relative : null;
}

/** Splits a line at its first tabs: `T\tword\t{...}` → ["T", "word", "{...}"]. */
function fields(line: string, count: number): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let index = 0; index < count - 1; index++) {
    const tab = line.indexOf("\t", start);
    if (tab < 0) return [];
    parts.push(line.slice(start, tab));
    start = tab + 1;
  }
  parts.push(line.slice(start));
  return parts;
}

function compareMigrations(backup: string[], here: string[]): BackupProblem | null {
  if (backup.length === here.length && backup.every((name, index) => name === here[index])) return null;
  const mine = new Set(here);
  return backup.some((name) => !mine.has(name)) ? { reason: "newerBackup" } : { reason: "olderBackup" };
}

/** Reads the whole file and says what it holds, or why it cannot be put back on this server. */
export async function checkBackup(file: string, client: ClientBase): Promise<CheckResult> {
  let header: BackupHeader | null = null;
  let end: BackupEnd | null = null;
  const seen: Record<string, number> = {};
  let files = 0;
  let lineNo = 0;
  try {
    for await (const line of readBackupLines(file)) {
      lineNo += 1;
      if (lineNo === 1) {
        if (line !== BACKUP_MAGIC) return { ok: false, reason: "notBackup" };
        continue;
      }
      if (end) return { ok: false, reason: "broken", line: lineNo };
      const kind = line.slice(0, 2);
      if (kind === "H\t" && !header && lineNo === 2) {
        header = JSON.parse(line.slice(2)) as BackupHeader;
        if (!Array.isArray(header.migrations) || !Array.isArray(header.tables)) return { ok: false, reason: "broken", line: lineNo };
      } else if (kind === "T\t" && header) {
        const [, table, row] = fields(line, 3);
        if (!table || !header.tables.includes(table) || !row?.startsWith("{")) return { ok: false, reason: "broken", line: lineNo };
        seen[table] = (seen[table] ?? 0) + 1;
      } else if (kind === "F\t" && header) {
        const [, relative, data] = fields(line, 3);
        if (!relative || !safeMediaPath(relative) || data === undefined) return { ok: false, reason: "broken", line: lineNo };
        files += 1;
      } else if (kind === "E\t" && header) {
        end = JSON.parse(line.slice(2)) as BackupEnd;
      } else if (line !== "" || !header) {
        return { ok: false, reason: "broken", line: lineNo };
      }
    }
  } catch {
    return lineNo === 0 ? { ok: false, reason: "notBackup" } : { ok: false, reason: end ? "broken" : "incomplete", line: lineNo };
  }
  if (lineNo === 0) return { ok: false, reason: "notBackup" };
  if (!header || !end) return { ok: false, reason: "incomplete" };
  const counted = Object.entries(end.tables).every(([table, count]) => (seen[table] ?? 0) === count);
  if (!counted || Object.keys(seen).some((table) => !(table in end!.tables)) || end.files !== files) return { ok: false, reason: "incomplete" };

  const problem = compareMigrations(header.migrations, await appliedMigrations(client));
  if (problem) return { ok: false, ...problem };
  const here = new Set((await backupTables(client)).map((table) => table.name));
  if (header.tables.length !== here.size || header.tables.some((table) => !here.has(table))) return { ok: false, reason: "olderBackup" };
  return { ok: true, summary: { created_at: header.created_at, tables: end.tables, files: end.files, bytes: end.bytes } };
}

/** The admin who restores, so they stay signed in on this device afterwards (if the backup has them as admin). */
export type KeepSession = { phone: string; refreshTokenHash: string; userAgent: string | null };

export type RestoreResult = { rows: number; files: number; keptSession: boolean };

/**
 * Empties every table and fills it from the file, in one transaction, then sets each id counter past the
 * largest id. Stored files are written next to the ones already there. Call `checkBackup` first.
 */
export async function restoreBackup(file: string, options: { keep?: KeepSession | null; onProgress?: (rows: number) => void } = {}): Promise<RestoreResult> {
  const client = await backupClient();
  const root = storageRoot();
  let rows = 0;
  let files = 0;
  let keptSession = false;
  try {
    const check = await checkBackup(file, client);
    if (!check.ok) throw new Error(`Backup refused: ${check.reason}`);
    const tables = await backupTables(client);

    await client.query("BEGIN");
    try {
      await client.query(`TRUNCATE ${tables.map((table) => quote(table.name)).join(", ")} RESTART IDENTITY CASCADE`);
      const byName = new Map<string, BackupTable>(tables.map((table) => [table.name, table]));
      let current = null as BackupTable | null;
      let pending: string[] = [];
      let chars = 0;
      const flush = async () => {
        if (!current || pending.length === 0) return;
        await client.query(rowInsert(current), [`[${pending.join(",")}]`]);
        rows += pending.length;
        options.onProgress?.(rows);
        pending = [];
        chars = 0;
      };

      for await (const line of readBackupLines(file)) {
        if (line.startsWith("T\t")) {
          const [, table, row] = fields(line, 3);
          if (table !== current?.name) {
            await flush();
            current = byName.get(table) ?? null;
            if (!current) throw new Error(`Unknown table in backup: ${table}`);
          }
          pending.push(row);
          chars += row.length;
          if (pending.length >= ROWS_PER_INSERT || chars >= CHARS_PER_INSERT) await flush();
        } else if (line.startsWith("F\t")) {
          await flush();
          const [, relative, data] = fields(line, 3);
          const safe = safeMediaPath(relative);
          if (!safe) throw new Error(`Unsafe file path in backup: ${relative}`);
          const target = path.join(root, ...safe.split("/"));
          await mkdir(path.dirname(target), { recursive: true });
          await writeFile(target, Buffer.from(data, "base64"));
          files += 1;
        }
      }
      await flush();

      // Every count must match the file before anything is kept.
      for (const [table, count] of Object.entries(check.summary.tables)) {
        const found = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${quote(table)}`);
        if (Number(found.rows[0].n) !== count) throw new Error(`Table ${table}: ${found.rows[0].n} rows after restore, ${count} in the backup`);
      }
      for (const table of tables) {
        for (const column of table.serials) {
          await client.query(
            `SELECT setval(pg_get_serial_sequence($1, $2), COALESCE((SELECT MAX(${quote(column)}) FROM ${quote(table.name)}), 0) + 1, false)`,
            [`public.${quote(table.name)}`, column],
          );
        }
      }

      if (options.keep) {
        const user = await client.query<{ id: number }>(`SELECT id FROM "user" WHERE phone = $1 AND is_admin AND deleted_at IS NULL`, [options.keep.phone]);
        if (user.rows[0]) {
          await client.query(
            `INSERT INTO auth_device (user_id, refresh_token_hash, user_agent) VALUES ($1, $2, $3) ON CONFLICT (refresh_token_hash) DO NOTHING`,
            [user.rows[0].id, options.keep.refreshTokenHash, options.keep.userAgent],
          );
          keptSession = true;
        }
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
    return { rows, files, keptSession };
  } finally {
    await client.end().catch(() => undefined);
  }
}

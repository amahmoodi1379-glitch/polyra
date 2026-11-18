import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { logError } from "@/server/errors";
import { storageRoot } from "@/server/storage";
import { BACKUP_EXTENSION, backupClient, backupName, backupStream } from "./file";
import { checkBackup, restoreBackup, type BackupSummary, type CheckResult, type KeepSession } from "./restore";

/**
 * The panel's side of a full restore: the browser sends the file in small pieces (so no proxy limit on
 * one request gets in the way), the server checks it, and on the admin's word puts it back in the
 * background while the page asks how far it got. Before anything is replaced, this server's own data
 * is saved as a backup in `backups/`, so a restore on the wrong server can be undone.
 */

export const CHUNK_BYTES = 512 * 1024;
export const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
const UPLOAD_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const uploadsDir = () => path.join(storageRoot(), ".restore");
export const backupsDir = () => path.join(storageRoot(), "backups");
const uploadFile = (id: string) => path.join(uploadsDir(), `${id}.upload`);

type Upload = { adminId: number; size: number; received: number; next: number; checked: BackupSummary | null };
type Job = {
  token: string;
  state: "saving" | "restoring" | "done" | "failed";
  rows: number;
  totalRows: number;
  /** The backup of this server made just before, its file name in `backups/`. */
  saved: string | null;
  code: string | null;
  keptSession: boolean;
};

const memory = globalThis as unknown as { polyraUploads?: Map<string, Upload>; polyraJob?: Job | null };
const uploads = (memory.polyraUploads ??= new Map<string, Upload>());

const newId = () => randomBytes(18).toString("base64url");
const validId = (id: string) => /^[A-Za-z0-9_-]{24}$/.test(id);

/** Old pieces of uploads that never finished are removed now and then. */
async function sweep() {
  const dir = uploadsDir();
  const entries = await readdir(dir).catch(() => [] as string[]);
  const now = Date.now();
  for (const name of entries) {
    const file = path.join(dir, name);
    const info = await stat(file).catch(() => null);
    if (info && now - info.mtimeMs > UPLOAD_MAX_AGE_MS) await rm(file, { force: true });
  }
}

export async function beginUpload(adminId: number, size: number): Promise<{ id: string } | { error: "size" | "busy" }> {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_UPLOAD_BYTES) return { error: "size" };
  if (memory.polyraJob && (memory.polyraJob.state === "saving" || memory.polyraJob.state === "restoring")) return { error: "busy" };
  await mkdir(uploadsDir(), { recursive: true });
  await sweep();
  const id = newId();
  await rm(uploadFile(id), { force: true });
  uploads.set(id, { adminId, size, received: 0, next: 0, checked: null });
  return { id };
}

/** One piece, in order. A piece sent twice (the answer was lost) is accepted without writing it again. */
export async function addChunk(id: string, adminId: number, index: number, bytes: Uint8Array): Promise<"ok" | "gone" | "order" | "size"> {
  const upload = validId(id) ? uploads.get(id) : undefined;
  if (!upload || upload.adminId !== adminId) return "gone";
  if (index === upload.next - 1) return "ok";
  if (index !== upload.next) return "order";
  if (bytes.length === 0 || bytes.length > CHUNK_BYTES || upload.received + bytes.length > upload.size) return "size";
  await appendFile(uploadFile(id), bytes);
  upload.received += bytes.length;
  upload.next += 1;
  return "ok";
}

/** After the last piece: reads the whole file and says what it holds. */
export async function checkUpload(id: string, adminId: number): Promise<CheckResult | { ok: false; reason: "gone" | "partial" }> {
  const upload = validId(id) ? uploads.get(id) : undefined;
  if (!upload || upload.adminId !== adminId) return { ok: false, reason: "gone" };
  if (upload.received !== upload.size) return { ok: false, reason: "partial" };
  const client = await backupClient();
  try {
    const result = await checkBackup(uploadFile(id), client);
    upload.checked = result.ok ? result.summary : null;
    return result;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** Saves this server's current data to `backups/` and returns the file name. */
export async function saveBackupFile(kind: "full" | "before-restore", now = new Date()): Promise<string> {
  await mkdir(backupsDir(), { recursive: true });
  const name = backupName(now, kind);
  await pipeline(backupStream(now), createWriteStream(path.join(backupsDir(), name), { flags: "wx" }));
  return name;
}

/** The backups kept on this server, newest first. */
export async function savedBackups(): Promise<{ name: string; bytes: number; at: Date }[]> {
  const names = (await readdir(backupsDir()).catch(() => [] as string[])).filter((name) => name.endsWith(BACKUP_EXTENSION));
  const rows = await Promise.all(
    names.map(async (name) => {
      const info = await stat(path.join(backupsDir(), name));
      return { name, bytes: info.size, at: info.mtime };
    }),
  );
  return rows.sort((a, b) => b.at.getTime() - a.at.getTime());
}

/** A saved backup's full path, only for a plain name inside `backups/`. */
export function savedBackupFile(name: string): string | null {
  if (!/^polyra-[a-z-]+-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.polyra$/.test(name)) return null;
  return path.join(backupsDir(), name);
}

/** Starts putting the checked upload back; returns the token the page asks with. */
export function startRestore(id: string, adminId: number, keep: KeepSession | null): { token: string } | { error: "gone" | "busy" } {
  const upload = validId(id) ? uploads.get(id) : undefined;
  if (!upload || upload.adminId !== adminId || !upload.checked) return { error: "gone" };
  const running = memory.polyraJob;
  if (running && (running.state === "saving" || running.state === "restoring")) return { error: "busy" };
  const totalRows = Object.values(upload.checked.tables).reduce((sum, count) => sum + count, 0);
  const job: Job = { token: newId(), state: "saving", rows: 0, totalRows, saved: null, code: null, keptSession: false };
  memory.polyraJob = job;
  uploads.delete(id);

  void (async () => {
    const file = uploadFile(id);
    try {
      job.saved = await saveBackupFile("before-restore");
      job.state = "restoring";
      const result = await restoreBackup(file, { keep, onProgress: (rows) => (job.rows = rows) });
      job.rows = result.rows;
      job.keptSession = result.keptSession;
      job.state = "done";
    } catch (error) {
      job.code = await logError("backup.restore", error, { userId: adminId }).catch(() => null);
      job.state = "failed";
    } finally {
      await rm(file, { force: true });
    }
  })();
  return { token: job.token };
}

export function restoreStatus(token: string): Omit<Job, "token"> | null {
  const job = memory.polyraJob;
  if (!job || !validId(token) || job.token !== token) return null;
  return { state: job.state, rows: job.rows, totalRows: job.totalRows, saved: job.saved, code: job.code, keptSession: job.keptSession };
}

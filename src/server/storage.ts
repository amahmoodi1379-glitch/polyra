import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Uploaded files (PRD §13.8: audio) live on the server's disk under STORAGE_DIR; on the host that
 * folder is a mounted disk (docs/deploy-runflare.md). Every file gets a new name and is never
 * written over, so the app can tell browsers to keep it for good. `/media/...` serves them.
 */

export const MEDIA_PREFIX = "/media/";
const root = () => path.resolve(process.env.STORAGE_DIR ?? "./storage");

const types: Record<string, string> = { mp3: "audio/mpeg" };
export const mediaType = (file: string) => types[path.extname(file).slice(1).toLowerCase()] ?? "application/octet-stream";

/** Stores bytes under a fresh name in a folder of the month and returns the address the app plays it from. */
export async function saveMedia(folder: "audio", bytes: Uint8Array, extension: "mp3"): Promise<string> {
  const now = new Date();
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const name = `${randomBytes(12).toString("base64url")}.${extension}`;
  const directory = path.join(root(), folder, month);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), bytes, { flag: "wx" });
  return `${MEDIA_PREFIX}${folder}/${month}/${name}`;
}

/** The file behind a `/media/...` address, or null when the address points anywhere else. */
export function mediaFile(parts: string[]): string | null {
  if (parts.length === 0 || parts.some((part) => part === "" || part === "." || part === ".." || part.includes("\\") || part.includes("\0"))) return null;
  const base = root();
  const file = path.resolve(base, ...parts);
  return file.startsWith(base + path.sep) ? file : null;
}

export async function mediaSize(file: string) {
  try {
    const info = await stat(file);
    return info.isFile() ? info.size : null;
  } catch {
    return null;
  }
}

/** Bytes `start` to `end` (inclusive) of a file. */
export async function readMediaRange(file: string, start: number, end: number) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(end - start + 1);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer;
  } finally {
    await handle.close();
  }
}

/** The whole of a stored file, by the address `saveMedia` gave; null if it is not there. */
export async function readMedia(url: string): Promise<Uint8Array | null> {
  if (!url.startsWith(MEDIA_PREFIX)) return null;
  const file = mediaFile(url.slice(MEDIA_PREFIX.length).split("/"));
  if (!file) return null;
  try {
    return new Uint8Array(await readFile(file));
  } catch {
    return null;
  }
}

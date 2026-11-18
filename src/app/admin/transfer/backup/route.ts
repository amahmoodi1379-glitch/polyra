import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getCurrentUser } from "@/server/auth/session";
import { backupName, backupStream } from "@/server/backup/file";
import { savedBackupFile } from "@/server/backup/jobs";
import { logError } from "@/server/errors";

export const dynamic = "force-dynamic";

const headers = (name: string, size?: number) => ({
  "content-type": "application/gzip",
  "content-disposition": `attachment; filename="${name}"`,
  "cache-control": "no-store",
  ...(size !== undefined ? { "content-length": String(size) } : {}),
});

/**
 * «پشتیبان کامل»: every table and every audio file in one file, for moving to another server
 * (src/server/backup/file.ts). `?saved=name` downloads a backup kept on this server instead.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.is_admin) return new Response(null, { status: 401 });

  const saved = new URL(request.url).searchParams.get("saved");
  if (saved !== null) {
    const file = savedBackupFile(saved);
    const info = file ? await stat(file).catch(() => null) : null;
    if (!file || !info?.isFile()) return new Response(null, { status: 404 });
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: headers(saved, info.size) });
  }

  const now = new Date();
  const stream = backupStream(now);
  stream.on("error", (error) => void logError("backup.download", error, { userId: user.id }));
  return new Response(Readable.toWeb(stream) as ReadableStream, { headers: headers(backupName(now)) });
}

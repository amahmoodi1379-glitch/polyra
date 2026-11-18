import { getCurrentDevice } from "@/server/auth/session";
import { addChunk, beginUpload, checkUpload, CHUNK_BYTES, restoreStatus, startRestore } from "@/server/backup/jobs";
import { db } from "@/server/db";
import { logError } from "@/server/errors";

export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function admin() {
  const current = await getCurrentDevice();
  return current?.user.is_admin ? current : null;
}

/**
 * «بازگرداندن پشتیبان کامل» (src/server/backup/jobs.ts). POST {action: begin | check | start}, PUT one
 * piece of the file (?id=…&index=…, the bytes as the body), GET ?job=… how far the restore got. The
 * status needs only the job's token: after a restore this browser may no longer be signed in.
 */
export async function POST(request: Request) {
  const current = await admin();
  if (!current) return json({ error: "auth" }, 401);
  const body = (await request.json().catch(() => null)) as { action?: string; size?: number; id?: string; confirm?: boolean } | null;
  try {
    switch (body?.action) {
      case "begin":
        return json({ ...(await beginUpload(current.user.id, Number(body.size))), chunk: CHUNK_BYTES });
      case "check":
        return json(await checkUpload(String(body.id ?? ""), current.user.id));
      case "start": {
        if (body.confirm !== true) return json({ error: "confirm" }, 400);
        const device = await db.authDevice.findUnique({ where: { id: current.deviceId } });
        const keep = device && current.user.phone ? { phone: current.user.phone, refreshTokenHash: device.refresh_token_hash, userAgent: device.user_agent } : null;
        return json(startRestore(String(body.id ?? ""), current.user.id, keep));
      }
      default:
        return json({ error: "action" }, 400);
    }
  } catch (error) {
    const code = await logError("backup.restoreRequest", error, { userId: current.user.id });
    return json({ error: "failed", code }, 500);
  }
}

export async function PUT(request: Request) {
  const current = await admin();
  if (!current) return json({ error: "auth" }, 401);
  const query = new URL(request.url).searchParams;
  const index = Number(query.get("index"));
  if (!Number.isSafeInteger(index) || index < 0) return json({ error: "order" }, 400);
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const result = await addChunk(query.get("id") ?? "", current.user.id, index, bytes);
    return json({ result }, result === "ok" ? 200 : 409);
  } catch (error) {
    const code = await logError("backup.upload", error, { userId: current.user.id });
    return json({ error: "failed", code }, 500);
  }
}

export async function GET(request: Request) {
  const status = restoreStatus(new URL(request.url).searchParams.get("job") ?? "");
  return status ? json(status) : json({ error: "gone" }, 404);
}

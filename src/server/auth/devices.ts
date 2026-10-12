import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Signed-in devices (PRD §15.5). The browser keeps a random token in an HttpOnly cookie; the
 * database keeps only its hash. A third sign-in removes the least recently used device.
 */

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createDevice(
  { db, now }: { db: PrismaClient; now: Date },
  input: { userId: number; userAgent: string | null; maxDevices: number },
) {
  const token = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    await tx.authDevice.create({
      data: {
        user_id: input.userId,
        refresh_token_hash: hashToken(token),
        user_agent: input.userAgent?.slice(0, 400) ?? null,
        last_seen_at: now,
        created_at: now,
      },
    });
    const devices = await tx.authDevice.findMany({
      where: { user_id: input.userId },
      orderBy: [{ last_seen_at: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    const extra = devices.slice(Math.max(1, input.maxDevices)).map((device) => device.id);
    if (extra.length) await tx.authDevice.deleteMany({ where: { id: { in: extra } } });
  });
  return token;
}

/** The signed-in user for a cookie token, or null. Refreshes last_seen_at at most every 5 minutes. */
export async function findUserByToken({ db, now }: { db: PrismaClient; now: Date }, token: string) {
  const device = await db.authDevice.findUnique({
    where: { refresh_token_hash: hashToken(token) },
    include: { user: true },
  });
  if (!device || device.user.deleted_at) return null;
  if (now.getTime() - device.last_seen_at.getTime() > 5 * 60_000) {
    await db.authDevice.update({ where: { id: device.id }, data: { last_seen_at: now } });
  }
  return { user: device.user, deviceId: device.id };
}

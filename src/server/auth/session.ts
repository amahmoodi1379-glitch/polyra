import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/server/db";
import { engineNumber } from "@/server/settings/read";
import { createDevice, findUserByToken, hashToken } from "./devices";

/** Session cookie (PRD §15.5): HttpOnly and Secure, kept for a year and renewed on every sign-in. */
export const SESSION_COOKIE = "polyra_session";
const SESSION_MAX_AGE_SEC = 365 * 24 * 60 * 60;

export async function clientIp(): Promise<string> {
  const list = await headers();
  const forwarded = list.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || list.get("x-real-ip") || "unknown";
}

/** Signs the user in on this device and sets the cookie. Call only from a Server Action. */
export async function startSession(userId: number) {
  const list = await headers();
  const token = await createDevice(
    { db, now: new Date() },
    { userId, userAgent: list.get("user-agent"), maxDevices: await engineNumber("device.max") },
  );
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SEC,
  });
}

/** The signed-in user, or null. Cached for the duration of one request. */
export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const found = await findUserByToken({ db, now: new Date() }, token);
  return found?.user ?? null;
});

/** Signs this device out. Call only from a Server Action. */
export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.authDevice.deleteMany({ where: { refresh_token_hash: hashToken(token) } });
  store.delete(SESSION_COOKIE);
}

/** For admin pages: the signed-in admin, or a redirect to the login page. */
export async function requireAdmin(nextPath = "/admin") {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if (!user.is_admin) redirect("/no-access");
  return user;
}

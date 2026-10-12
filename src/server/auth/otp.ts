import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import type { OtpPurpose, PrismaClient } from "@/generated/prisma/client";
import type { SmsProvider } from "@/server/sms/provider";

/**
 * SMS login codes (PRD §15.5): 5 digits, valid 2 minutes; at most 3 requests per 10 minutes per
 * phone and 10 per hour per IP; after 5 wrong codes the phone is locked for 10 minutes.
 * These are security limits from the PRD, not engine numbers, so they live here.
 */
export const OTP_RULES = {
  length: 5,
  ttlSec: 120,
  phoneWindowSec: 600,
  phoneMaxRequests: 3,
  ipWindowSec: 3600,
  ipMaxRequests: 10,
  maxWrong: 5,
  lockSec: 600,
} as const;

export type RequestOtpResult =
  | { ok: true; expiresAt: Date; testCode: string | null }
  | { ok: false; reason: "phone_limit" | "ip_limit" | "locked"; retryAfterSec: number };

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; reason: "wrong"; attemptsLeft: number }
  | { ok: false; reason: "expired" | "locked" | "none" };

type OtpDeps = { db: PrismaClient; now: Date; secret: string };

function hashCode(secret: string, phone: string, code: string) {
  return createHmac("sha256", secret).update(`${phone}:${code}`).digest("hex");
}

function sameHash(a: string, b: string) {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

const secondsAgo = (now: Date, seconds: number) => new Date(now.getTime() - seconds * 1000);

/** Wrong answers for this phone within the lock window, and when the oldest of them falls out. */
async function lockState({ db, now }: OtpDeps, phone: string) {
  const recent = await db.otpCode.findMany({
    where: { phone, created_at: { gt: secondsAgo(now, OTP_RULES.lockSec) }, attempts: { gt: 0 } },
    select: { attempts: true, created_at: true },
    orderBy: { created_at: "asc" },
  });
  const wrong = recent.reduce((sum, row) => sum + row.attempts, 0);
  if (wrong < OTP_RULES.maxWrong) return null;
  const freeAt = recent[0].created_at.getTime() + OTP_RULES.lockSec * 1000;
  return Math.max(1, Math.ceil((freeAt - now.getTime()) / 1000));
}

export async function requestOtp(
  deps: OtpDeps & { sms: SmsProvider },
  input: { phone: string; ip: string; purpose: OtpPurpose },
): Promise<RequestOtpResult> {
  const { db, now, secret, sms } = deps;
  const { phone, ip, purpose } = input;

  const locked = await lockState(deps, phone);
  if (locked) return { ok: false, reason: "locked", retryAfterSec: locked };

  const byPhone = await db.otpCode.findMany({
    where: { phone, created_at: { gt: secondsAgo(now, OTP_RULES.phoneWindowSec) } },
    select: { created_at: true },
    orderBy: { created_at: "asc" },
  });
  if (byPhone.length >= OTP_RULES.phoneMaxRequests) {
    const freeAt = byPhone[0].created_at.getTime() + OTP_RULES.phoneWindowSec * 1000;
    return { ok: false, reason: "phone_limit", retryAfterSec: Math.ceil((freeAt - now.getTime()) / 1000) };
  }

  const byIp = await db.otpCode.findMany({
    where: { ip, created_at: { gt: secondsAgo(now, OTP_RULES.ipWindowSec) } },
    select: { created_at: true },
    orderBy: { created_at: "asc" },
  });
  if (byIp.length >= OTP_RULES.ipMaxRequests) {
    const freeAt = byIp[0].created_at.getTime() + OTP_RULES.ipWindowSec * 1000;
    return { ok: false, reason: "ip_limit", retryAfterSec: Math.ceil((freeAt - now.getTime()) / 1000) };
  }

  const code = String(randomInt(0, 10 ** OTP_RULES.length)).padStart(OTP_RULES.length, "0");
  const expiresAt = new Date(now.getTime() + OTP_RULES.ttlSec * 1000);
  await db.otpCode.create({
    data: {
      phone,
      purpose,
      ip,
      code_hash: hashCode(secret, phone, code),
      expires_at: expiresAt,
      created_at: now,
      test_code: sms.isMock ? code : null,
    },
  });
  await sms.send(phone, `کد ورود polyra: ${code}`);
  return { ok: true, expiresAt, testCode: sms.isMock ? code : null };
}

export async function verifyOtp(
  deps: OtpDeps,
  input: { phone: string; code: string; purpose: OtpPurpose },
): Promise<VerifyOtpResult> {
  const { db, now, secret } = deps;
  const { phone, code, purpose } = input;

  if (await lockState(deps, phone)) return { ok: false, reason: "locked" };

  const latest = await db.otpCode.findFirst({
    where: { phone, purpose, used_at: null },
    orderBy: { created_at: "desc" },
  });
  if (!latest) return { ok: false, reason: "none" };
  if (latest.expires_at <= now) return { ok: false, reason: "expired" };

  if (!sameHash(latest.code_hash, hashCode(secret, phone, code))) {
    await db.otpCode.update({ where: { id: latest.id }, data: { attempts: { increment: 1 } } });
    const locked = await lockState(deps, phone);
    if (locked) return { ok: false, reason: "locked" };
    const wrongSoFar = await db.otpCode.aggregate({
      where: { phone, created_at: { gt: secondsAgo(now, OTP_RULES.lockSec) } },
      _sum: { attempts: true },
    });
    return { ok: false, reason: "wrong", attemptsLeft: OTP_RULES.maxWrong - (wrongSoFar._sum.attempts ?? 0) };
  }

  await db.otpCode.update({ where: { id: latest.id }, data: { used_at: now } });
  return { ok: true };
}

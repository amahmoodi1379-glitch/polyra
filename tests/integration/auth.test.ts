import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDevice, findUserByToken } from "@/server/auth/devices";
import { OTP_RULES, requestOtp, verifyOtp } from "@/server/auth/otp";
import { mockSmsProvider } from "@/server/sms/provider";
import { resetDb, testDb } from "./db";

const secret = "test-secret";
const phone = "+989121234567";
const at = (iso: string) => new Date(iso);
const deps = (now: Date) => ({ db: testDb, now, secret, sms: mockSmsProvider });

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

describe("SMS login codes (PRD §15.5)", () => {
  it("makes a 5-digit code that expires after 2 minutes and works once", async () => {
    const now = at("2026-10-12T10:00:00Z");
    const sent = await requestOtp(deps(now), { phone, ip: "1.1.1.1", purpose: "login" });
    if (!sent.ok) throw new Error("expected a code");
    expect(sent.testCode).toMatch(/^\d{5}$/);
    expect(sent.expiresAt.getTime() - now.getTime()).toBe(OTP_RULES.ttlSec * 1000);

    expect(await verifyOtp(deps(at("2026-10-12T10:01:00Z")), { phone, code: sent.testCode!, purpose: "login" })).toEqual({ ok: true });
    expect(await verifyOtp(deps(at("2026-10-12T10:01:10Z")), { phone, code: sent.testCode!, purpose: "login" })).toEqual({
      ok: false,
      reason: "none",
    });
  });

  it("refuses an expired code", async () => {
    const sent = await requestOtp(deps(at("2026-10-12T10:00:00Z")), { phone, ip: "1.1.1.1", purpose: "login" });
    if (!sent.ok) throw new Error("expected a code");
    const result = await verifyOtp(deps(at("2026-10-12T10:02:01Z")), { phone, code: sent.testCode!, purpose: "login" });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("allows 3 requests per phone in 10 minutes", async () => {
    for (const minute of ["00", "01", "02"]) {
      const result = await requestOtp(deps(at(`2026-10-12T10:${minute}:00Z`)), { phone, ip: "1.1.1.1", purpose: "login" });
      expect(result.ok).toBe(true);
    }
    const fourth = await requestOtp(deps(at("2026-10-12T10:03:00Z")), { phone, ip: "1.1.1.1", purpose: "login" });
    expect(fourth).toMatchObject({ ok: false, reason: "phone_limit", retryAfterSec: 420 });
    const later = await requestOtp(deps(at("2026-10-12T10:10:01Z")), { phone, ip: "1.1.1.1", purpose: "login" });
    expect(later.ok).toBe(true);
  });

  it("allows 10 requests per IP in an hour", async () => {
    for (let i = 0; i < 10; i++) {
      const other = `+98912000${String(i).padStart(4, "0")}`;
      const result = await requestOtp(deps(at(`2026-10-12T10:${String(i).padStart(2, "0")}:00Z`)), { phone: other, ip: "2.2.2.2", purpose: "login" });
      expect(result.ok).toBe(true);
    }
    const eleventh = await requestOtp(deps(at("2026-10-12T10:30:00Z")), { phone, ip: "2.2.2.2", purpose: "login" });
    expect(eleventh).toMatchObject({ ok: false, reason: "ip_limit" });
  });

  it("locks the phone for 10 minutes after 5 wrong codes", async () => {
    const sent = await requestOtp(deps(at("2026-10-12T10:00:00Z")), { phone, ip: "1.1.1.1", purpose: "login" });
    if (!sent.ok) throw new Error("expected a code");
    const wrong = sent.testCode === "00000" ? "11111" : "00000";
    for (let i = 1; i <= 4; i++) {
      const result = await verifyOtp(deps(at("2026-10-12T10:00:30Z")), { phone, code: wrong, purpose: "login" });
      expect(result).toEqual({ ok: false, reason: "wrong", attemptsLeft: 5 - i });
    }
    const fifth = await verifyOtp(deps(at("2026-10-12T10:00:40Z")), { phone, code: wrong, purpose: "login" });
    expect(fifth).toEqual({ ok: false, reason: "locked" });
    // Even the right code is refused while locked, and no new code can be requested.
    expect(await verifyOtp(deps(at("2026-10-12T10:01:00Z")), { phone, code: sent.testCode!, purpose: "login" })).toEqual({
      ok: false,
      reason: "locked",
    });
    expect(await requestOtp(deps(at("2026-10-12T10:05:00Z")), { phone, ip: "1.1.1.1", purpose: "login" })).toMatchObject({
      ok: false,
      reason: "locked",
    });
    const after = await requestOtp(deps(at("2026-10-12T10:10:01Z")), { phone, ip: "1.1.1.1", purpose: "login" });
    expect(after.ok).toBe(true);
  });

  it("stores only a hash of the code, plus the plain code for the mock provider", async () => {
    const sent = await requestOtp(deps(at("2026-10-12T10:00:00Z")), { phone, ip: "1.1.1.1", purpose: "login" });
    if (!sent.ok) throw new Error("expected a code");
    const row = await testDb.otpCode.findFirstOrThrow();
    expect(row.code_hash).not.toContain(sent.testCode!);
    expect(row.test_code).toBe(sent.testCode);
  });
});

describe("signed-in devices (PRD §15.5)", () => {
  it("keeps at most 2 devices and signs out the least recently used one", async () => {
    const user = await testDb.user.create({ data: { phone, session_length_min: 15 } });
    const phoneToken = await createDevice({ db: testDb, now: at("2026-10-01T10:00:00Z") }, { userId: user.id, userAgent: "phone", maxDevices: 2 });
    const laptopToken = await createDevice({ db: testDb, now: at("2026-10-02T10:00:00Z") }, { userId: user.id, userAgent: "laptop", maxDevices: 2 });
    // The phone is used again, so the laptop becomes the least recently used.
    await findUserByToken({ db: testDb, now: at("2026-10-03T10:00:00Z") }, phoneToken);
    const tabletToken = await createDevice({ db: testDb, now: at("2026-10-04T10:00:00Z") }, { userId: user.id, userAgent: "tablet", maxDevices: 2 });

    const now = at("2026-10-04T10:01:00Z");
    expect(await findUserByToken({ db: testDb, now }, phoneToken)).not.toBeNull();
    expect(await findUserByToken({ db: testDb, now }, tabletToken)).not.toBeNull();
    expect(await findUserByToken({ db: testDb, now }, laptopToken)).toBeNull();
    expect(await testDb.authDevice.count()).toBe(2);
  });

  it("does not sign in a deleted account", async () => {
    const user = await testDb.user.create({ data: { phone, session_length_min: 15 } });
    const token = await createDevice({ db: testDb, now: at("2026-10-01T10:00:00Z") }, { userId: user.id, userAgent: null, maxDevices: 2 });
    await testDb.user.update({ where: { id: user.id }, data: { deleted_at: at("2026-10-02T10:00:00Z") } });
    expect(await findUserByToken({ db: testDb, now: at("2026-10-02T11:00:00Z") }, token)).toBeNull();
  });
});

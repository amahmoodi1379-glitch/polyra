"use server";

import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { normalizeMobile, toAsciiDigits } from "@/lib/phone";
import { authSecret, OTP_RULES, requestOtp, verifyOtp } from "@/server/auth/otp";
import { clientIp, dropSessionCookie, getCurrentDevice } from "@/server/auth/session";
import { db } from "@/server/db";
import { logError } from "@/server/errors";
import { changePhone, deleteAccount, phoneFree } from "@/server/learn/account";
import { getSmsProvider, SmsSendError } from "@/server/sms/provider";

/**
 * «تغییر شماره» and «حذف حساب» from the learner's settings (PRD §15.5). The code goes to the NEW number;
 * the number is checked before a code is spent on it and again when it is saved.
 */

export type PhoneState =
  | { step: "phone"; error?: string; phoneInput?: string }
  | { step: "code"; phone: string; expiresAt: string; testCode: string | null; error?: string }
  | { step: "done"; phone: string };

const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));
const failed = (error: unknown, code: string) => t(error instanceof SmsSendError ? "login.errors.smsFailed" : "errors.withCode", { code });

async function signedIn() {
  const found = await getCurrentDevice();
  if (!found) redirect("/login");
  return found;
}

async function codeFor(userId: number, raw: string): Promise<PhoneState> {
  const free = await phoneFree(userId, raw);
  if (!free.ok) return { step: "phone", phoneInput: raw, error: t(`learn.account.phone.errors.${free.reason}`) };
  const result = await requestOtp(
    { db, now: new Date(), secret: authSecret(), sms: getSmsProvider() },
    { phone: free.phone, ip: await clientIp(), purpose: "change_phone" },
  );
  if (!result.ok) {
    const key = result.reason === "phone_limit" ? "phoneLimit" : result.reason === "ip_limit" ? "ipLimit" : "locked";
    return { step: "phone", phoneInput: raw, error: t(`login.errors.${key}`, { minutes: minutes(result.retryAfterSec) }) };
  }
  return { step: "code", phone: free.phone, expiresAt: result.expiresAt.toISOString(), testCode: result.testCode };
}

export async function sendNewPhoneCode(_prev: PhoneState, form: FormData): Promise<PhoneState> {
  const { user } = await signedIn();
  const raw = String(form.get("phone") ?? "");
  if (!normalizeMobile(raw)) return { step: "phone", phoneInput: raw, error: t("login.errors.phoneInvalid") };
  try {
    return await codeFor(user.id, raw);
  } catch (error) {
    const code = await logError("account.sendPhoneCode", error, { userId: user.id });
    return { step: "phone", phoneInput: raw, error: failed(error, code) };
  }
}

export async function resendNewPhoneCode(prev: PhoneState): Promise<PhoneState> {
  if (prev.step !== "code") return prev;
  const { user } = await signedIn();
  try {
    const next = await codeFor(user.id, prev.phone);
    return next.step === "code" ? next : { ...prev, error: next.step === "phone" ? next.error : undefined };
  } catch (error) {
    const code = await logError("account.resendPhoneCode", error, { userId: user.id });
    return { ...prev, error: failed(error, code) };
  }
}

export async function checkNewPhoneCode(prev: PhoneState, form: FormData): Promise<PhoneState> {
  if (prev.step !== "code") return prev;
  const { user, deviceId } = await signedIn();
  const code = toAsciiDigits(String(form.get("code") ?? "")).replace(/\D/g, "");
  if (code.length !== OTP_RULES.length) return { ...prev, error: t("login.errors.codeInvalid", { length: OTP_RULES.length }) };
  try {
    const result = await verifyOtp({ db, now: new Date(), secret: authSecret() }, { phone: prev.phone, code, purpose: "change_phone" });
    if (!result.ok) {
      const error =
        result.reason === "wrong"
          ? t("login.errors.wrong", { left: result.attemptsLeft })
          : result.reason === "locked"
            ? t("login.errors.locked", { minutes: minutes(OTP_RULES.lockSec) })
            : t(`login.errors.${result.reason}`);
      return { ...prev, error };
    }
    const changed = await changePhone(user.id, prev.phone, { keepDevice: deviceId, adminId: null });
    if (!changed.ok) return { step: "phone", phoneInput: prev.phone, error: t(`learn.account.phone.errors.${changed.reason}`) };
    return { step: "done", phone: changed.phone };
  } catch (error) {
    const errorCode = await logError("account.checkPhoneCode", error, { userId: user.id });
    return { ...prev, error: t("errors.withCode", { code: errorCode }) };
  }
}

export type DeleteReply = { ok: false; reason: "teacher" | "failed"; code?: string };

/** Deletes the account at once and signs this device out (PRD §15.5). */
export async function deleteMyAccount(): Promise<DeleteReply> {
  const { user } = await signedIn();
  try {
    const result = await deleteAccount(user.id);
    if (!result.ok && result.reason === "teacher") return { ok: false, reason: "teacher" };
  } catch (error) {
    return { ok: false, reason: "failed", code: await logError("account.delete", error, { userId: user.id }) };
  }
  await dropSessionCookie();
  redirect("/login?deleted=1");
}

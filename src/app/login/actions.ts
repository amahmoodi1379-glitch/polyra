"use server";

import { redirect } from "next/navigation";
import { t } from "@/i18n";
import { toAsciiDigits, normalizeMobile } from "@/lib/phone";
import { OTP_RULES, requestOtp, verifyOtp } from "@/server/auth/otp";
import { clientIp, startSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { logError } from "@/server/errors";
import { getSmsProvider, SmsSendError } from "@/server/sms/provider";
import { findOrCreateUser } from "@/server/users";

export type LoginState =
  | { step: "phone"; error?: string; phoneInput?: string }
  | { step: "code"; phone: string; expiresAt: string; testCode: string | null; error?: string; notice?: string };

function authSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set");
  return secret;
}

/** Only same-site paths, so the login page cannot be used to send people elsewhere. */
function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

function failedMessage(error: unknown, code: string) {
  return t(error instanceof SmsSendError ? "login.errors.smsFailed" : "errors.withCode", { code });
}

const minutes = (seconds: number) => Math.max(1, Math.ceil(seconds / 60));

async function sendCodeTo(phone: string): Promise<LoginState> {
  const result = await requestOtp(
    { db, now: new Date(), secret: authSecret(), sms: getSmsProvider() },
    { phone, ip: await clientIp(), purpose: "login" },
  );
  if (!result.ok) {
    const key = result.reason === "phone_limit" ? "phoneLimit" : result.reason === "ip_limit" ? "ipLimit" : "locked";
    return { step: "phone", phoneInput: phone, error: t(`login.errors.${key}`, { minutes: minutes(result.retryAfterSec) }) };
  }
  return { step: "code", phone, expiresAt: result.expiresAt.toISOString(), testCode: result.testCode };
}

export async function sendCode(_prev: LoginState, form: FormData): Promise<LoginState> {
  const raw = String(form.get("phone") ?? "");
  const phone = normalizeMobile(raw);
  if (!phone) return { step: "phone", phoneInput: raw, error: t("login.errors.phoneInvalid") };
  try {
    return await sendCodeTo(phone);
  } catch (error) {
    const code = await logError("login.sendCode", error);
    return { step: "phone", phoneInput: raw, error: failedMessage(error, code) };
  }
}

export async function resendCode(prev: LoginState): Promise<LoginState> {
  if (prev.step !== "code") return prev;
  try {
    const next = await sendCodeTo(prev.phone);
    return next.step === "code" ? next : { ...prev, error: next.error };
  } catch (error) {
    const code = await logError("login.resendCode", error);
    return { ...prev, error: failedMessage(error, code) };
  }
}

export async function checkCode(prev: LoginState, form: FormData): Promise<LoginState> {
  if (prev.step !== "code") return prev;
  const code = toAsciiDigits(String(form.get("code") ?? "")).replace(/\D/g, "");
  if (code.length !== OTP_RULES.length) {
    return { ...prev, error: t("login.errors.codeInvalid", { length: OTP_RULES.length }) };
  }

  let userId: number;
  try {
    const result = await verifyOtp({ db, now: new Date(), secret: authSecret() }, { phone: prev.phone, code, purpose: "login" });
    if (!result.ok) {
      const error =
        result.reason === "wrong"
          ? t("login.errors.wrong", { left: result.attemptsLeft })
          : result.reason === "locked"
            ? t("login.errors.locked", { minutes: minutes(OTP_RULES.lockSec) })
            : t(`login.errors.${result.reason}`);
      return { ...prev, error };
    }
    const user = await findOrCreateUser(prev.phone);
    userId = user.id;
    await startSession(userId);
  } catch (error) {
    const errorCode = await logError("login.checkCode", error);
    return { ...prev, error: t("errors.withCode", { code: errorCode }) };
  }
  redirect(safeNext(form.get("next")));
}

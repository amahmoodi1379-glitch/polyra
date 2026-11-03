"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { checkNewPhoneCode, resendNewPhoneCode, sendNewPhoneCode, type PhoneState } from "@/app/(learner)/account-actions";
import { Icon } from "@/components/learn/icons";
import { t } from "@/i18n";
import { formatClockFa, toPersianDigits } from "@/lib/digits";
import { formatMobileFa } from "@/lib/phone";

const CODE_LENGTH = 5;
const ltr = (text: string) => `⁦${text}⁩`;

function useSecondsLeft(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, (Date.parse(until) - now) / 1000) : 0;
}

type Input = { kind: "send" | "verify"; form: FormData } | { kind: "resend" } | { kind: "restart" };

/** «تغییر شماره» (PRD §15.5): the new number, then the code sent to it; progress and subscriptions stay. */
export function PhoneFlow({ current, home }: { current: string; home: string }) {
  const [state, dispatch, pending] = useActionState(async (prev: PhoneState, input: Input): Promise<PhoneState> => {
    if (input.kind === "restart") return { step: "phone" };
    if (input.kind === "resend") return resendNewPhoneCode(prev);
    return input.kind === "send" ? sendNewPhoneCode(prev, input.form) : checkNewPhoneCode(prev, input.form);
  }, { step: "phone" } as PhoneState);
  const formRef = useRef<HTMLFormElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const secondsLeft = useSecondsLeft(state.step === "code" ? state.expiresAt : null);

  if (state.step === "done") {
    return (
      <div className="account-done" role="status" data-phone-done>
        <Icon name="l-check" />
        <p className="num">{t("learn.account.phone.done", { phone: ltr(formatMobileFa(state.phone)) })}</p>
        <Link className="primary" href={home}>
          {t("learn.account.backHome")}
        </Link>
      </div>
    );
  }

  if (state.step === "phone") {
    return (
      <form className="account-form" action={(form) => dispatch({ kind: "send", form })}>
        <p className="account-lead num">{t("learn.account.phone.lead", { phone: ltr(formatMobileFa(current)) })}</p>
        <label className="field">
          <span>{t("learn.account.phone.newLabel")}</span>
          <input
            className="phone-field num"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            required
            autoFocus
            defaultValue={state.phoneInput}
            placeholder={t("login.phonePlaceholder")}
            aria-invalid={state.error ? true : undefined}
          />
        </label>
        {state.error ? (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        ) : null}
        <p className="account-hint">{t("learn.account.phone.keeps")}</p>
        <button type="submit" className="primary" disabled={pending}>
          {pending ? t("common.loading") : t("login.sendCode")}
        </button>
      </form>
    );
  }

  const fillTestCode = () => {
    if (!codeRef.current || !state.testCode || pending) return;
    codeRef.current.value = state.testCode;
    formRef.current?.requestSubmit();
  };

  return (
    <div className="account-form">
      <form ref={formRef} className="account-form" action={(form) => dispatch({ kind: "verify", form })}>
        <p className="account-lead num">{t("learn.account.phone.codeLead", { length: CODE_LENGTH, phone: ltr(formatMobileFa(state.phone)) })}</p>
        <label className="field">
          <span>{t("login.codeLabel")}</span>
          <input
            key={state.expiresAt}
            ref={codeRef}
            className="phone-field code num"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            required
            autoFocus
            maxLength={CODE_LENGTH}
            aria-invalid={state.error ? true : undefined}
            onChange={(event) => {
              const digits = event.currentTarget.value.replace(/[^\d۰-۹٠-٩]/g, "");
              if (digits.length === CODE_LENGTH && !pending) formRef.current?.requestSubmit();
            }}
          />
        </label>
        {state.error ? (
          <p className="form-error" role="alert">
            {state.error}
          </p>
        ) : null}
        <button type="submit" className="primary" disabled={pending}>
          {pending ? t("common.loading") : t("learn.account.phone.save")}
        </button>
      </form>
      <div className="row spread">
        <button type="button" className="ghost" onClick={() => startTransition(() => dispatch({ kind: "restart" }))}>
          {t("login.changePhone")}
        </button>
        {secondsLeft > 0 ? (
          <span className="account-hint num">{t("login.resendIn", { time: formatClockFa(secondsLeft) })}</span>
        ) : (
          <button type="button" className="ghost" disabled={pending} onClick={() => startTransition(() => dispatch({ kind: "resend" }))}>
            {t("login.resend")}
          </button>
        )}
      </div>
      {state.testCode ? (
        <div className="test-code">
          <p>{t("login.testCode")}</p>
          <button type="button" className="secondary num" onClick={fillTestCode} disabled={pending} data-test-code={state.testCode} dir="ltr">
            {toPersianDigits(state.testCode)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

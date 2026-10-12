"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { formatClockFa, toPersianDigits } from "@/lib/digits";
import { formatMobileFa } from "@/lib/phone";
import { checkCode, resendCode, sendCode, type LoginState } from "./actions";

const CODE_LENGTH = 5;

function ErrorLine({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-bad flex items-start gap-2 text-sm leading-6">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </p>
  );
}

function useSecondsLeft(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [until]);
  return until ? Math.max(0, (Date.parse(until) - now) / 1000) : 0;
}

function PhoneStep({ state, action, pending }: { state: LoginState; action: (form: FormData) => void; pending: boolean }) {
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="phone" className="text-ink-2 text-[13px] font-bold">
          {t("login.phoneLabel")}
        </label>
        <Input
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          required
          autoFocus
          defaultValue={state.step === "phone" ? state.phoneInput : undefined}
          placeholder={t("login.phonePlaceholder")}
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "phone-error" : undefined}
          className="num h-14 text-center text-xl tracking-[0.06em]"
        />
        <div id="phone-error">
          <ErrorLine message={state.error} />
        </div>
      </div>
      <Button type="submit" size="lg" disabled={pending} className="w-full">
        {pending ? t("common.loading") : t("login.sendCode")}
      </Button>
    </form>
  );
}

function CodeStep({
  state,
  verify,
  resend,
  restart,
  pending,
  next,
}: {
  state: Extract<LoginState, { step: "code" }>;
  verify: (form: FormData) => void;
  resend: () => void;
  restart: () => void;
  pending: boolean;
  next: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const secondsLeft = useSecondsLeft(state.expiresAt);

  function fillTestCode() {
    if (!inputRef.current || !state.testCode || pending) return;
    inputRef.current.value = state.testCode;
    formRef.current?.requestSubmit();
  }

  return (
    <div className="flex flex-col gap-5">
      <form ref={formRef} action={verify} className="flex flex-col gap-5">
        <input type="hidden" name="next" value={next} />
        <div className="flex flex-col gap-2">
          <label htmlFor="code" className="text-ink-2 text-[13px] font-bold">
            {t("login.codeLabel")}
          </label>
          <Input
            key={state.expiresAt}
            ref={inputRef}
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            required
            autoFocus
            maxLength={CODE_LENGTH}
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? "code-error" : undefined}
            onChange={(event) => {
              const digits = event.currentTarget.value.replace(/[^\d۰-۹٠-٩]/g, "");
              if (digits.length === CODE_LENGTH && !pending) formRef.current?.requestSubmit();
            }}
            className="num h-16 text-center text-[28px] tracking-[0.5em] ps-[0.5em]"
          />
          <div id="code-error">
            <ErrorLine message={state.error} />
          </div>
        </div>
        <Button type="submit" size="lg" disabled={pending} className="w-full">
          {pending ? t("common.loading") : t("login.verify")}
        </Button>
      </form>

      <div className="flex min-h-11 items-center justify-between gap-3">
        <Button type="button" variant="ghost" size="sm" onClick={restart} className="-ms-3.5">
          {t("login.changePhone")}
        </Button>
        {secondsLeft > 0 ? (
          <span className="text-ink-3 num text-sm" aria-live="off">
            {t("login.resendIn", { time: formatClockFa(secondsLeft) })}
          </span>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={resend} disabled={pending} className="-me-3.5 text-brand-text">
            {t("login.resend")}
          </Button>
        )}
      </div>

      {state.testCode ? (
        <div className="bg-tint flex items-center justify-between gap-4 rounded-[18px] py-2 ps-4 pe-2">
          <p className="text-ink-2 text-[13px] leading-6">{t("login.testCode")}</p>
          <button
            type="button"
            onClick={fillTestCode}
            disabled={pending}
            data-test-code={state.testCode}
            dir="ltr"
            aria-label={t("login.useTestCode", { code: toPersianDigits(state.testCode) })}
            className="num bg-surface dark:bg-tint-2 text-brand-text hover:text-brand h-11 shrink-0 rounded-[13px] ps-[calc(0.875rem+0.18em)] pe-3.5 text-lg font-extrabold tracking-[0.18em] shadow-[var(--shadow-1)] transition-colors disabled:opacity-60"
          >
            {toPersianDigits(state.testCode)}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function LoginFlow({ next }: { next: string }) {
  const [state, dispatch, pending] = useActionState(
    async (prev: LoginState, input: { kind: "send" | "verify"; form: FormData } | { kind: "resend" } | { kind: "restart" }) => {
      if (input.kind === "restart") return { step: "phone" } as LoginState;
      if (input.kind === "resend") return resendCode(prev);
      return input.kind === "send" ? sendCode(prev, input.form) : checkCode(prev, input.form);
    },
    { step: "phone" } as LoginState,
  );

  const heading = state.step === "phone" ? t("login.title") : t("login.codeTitle");
  const lead =
    state.step === "phone"
      ? t("login.lead")
      : t("login.codeLead", { length: CODE_LENGTH, phone: `\u2066${formatMobileFa(state.phone)}\u2069` });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-ink text-[30px] leading-[1.35] font-extrabold">{heading}</h1>
        <p className="text-ink-2">{lead}</p>
      </header>
      {state.step === "phone" ? (
        <PhoneStep state={state} pending={pending} action={(form) => dispatch({ kind: "send", form })} />
      ) : (
        <CodeStep
          state={state}
          pending={pending}
          next={next}
          verify={(form) => dispatch({ kind: "verify", form })}
          resend={() => startTransition(() => dispatch({ kind: "resend" }))}
          restart={() => startTransition(() => dispatch({ kind: "restart" }))}
        />
      )}
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import { CircleAlert, CircleCheck } from "lucide-react";
import { t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import type { FormReply } from "./actions";

/** Small form pieces shared by «پلن‌ها و کدها», «سفارش‌ها» and the subscription tools on an account. */

export const inputClass =
  "bg-surface border-line-2 text-ink placeholder:text-ink-3 h-11 w-full min-w-0 rounded-[14px] border px-3.5 text-[15px] outline-none transition-[border-color,box-shadow] focus-visible:border-brand-soft focus-visible:ring-[3px] focus-visible:ring-ring/30 aria-invalid:border-bad disabled:opacity-60";

export type Errors = Record<string, string>;

/** The Persian message for one field's problem code, or null. */
export const errorText = (errors: Errors, key: string) => (errors[key] ? t(`admin.sales.errors.${errors[key]}` as MessageKey) : null);

export function Labeled({ id, label, help, error, children, wide }: { id?: string; label: string; help?: string | null; error?: string | null; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", wide && "sm:col-span-2")}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={id} className="text-ink text-[13.5px] font-bold">
          {label}
        </label>
        {help ? <p className="text-ink-3 max-w-[64ch] text-[13px] leading-6">{help}</p> : null}
      </div>
      {children}
      {error ? (
        <p role="alert" className="text-bad text-[13px] font-bold">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Digits only, typed in Persian or Latin: shown as typed, read by the server. */
export function NumberInput({ id, value, onChange, invalid, placeholder }: { id: string; value: string; onChange: (value: string) => void; invalid?: boolean; placeholder?: string }) {
  return (
    <input
      id={id}
      inputMode="numeric"
      dir="ltr"
      value={value}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
      className={cn(inputClass, "num text-end")}
    />
  );
}

/** What the last save said: saved, or the problem with its error code. */
export function ReplyLine({ reply, done }: { reply: FormReply | null; done?: string }) {
  if (!reply) return null;
  if (reply.ok)
    return (
      <p role="status" className="text-ok flex items-center gap-1.5 text-[14px] font-bold">
        <CircleCheck className="size-4 shrink-0" strokeWidth={2} aria-hidden />
        {done ?? t("admin.sales.saved")}
      </p>
    );
  const message = "failed" in reply ? t("admin.sales.errors.failed", { code: reply.failed }) : reply.errors.form ? t(`admin.sales.errors.${reply.errors.form}` as MessageKey) : null;
  if (!message) return null;
  return (
    <p role="alert" className="text-bad flex items-start gap-1.5 text-[14px] leading-7 font-bold">
      <CircleAlert className="mt-1.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
      {message}
    </p>
  );
}

export const replyErrors = (reply: FormReply | null): Errors => (reply && !reply.ok && "errors" in reply ? reply.errors : {});

"use client";

import { useId, useState, useTransition } from "react";
import { LoaderCircle, Smartphone } from "lucide-react";
import { changeAccountPhone, type PhoneReply } from "@/app/admin/users/actions";
import { inputClass } from "@/app/admin/sales/kit";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { formatMobileFa } from "@/lib/phone";
import { cn } from "@/lib/utils";

/** «تغییر شماره» for a learner who no longer has the old number (PRD §15.5): checked, then every device signs out. */
export function PhoneChange({ userId }: { userId: number }) {
  const id = useId();
  const [phone, setPhone] = useState("");
  const [sure, setSure] = useState(false);
  const [reply, setReply] = useState<PhoneReply | null>(null);
  const [pending, startTransition] = useTransition();
  const error = reply && !reply.ok ? (reply.reason === "failed" ? t("errors.withCode", { code: reply.code }) : t(`admin.users.phone.errors.${reply.reason}`)) : null;

  const submit = () =>
    startTransition(async () => {
      const result = await changeAccountPhone(userId, phone);
      setReply(result);
      if (result.ok) {
        setPhone("");
        setSure(false);
      }
    });

  return (
    <div className="bg-surface flex flex-col gap-4 rounded-[22px] px-5 py-5 shadow-[var(--shadow-1)] sm:px-6">
      <div className="flex items-start gap-3.5">
        <span className="bg-tint text-brand-text grid size-10 shrink-0 place-items-center rounded-[13px]">
          <Smartphone className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="text-ink text-[16px] font-extrabold">{t("admin.users.phone.title")}</h3>
          <p className="text-ink-3 max-w-[60ch] text-[13px] leading-6">{t("admin.users.phone.lead")}</p>
        </div>
      </div>
      <form
        data-phone-form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (sure) submit();
          else setSure(true);
        }}
      >
        <label htmlFor={`${id}-phone`} className="text-ink-2 text-[13px] font-bold">
          {t("admin.users.phone.label")}
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id={`${id}-phone`}
            type="tel"
            inputMode="tel"
            dir="ltr"
            value={phone}
            onChange={(event) => {
              setPhone(event.target.value);
              setSure(false);
              setReply(null);
            }}
            placeholder={t("login.phonePlaceholder")}
            className={cn(inputClass, "num w-full max-w-[260px] text-center")}
            aria-invalid={error ? true : undefined}
          />
          <Button type="submit" disabled={pending || phone.trim().length === 0} variant={sure ? "destructive" : "secondary"}>
            {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : null}
            {sure ? t("admin.users.phone.confirm") : t("admin.users.phone.submit")}
          </Button>
        </div>
        {sure && !pending ? <p className="text-ink-2 text-[13px] leading-6">{t("admin.users.phone.sure")}</p> : null}
        {error ? (
          <p role="alert" className="text-bad text-[13px] font-bold">
            {error}
          </p>
        ) : reply?.ok ? (
          <p role="status" className="text-ok text-[13px] font-bold">
            {t("admin.users.phone.done", { phone: formatMobileFa(reply.phone) })}
          </p>
        ) : null}
      </form>
    </div>
  );
}

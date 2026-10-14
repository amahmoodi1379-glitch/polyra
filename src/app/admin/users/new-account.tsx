"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, LoaderCircle, UserPlus } from "lucide-react";
import { Segmented } from "@/app/admin/content/[type]/[id]/form-kit";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { AdminLanguage } from "@/server/accounts";
import { addAccount } from "./actions";

/** A whole number with no account: make it a teacher (with a panel language) or a tester. */
export function NewAccount({ phone, shown, defaultLanguage }: { phone: string; shown: string; defaultLanguage: AdminLanguage }) {
  const router = useRouter();
  const [language, setLanguage] = useState<AdminLanguage>(defaultLanguage);
  const [busy, setBusy] = useState<"admin" | "tester" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const make = (role: "admin" | "tester") => {
    setBusy(role);
    setProblem(null);
    startTransition(async () => {
      const reply = await addAccount({ phone, role, ...(role === "admin" ? { language } : {}) });
      if (reply.ok) router.push(`/admin/users/${reply.id}`);
      else if (reply.reason === "exists") router.push(`/admin/users/${reply.id}`);
      else {
        setBusy(null);
        setProblem(reply.reason === "failed" ? t("admin.users.problems.failed", { code: reply.code }) : t(`admin.users.problems.${reply.reason}`));
      }
    });
  };

  return (
    <section aria-labelledby="new-account" className="bg-surface flex flex-col gap-5 rounded-[22px] px-5 py-5 shadow-[var(--shadow-1)] sm:px-6">
      <div className="flex items-start gap-4">
        <span className="bg-tint text-brand-text grid size-11 shrink-0 place-items-center rounded-[14px]">
          <UserPlus className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="new-account" className="text-ink text-[17px] font-extrabold">
            {t("admin.users.new.title")}
          </h2>
          <p className="text-ink text-[16px] font-bold tabular-nums">{shown}</p>
          <p className="text-ink-2 max-w-[60ch] text-[14px] leading-7">{t("admin.users.new.lead")}</p>
        </div>
      </div>

      <div className="border-line flex flex-col gap-3 border-t pt-4">
        <p className="text-ink-3 text-[12.5px] font-bold">{t("admin.users.new.language")}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={language}
            onChange={(value) => setLanguage(value as AdminLanguage)}
            label={t("admin.users.new.language")}
            options={[
              { value: "fr", label: t("common.languages.fr") },
              { value: "de", label: t("common.languages.de") },
              { value: "all", label: t("admin.users.languages.all") },
            ]}
          />
          <Button type="button" disabled={busy !== null} onClick={() => make("admin")}>
            {busy === "admin" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
            {t("admin.users.new.asAdmin")}
          </Button>
        </div>
      </div>
      <div className="border-line flex flex-wrap items-center gap-3 border-t pt-4">
        <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => make("tester")}>
          {busy === "tester" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
          {t("admin.users.new.asTester")}
        </Button>
        <p className="text-ink-3 text-[13px]">{t("admin.users.lists.testersHint")}</p>
      </div>

      {problem ? (
        <p role="alert" className="text-bad flex items-start gap-1.5 text-[14px] leading-7 font-bold">
          <CircleAlert className="mt-1.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          {problem}
        </p>
      ) : null}
    </section>
  );
}

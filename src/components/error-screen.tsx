"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { CopyButton } from "@/components/admin/copy-button";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { errorCode } from "@/lib/error-code";
import { reportError } from "@/lib/report-error";
import { cn } from "@/lib/utils";

type Props = { error: Error & { digest?: string }; retry: () => void; place: "app" | "admin" };

/**
 * The short code of the error on screen. A server error is already in `error_log` and its code comes
 * from its digest; an error in this browser is sent first and its code comes back (PRD §15.9).
 */
function useErrorCode(error: Props["error"]) {
  const fromDigest = error.digest ? errorCode(error.digest) : null;
  const [sent, setSent] = useState<{ error: Error; code: string | null } | null>(null);
  useEffect(() => {
    if (error.digest) return;
    let live = true;
    void reportError(error).then((code) => live && setSent({ error, code }));
    return () => {
      live = false;
    };
  }, [error]);
  if (fromDigest) return { code: fromDigest, waiting: false };
  return sent?.error === error ? { code: sent.code, waiting: false } : { code: null, waiting: true };
}

/** What a learner or teacher sees when a page breaks: what happened, the code, and a way out. */
export function ErrorScreen({ error, retry, place }: Props) {
  const { code, waiting } = useErrorCode(error);
  const admin = place === "admin";

  return (
    <section className={cn("flex w-full flex-col gap-6", admin ? "max-w-[520px] py-6" : "mx-auto min-h-dvh max-w-[440px] justify-center px-5 py-12")}>
      <div className="flex flex-col gap-2">
        <h1 className="text-ink text-[26px] leading-snug font-extrabold text-balance">{t(admin ? "errors.screen.adminTitle" : "errors.screen.title")}</h1>
        <p className="text-ink-2 max-w-[52ch]">{t(admin ? "errors.screen.adminBody" : "errors.screen.body")}</p>
      </div>

      {code || waiting ? (
        <div className="bg-surface flex flex-wrap items-center justify-between gap-3 rounded-[18px] p-2 ps-4 shadow-[var(--shadow-1)]">
          <p className="flex min-w-0 flex-col py-1">
            <span className="text-ink-3 text-[12.5px]">{t("errors.screen.code")}</span>
            {code ? (
              <span dir="ltr" className="lat text-ink text-start text-[21px] font-semibold tracking-[0.14em] select-all">
                {code}
              </span>
            ) : (
              <span className="text-ink-3 text-[14px] leading-8">{t("errors.screen.saving")}</span>
            )}
          </p>
          {code ? <CopyButton text={code} label={t("errors.screen.copy")} failedText={t("errors.screen.copyFailed")} variant="ghost" size="sm" /> : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={retry}>
          <RotateCcw strokeWidth={2} aria-hidden />
          {t("errors.screen.retry")}
        </Button>
        {admin ? (
          <Button asChild variant="secondary">
            <Link href={code ? `/admin/errors?q=${code}` : "/admin/errors"}>{t("errors.screen.seeIt")}</Link>
          </Button>
        ) : (
          <Button asChild variant="secondary">
            <Link href="/">{t("errors.screen.home")}</Link>
          </Button>
        )}
      </div>
    </section>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/page-header";
import { t } from "@/i18n";
import { toPersianDigits } from "@/lib/digits";
import { formatAgoFa } from "@/lib/format";
import { formatMobileFa } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { db } from "@/server/db";
import { getSmsProvider } from "@/server/sms/provider";

export const metadata: Metadata = { title: t("admin.testCodes.title") };

type CodeState = "active" | "used" | "expired";

const stateStyle: Record<CodeState, string> = {
  active: "bg-ok-soft text-ok",
  used: "bg-tint text-ink-2",
  expired: "bg-idk-soft text-ink-3",
};

/** Only with the mock SMS provider (PRD §13.2): the latest login codes, for testing without SMS. */
export default async function TestCodesPage() {
  if (!getSmsProvider().isMock) notFound();
  const codes = await db.otpCode.findMany({
    where: { test_code: { not: null } },
    orderBy: { created_at: "desc" },
    take: 30,
  });
  const now = new Date();

  return (
    <>
      <PageHeader title={t("admin.testCodes.title")} lead={t("admin.testCodes.lead")} />
      {codes.length === 0 ? (
        <p className="bg-surface border-line text-ink-2 rounded-[22px] border p-6">{t("admin.testCodes.empty")}</p>
      ) : (
        <section className="bg-surface border-line rounded-[22px] border shadow-[var(--shadow-1)]">
          {/* Column names only where the rows are laid out as columns. */}
          <div
            aria-hidden
            className="text-ink-3 border-line hidden grid-cols-[1.3fr_1fr_1fr_auto] gap-4 border-b px-5 py-3 text-[12.5px] font-bold sm:grid"
          >
            <span>{t("admin.testCodes.phone")}</span>
            <span>{t("admin.testCodes.code")}</span>
            <span>{t("admin.testCodes.when")}</span>
            <span className="min-w-[84px]">{t("admin.testCodes.state")}</span>
          </div>
          <ul>
            {codes.map((row) => {
              const state: CodeState = row.used_at ? "used" : row.expires_at <= now ? "expired" : "active";
              return (
                <li
                  key={row.id}
                  className="border-line grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b px-5 py-3.5 last:border-b-0 sm:grid-cols-[1.3fr_1fr_1fr_auto]"
                >
                  <span className="text-ink num text-[14.5px] sm:order-none">
                    <span className="sr-only">{t("admin.testCodes.phone")}: </span>
                    <bdi dir="ltr">{formatMobileFa(row.phone)}</bdi>
                  </span>
                  <span className="num text-ink row-span-2 text-xl font-extrabold tracking-[0.18em] sm:row-span-1 sm:text-lg">
                    <span className="sr-only">{t("admin.testCodes.code")}: </span>
                    <bdi dir="ltr">{toPersianDigits(row.test_code ?? "")}</bdi>
                  </span>
                  <span className="text-ink-3 flex items-center gap-2 text-[13px] sm:contents sm:text-[14.5px]">
                    <span className="sm:text-ink-2">{formatAgoFa(row.created_at, now)}</span>
                    <span
                      className={cn(
                        "inline-flex h-6 w-fit items-center rounded-[9px] px-2 text-[12px] font-bold sm:h-7 sm:min-w-[84px] sm:justify-center sm:rounded-[10px] sm:text-[12.5px]",
                        stateStyle[state],
                      )}
                    >
                      {t(`admin.testCodes.${state}`)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

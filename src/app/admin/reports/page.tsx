import type { Metadata } from "next";
import Link from "@/components/admin/link";
import { LanguageTabs } from "@/components/admin/language-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { formatNumber, t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { formatDateTimeFa } from "@/lib/format";
import { formatMobileFa } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { pickLanguage } from "@/server/content/languages";
import { reportQueue, type ReportView } from "@/server/reports/list";
import { RawAnswer, ReportBadges } from "./kit";

export const metadata: Metadata = { title: t("admin.reports.title") };

const views: ReportView[] = ["open", "done"];

/** «گزارش‌های اشکال» (PRD §13.10): open reports, urgent first and then the oldest; or the last ones closed. */
export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const language = pickLanguage(params.lang, admin.admin_language);
  const view: ReportView = params.view === "done" ? "done" : "open";
  const data = await reportQueue(view, language);
  const href = (next: ReportView) => `/admin/reports?lang=${language}${next === "done" ? "&view=done" : ""}`;

  return (
    <>
      <PageHeader
        title={t("admin.reports.title")}
        lead={t("admin.reports.lead")}
        actions={admin.admin_language === "all" ? <LanguageTabs current={language} path={view === "done" ? "/admin/reports?view=done" : "/admin/reports"} /> : null}
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <nav aria-label={t("admin.reports.viewsLabel")}>
            <ul className="flex gap-1.5">
              {views.map((item) => (
                <li key={item}>
                  <Link
                    href={href(item)}
                    scroll={false}
                    aria-current={item === view ? "page" : undefined}
                    className={cn(
                      "flex h-9 items-center rounded-[12px] px-3.5 text-[13.5px] font-bold whitespace-nowrap transition-[background-color,color] duration-150",
                      item === view ? "bg-tint text-brand-text" : "bg-surface text-ink-2 hover:text-ink shadow-[var(--shadow-1)]",
                    )}
                  >
                    {t(`admin.reports.views.${item}`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <span className="text-ink-3 text-[13px]" data-report-count>
            {t("admin.reports.count", { open: formatNumber(data.open), high: formatNumber(data.high) })}
          </span>
        </div>

        {data.rows.length === 0 ? (
          <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-10 text-center shadow-[var(--shadow-1)]">{t(view === "open" ? "admin.reports.noneOpen" : "admin.reports.noneDone")}</p>
        ) : (
          <ul className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
            {data.rows.map((report) => (
              <li key={report.id} data-report-row={report.id} data-status={report.status}>
                <Link href={`/admin/reports/${report.id}`} className="hover:bg-tint/40 flex flex-col gap-2 px-5 py-4 transition-colors sm:px-6">
                  <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <ReportBadges report={report} />
                    <span className="text-ink text-[15px] font-extrabold">{t(`admin.reports.reasons.${report.reason}`)}</span>
                    <span className="text-ink-3 text-[13px]">
                      {report.item.slug ? t(`admin.library.types.${report.item.slug}`) : report.item.type}
                      {report.code ? ` · ${t("admin.reports.exercise", { code: report.code })}` : ""}
                    </span>
                  </span>
                  <span className="text-ink-2 text-[14px] leading-6">
                    {report.item.title ? isolateLatin(report.item.title) : t("admin.reports.gone")}
                    {report.sentence ? <span className="text-ink-3"> — {isolateLatin(report.sentence.text)}</span> : null}
                  </span>
                  <span className="text-ink-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <span>{t("admin.reports.answer")}:</span>
                    <RawAnswer raw={report.raw} />
                    {report.result ? (
                      <>
                        <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                        <span>{t(`admin.reports.result.${report.result as "correct"}`)}</span>
                      </>
                    ) : null}
                    {report.sameItem > 1 ? (
                      <>
                        <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                        <span className="text-bad font-bold">{t("admin.reports.same", { n: formatNumber(report.sameItem) })}</span>
                      </>
                    ) : null}
                  </span>
                  {report.note ? <span className="text-ink text-[13.5px] leading-6">«{report.note}»</span> : null}
                  <span className="text-ink-3 flex flex-wrap items-center gap-x-2 text-[12.5px]">
                    <span className="tabular-nums">{formatDateTimeFa(report.createdAt)}</span>
                    <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                    <span className="tabular-nums">{report.phone ? formatMobileFa(report.phone) : t("admin.reports.deleted")}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

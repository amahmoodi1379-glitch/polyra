import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ReportRow } from "@/server/reports/list";

/** Pieces shared by the «گزارش‌های اشکال» list and a report's own page. */

export const reportStatusLook: Record<ReportRow["status"], string> = {
  open: "bg-tint text-brand-text",
  fixed: "bg-ok-soft text-ok",
  rejected: "bg-line text-ink-2",
};

export function ReportBadges({ report }: { report: Pick<ReportRow, "status" | "priority"> }) {
  return (
    <>
      {report.status === "open" ? (
        report.priority === "high" ? (
          <span className="bg-bad-soft text-bad rounded-[8px] px-2 py-0.5 text-[12.5px] font-bold" data-priority="high">
            {t("admin.reports.high")}
          </span>
        ) : null
      ) : (
        <span className={cn("rounded-[8px] px-2 py-0.5 text-[12.5px] font-bold", reportStatusLook[report.status])}>{t(`admin.reports.status.${report.status}`)}</span>
      )}
    </>
  );
}

/** The learner's own answer, in the language's direction. */
export function RawAnswer({ raw }: { raw: string | null }) {
  return raw?.trim() ? (
    <bdi dir="auto" className="lat text-ink font-semibold" data-raw>
      {raw}
    </bdi>
  ) : (
    <span className="text-ink-3">{t("admin.reports.noAnswer")}</span>
  );
}

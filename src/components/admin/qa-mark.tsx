import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";

export type Severity = "high" | "medium" | "low";

/** How serious a quality-check finding is, from loud to quiet (PRD §14.8). */
export const severityStyle: Record<Severity, string> = {
  high: "bg-bad-soft text-bad",
  medium: "bg-tint-2 text-ink",
  low: "border-line-2 text-ink-3 border",
};

export function SeverityChip({ severity, className }: { severity: Severity; className?: string }) {
  return (
    <span className={cn("inline-flex h-7 items-center rounded-[9px] px-2.5 text-[12.5px] font-bold whitespace-nowrap", severityStyle[severity], className)}>
      {t(`admin.batch.qa.severity.${severity}`)}
    </span>
  );
}

/** «مشکوک» next to an item the quality check found something in (PRD §13.9), with the count and the worst severity. */
export function QaMark({ count, severity }: { count: number; severity: Severity }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-[8px] px-2 text-[12px] font-bold whitespace-nowrap", severityStyle[severity])} title={t(`admin.batch.qa.severity.${severity}`)}>
      {t("admin.review.mark", { count: formatNumber(count) })}
    </span>
  );
}

/** The findings of one item: severity, what is wrong and the chatbot's suggestion. */
export function FindingList({ findings }: { findings: { severity: Severity; problem: string; suggestion: string | null }[] }) {
  return (
    <ul className="border-line divide-line flex flex-col divide-y rounded-[18px] border">
      {findings.map((finding, index) => (
        <li key={index} className="flex flex-col items-start gap-1.5 px-4 py-3.5 text-[14px] leading-6">
          <SeverityChip severity={finding.severity} />
          <p className="text-ink-2">{finding.problem}</p>
          {finding.suggestion ? <p className="text-ink-3">{t("admin.batch.qa.suggestion", { text: finding.suggestion })}</p> : null}
        </li>
      ))}
    </ul>
  );
}

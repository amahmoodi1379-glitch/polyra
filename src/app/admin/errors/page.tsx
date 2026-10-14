import type { Metadata } from "next";
import Link from "next/link";
import { ChevronDown, ChevronLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { CopyButton } from "@/components/admin/copy-button";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { formatAgoFa, formatDateTimeFa } from "@/lib/format";
import { formatMobileFa } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { errorReport, isErrorKind, type ErrorGroup } from "@/server/error-report";
import { errorCounts, listErrors } from "@/server/errors-list";
import { ErrorsFilter } from "./errors-filter";
import { errorsHref } from "./links";

export const metadata: Metadata = { title: t("admin.errors.title") };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** «خطاها» (PRD §15.9): each error once, with its repeats, and the text to give Claude Code. */
export default async function ErrorsPage({ searchParams }: PageProps<"/admin/errors">) {
  await requireAdmin();
  const query = await searchParams;
  const kindParam = one(query.kind);
  const kind = isErrorKind(kindParam) ? kindParam : null;
  const [data, counts] = await Promise.all([listErrors({ kind, q: one(query.q) ?? "", page: Number(one(query.page)) || 1 }), errorCounts()]);
  const state = { kind, q: data.q };
  const now = new Date();

  return (
    <>
      <PageHeader title={t("admin.errors.title")} lead={t("admin.errors.lead")} />

      <div className="flex flex-col gap-4">
        {counts.all > 0 ? <ErrorsFilter state={state} counts={counts} /> : null}

        {data.items.length === 0 ? (
          counts.all === 0 ? (
            <div className="bg-surface flex flex-col items-center gap-3 rounded-[22px] px-6 py-12 text-center shadow-[var(--shadow-1)]">
              <span className="bg-ok-soft text-ok grid size-12 place-items-center rounded-full">
                <ShieldCheck className="size-6" strokeWidth={1.75} aria-hidden />
              </span>
              <p className="text-ink text-[17px] font-bold">{t("admin.errors.none")}</p>
              <p className="text-ink-2 max-w-[44ch] text-[14px]">{t("admin.errors.noneHint")}</p>
            </div>
          ) : (
            <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-10 text-center shadow-[var(--shadow-1)]">{t("admin.errors.noneFound")}</p>
          )
        ) : (
          <ol className="bg-surface rounded-[22px] shadow-[var(--shadow-1)]">
            {data.items.map((group) => (
              <Entry key={group.code} group={group} now={now} open={data.items.length === 1 && Boolean(data.q)} />
            ))}
          </ol>
        )}

        {data.pages > 1 ? (
          <nav aria-label={t("admin.log.pager.label")} className="flex items-center justify-center gap-3">
            <Button asChild variant="secondary" size="sm" className={cn(data.page <= 1 && "pointer-events-none opacity-40")}>
              <Link href={errorsHref({ ...state, page: data.page - 1 })} aria-disabled={data.page <= 1}>
                <ChevronRight className="ltr:rotate-180" strokeWidth={2} aria-hidden />
                {t("admin.log.pager.newer")}
              </Link>
            </Button>
            <span className="text-ink-3 text-[13px] tabular-nums">{t("admin.log.pager.page", { page: data.page, pages: data.pages })}</span>
            <Button asChild variant="secondary" size="sm" className={cn(data.page >= data.pages && "pointer-events-none opacity-40")}>
              <Link href={errorsHref({ ...state, page: data.page + 1 })} aria-disabled={data.page >= data.pages}>
                {t("admin.log.pager.older")}
                <ChevronLeft className="ltr:rotate-180" strokeWidth={2} aria-hidden />
              </Link>
            </Button>
          </nav>
        ) : null}
      </div>
    </>
  );
}

function Entry({ group, now, open }: { group: ErrorGroup; now: Date; open: boolean }) {
  const place = group.kind === "browser" ? group.where.slice("browser ".length) : group.where;
  return (
    <li id={group.code} className="border-line flex scroll-mt-24 flex-col gap-3 border-b px-5 py-4 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span
            className={cn(
              "flex h-6 items-center rounded-[8px] px-2 text-[12px] font-bold whitespace-nowrap",
              group.kind === "browser" ? "bg-tint-2 text-ink" : "bg-tint text-brand-text",
            )}
          >
            {t(`admin.errors.kinds.${group.kind}`)}
          </span>
          <bdi className="lat text-ink text-[17px] font-semibold tracking-[0.12em]">{group.code}</bdi>
          <span className="text-ink-3 flex flex-wrap items-center gap-x-2 text-[12.5px] tabular-nums">
            <span className={cn(group.count > 1 && "text-ink-2 font-bold")}>{t("admin.errors.times", { count: group.count })}</span>
            {group.users > 1 ? (
              <>
                <span className="bg-line-2 size-1 rounded-full" aria-hidden />
                <span>{t("admin.errors.users", { count: group.users })}</span>
              </>
            ) : null}
            <span className="bg-line-2 size-1 rounded-full" aria-hidden />
            <time dateTime={group.last.toISOString()} title={formatDateTimeFa(group.last)}>
              {formatAgoFa(group.last, now)}
            </time>
          </span>
        </div>
        <CopyButton text={errorReport(group)} label={t("admin.errors.copy")} failedText={t("admin.errors.copyFailed")} variant="secondary" size="sm" />
      </div>

      <p dir="ltr" className="text-ink line-clamp-3 font-mono text-[13.5px] leading-6 break-words">
        {group.message}
      </p>

      <details open={open} className="group/details -mt-2">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-[8px] [&::-webkit-details-marker]:hidden">
          <span className="text-ink-2 hover:text-ink flex shrink-0 items-center gap-1 text-[13px] font-bold">
            {t("admin.errors.details")}
            <ChevronDown className="size-4 transition-transform duration-200 group-open/details:rotate-180 motion-reduce:transition-none" strokeWidth={2} aria-hidden />
          </span>
          <span dir="ltr" className="text-ink-3 min-w-0 truncate font-mono text-[12.5px] leading-6">
            {place}
          </span>
        </summary>
        <div className="mt-3 flex flex-col gap-3">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
            <dt className="text-ink-3">{t("admin.errors.first")}</dt>
            <dd className="text-ink-2 tabular-nums">{formatDateTimeFa(group.first)}</dd>
            <dt className="text-ink-3">{t("admin.errors.last")}</dt>
            <dd className="text-ink-2 tabular-nums">{formatDateTimeFa(group.last)}</dd>
            <dt className="text-ink-3">{t("admin.errors.who")}</dt>
            <dd className="text-ink-2 tabular-nums">{group.phone ? formatMobileFa(group.phone) : t("admin.errors.nobody")}</dd>
          </dl>
          {group.stack ? (
            <pre dir="ltr" className="bg-tint/60 text-ink-2 max-h-80 overflow-auto rounded-[14px] p-4 font-mono text-[12px] leading-5 whitespace-pre">
              {group.stack}
            </pre>
          ) : null}
        </div>
      </details>
    </li>
  );
}

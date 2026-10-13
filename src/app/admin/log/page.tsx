import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Voiced } from "@/components/admin/voiced";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { formatDateTimeFa } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { isLogKind, listLog, logKinds, type ChangeLine, type LogItem, type LogKind, type Shown } from "@/server/content/library/history";
import { RevertButton } from "./revert-button";

export const metadata: Metadata = { title: t("admin.log.title") };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function logHref(kind: LogKind | null, page = 1) {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/log?${query}` : "/admin/log";
}

/** «لاگ تغییرها» (PRD §13.2): every change in the panel, newest first, with «برگردان». */
export default async function LogPage({ searchParams }: PageProps<"/admin/log">) {
  await requireAdmin();
  const query = await searchParams;
  const kind = isLogKind(one(query.kind)) ? (one(query.kind) as LogKind) : null;
  const data = await listLog(kind, Number(one(query.page)) || 1);

  return (
    <>
      <PageHeader title={t("admin.log.title")} lead={t("admin.log.lead")} />

      <div className="flex flex-col gap-4">
        <nav aria-label={t("admin.log.kindsLabel")} className="-mx-5 overflow-x-auto px-5 pb-1 lg:mx-0 lg:overflow-visible lg:px-0">
          <ul className="flex w-max gap-1.5 lg:w-auto lg:flex-wrap">
            {[null, ...logKinds].map((item) => (
              <li key={item ?? "all"}>
                <Link
                  href={logHref(item)}
                  scroll={false}
                  aria-current={item === kind ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center rounded-[12px] px-3.5 text-[13.5px] font-bold whitespace-nowrap transition-[background-color,color] duration-150",
                    item === kind ? "bg-tint text-brand-text" : "bg-surface text-ink-2 hover:text-ink shadow-[var(--shadow-1)]",
                  )}
                >
                  {item ? t(`admin.log.kinds.${item}`) : t("admin.log.allKinds")}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {data.items.length === 0 ? (
          <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-10 text-center shadow-[var(--shadow-1)]">{kind ? t("admin.log.emptyFiltered") : t("admin.log.nothing")}</p>
        ) : (
          <ol className="bg-surface rounded-[22px] shadow-[var(--shadow-1)]">
            {data.items.map((item) => (
              <Entry key={item.id} item={item} />
            ))}
          </ol>
        )}

        {data.pages > 1 ? (
          <nav aria-label={t("admin.log.pager.label")} className="flex items-center justify-center gap-3">
            <Button asChild variant="secondary" size="sm" className={cn(data.page <= 1 && "pointer-events-none opacity-40")}>
              <Link href={logHref(kind, data.page - 1)} aria-disabled={data.page <= 1}>
                <ChevronRight className="ltr:rotate-180" strokeWidth={2} aria-hidden />
                {t("admin.log.pager.newer")}
              </Link>
            </Button>
            <span className="text-ink-3 text-[13px] tabular-nums">{t("admin.log.pager.page", { page: data.page, pages: data.pages })}</span>
            <Button asChild variant="secondary" size="sm" className={cn(data.page >= data.pages && "pointer-events-none opacity-40")}>
              <Link href={logHref(kind, data.page + 1)} aria-disabled={data.page >= data.pages}>
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

const actionLook: Record<string, string> = {
  edit: "bg-tint text-brand-text",
  status: "bg-tint-2 text-ink",
  order: "bg-tint text-brand-text",
  revert: "border border-line-2 text-ink-2",
  delete: "bg-bad-soft text-bad",
};

function Entry({ item }: { item: LogItem }) {
  const language = item.language ?? "fr";
  const title = item.title ? (
    <Voiced
      text={item.title.text}
      voice={item.title.voice}
      language={language}
      className={cn("min-w-0", item.title.voice === "target" ? "text-[17px] leading-snug" : "text-[15px] leading-7 font-bold")}
    />
  ) : null;

  return (
    <li id={`change-${item.id}`} className="border-line flex scroll-mt-24 flex-col gap-3 border-b px-5 py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className={cn("flex h-6 items-center rounded-[8px] px-2 text-[12px] font-bold whitespace-nowrap", actionLook[item.action] ?? actionLook.edit)}>
            {item.actionLabel}
          </span>
          <span className="text-ink-3 text-[12.5px] whitespace-nowrap">{item.kindLabel}</span>
          {title ? (
            item.href ? (
              <Link href={item.href} className="text-ink hover:text-brand-text min-w-0 transition-colors">
                {title}
              </Link>
            ) : (
              <span className="text-ink min-w-0">{title}</span>
            )
          ) : null}
        </div>
        <p className="text-ink-3 flex shrink-0 items-center gap-2 text-[12.5px] tabular-nums">
          <time dateTime={item.ts}>{formatDateTimeFa(new Date(item.ts))}</time>
          <span className="bg-line-2 size-1 rounded-full" aria-hidden />
          <span>{item.who}</span>
        </p>
      </div>

      {item.lines.length > 0 ? (
        <dl className="flex flex-col gap-2.5 sm:gap-1.5">
          {item.lines.map((line) => (
            <Line key={line.key} line={line} language={language} />
          ))}
        </dl>
      ) : null}

      {item.revert === "no" ? null : <RevertButton logId={item.id} ready={item.revert === "ready"} />}
    </li>
  );
}

function Line({ line, language }: { line: ChangeLine; language: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-0.5 text-[13.5px] sm:grid-cols-[11rem_minmax(0,1fr)]">
      {line.label ? (
        <dt className="text-ink-3 leading-6">
          <Voiced text={line.label} voice="fa" language={language} />
        </dt>
      ) : (
        <dt className="sr-only">{line.note}</dt>
      )}
      <dd className={cn("text-ink-2 min-w-0 leading-6", !line.label && "sm:col-start-2")}>
        {line.diff ? (
          <p
            dir={line.diff.voice === "target" ? "ltr" : undefined}
            lang={line.diff.voice === "target" ? language : undefined}
            className={cn("break-words", line.diff.voice === "target" && "lat text-start text-[15px]")}
          >
            {line.diff.parts.map((part, index) =>
              part.kind === "same" ? (
                <span key={index}>{part.text}</span>
              ) : part.kind === "add" ? (
                <ins key={index} className="bg-tint text-ink rounded-[4px] [box-decoration-break:clone] px-0.5 no-underline">
                  {part.text}
                </ins>
              ) : (
                <del key={index} className="text-ink-3 decoration-ink-3/60">
                  {part.text}
                </del>
              ),
            )}
          </p>
        ) : (
          (line.note ?? (
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <Value value={line.before ?? null} language={language} old />
              <ArrowLeft className="text-ink-3 size-3.5 shrink-0 translate-y-0.5 ltr:rotate-180" strokeWidth={2} aria-hidden />
              <span className="sr-only">{t("admin.log.now")}</span>
              <Value value={line.after ?? null} language={language} />
            </span>
          ))
        )}
      </dd>
    </div>
  );
}

function Value({ value, language, old }: { value: Shown; language: string; old?: boolean }) {
  if (!value) return <span className="text-ink-3">{t("admin.log.empty")}</span>;
  return (
    <Voiced
      text={value.text}
      voice={value.voice}
      language={language}
      className={cn("line-clamp-3 min-w-0 break-words", old ? "text-ink-3 decoration-ink-3/60 line-through" : "text-ink", value.voice === "target" && "text-[15px]")}
    />
  );
}

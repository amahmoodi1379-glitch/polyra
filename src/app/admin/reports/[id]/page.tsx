import "@/app/(learner)/learner.css";
import type { Metadata } from "next";
import Link from "@/components/admin/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { LearnerPreview } from "@/components/admin/review/learner-preview";
import { formatNumber, t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { formatDateTimeFa } from "@/lib/format";
import { formatMobileFa } from "@/lib/phone";
import { requireAdmin } from "@/server/auth/session";
import { editors } from "@/server/content/library/edit";
import type { LibrarySlug } from "@/server/content/library/slugs";
import { reportRow } from "@/server/reports/list";
import { reportPreview } from "@/server/reports/preview";
import { appSetting } from "@/server/settings/read";
import { ItemForm } from "../../content/[type]/[id]/item-form";
import { itemHref } from "../../content/links";
import { RawAnswer, ReportBadges } from "../kit";
import { ReportActions } from "../report-actions";

export const metadata: Metadata = { title: t("admin.reports.title") };

const OWN_SENTENCE = new Set<LibrarySlug>(["transforms", "translations"]);

/**
 * One report (PRD §13.10): the exercise the way the learner got it, what they answered and why they
 * reported, the four answers, and the form of the sentence or item for «محتوا را اصلاح کن».
 */
export default async function ReportPage({ params }: PageProps<"/admin/reports/[id]">) {
  await requireAdmin();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const report = await reportRow(id);
  if (!report) notFound();

  const language = report.language;
  // A report on a sentence is fixed in that sentence (its text, translation, targets and accepted answers).
  const editSlug: LibrarySlug | null = report.sentence && !(report.item.slug && OWN_SENTENCE.has(report.item.slug)) ? "sentences" : report.item.slug;
  const editId = editSlug === "sentences" && report.sentence ? report.sentence.id : report.item.id;
  const [{ preview, exact }, loaded, levels] = await Promise.all([
    reportPreview(report),
    editSlug && (editSlug !== report.item.slug || report.item.title !== null) ? editors[editSlug].load(editId) : Promise.resolve(null),
    language ? appSetting<string[]>(`levels.${language}`) : Promise.resolve([] as string[]),
  ]);
  const open = report.status === "open";
  const canBeRight = report.result === "wrong" || report.result === "idk";
  const suspend: "sentence" | "item" | "already" | null =
    editSlug === "sentences" && report.sentence
      ? report.sentence.suspended
        ? "already"
        : "sentence"
      : report.item.suspended === null
        ? null
        : report.item.suspended
          ? "already"
          : "item";

  return (
    <>
      <div className="flex flex-col gap-3">
        <Link
          href={`/admin/reports${language ? `?lang=${language}` : ""}`}
          className="text-ink-3 hover:text-ink -ms-1 inline-flex w-fit items-center gap-1.5 rounded-[10px] px-1 py-1 text-[14px] font-bold transition-colors"
        >
          <ArrowRight className="size-4 ltr:-scale-x-100" strokeWidth={2} aria-hidden />
          {t("admin.reports.back")}
        </Link>
        <PageHeader title={t(`admin.reports.reasons.${report.reason}`)} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px] xl:grid-rows-[auto_1fr] xl:gap-x-8">
        <section className="bg-surface flex min-w-0 flex-col gap-3 rounded-[22px] p-5 shadow-[var(--shadow-1)] xl:col-start-1 xl:row-start-1" data-report={report.id}>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <ReportBadges report={report} />
            <span className="text-ink-3 text-[13px]">
              {report.item.slug ? t(`admin.library.types.${report.item.slug}`) : report.item.type}
              {report.code ? ` · ${t("admin.reports.exercise", { code: report.code })}` : ""}
            </span>
            {report.sameItem > 1 ? <span className="text-bad text-[13px] font-bold">{t("admin.reports.same", { n: formatNumber(report.sameItem) })}</span> : null}
          </p>
          <p className="text-ink text-[17px] leading-7 font-extrabold">
            {report.item.href ? (
              <Link href={report.item.href} className="hover:text-brand-text underline-offset-4 hover:underline">
                {isolateLatin(report.item.title ?? "")}
              </Link>
            ) : (
              t("admin.reports.gone")
            )}
          </p>
          {report.sentence ? (
            <p className="text-ink-2 flex flex-col gap-0.5 text-[14.5px] leading-7">
              <Link href={itemHref("sentences", report.sentence.id)} className="hover:text-brand-text w-fit underline-offset-4 hover:underline">
                <bdi dir="auto" className="lat text-ink">
                  {report.sentence.text}
                </bdi>
              </Link>
              {report.sentence.translation ? <span>{report.sentence.translation}</span> : null}
            </p>
          ) : null}
          <dl className="divide-line flex flex-col divide-y text-[14px]">
            <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
              <dt className="text-ink-2">{t("admin.reports.answer")}</dt>
              <dd className="flex items-baseline gap-2">
                <RawAnswer raw={report.raw} />
                {report.result ? <span className="text-ink-3 text-[13px]">({t(`admin.reports.result.${report.result as "correct"}`)})</span> : null}
              </dd>
            </div>
            {report.note ? (
              <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
                <dt className="text-ink-2">{t("admin.reports.note")}</dt>
                <dd className="text-ink">{report.note}</dd>
              </div>
            ) : null}
            <div className="flex flex-wrap items-baseline justify-between gap-2 py-2.5">
              <dt className="text-ink-2">{t("admin.reports.learner")}</dt>
              <dd className="tabular-nums">
                {report.phone && report.userId ? (
                  <Link href={`/admin/users/${report.userId}`} className="text-brand-text font-bold hover:underline">
                    {formatMobileFa(report.phone)}
                  </Link>
                ) : (
                  t("admin.reports.deleted")
                )}
                <span className="text-ink-3"> · {formatDateTimeFa(report.createdAt)}</span>
              </dd>
            </div>
          </dl>
        </section>

        <aside className="flex min-w-0 flex-col items-center gap-3 xl:sticky xl:top-8 xl:col-start-2 xl:row-span-2 xl:row-start-1" aria-label={t("admin.reports.preview.title")}>
          <p className="text-ink-2 w-full text-[13px] leading-6">{t(exact ? "admin.reports.preview.note" : "admin.reports.preview.notExact")}</p>
          {preview.state === "ready" && language ? (
            <LearnerPreview key={`report-${report.id}`} preview={preview} languageName={t(`common.languages.${language as "fr"}`)} itemKey={`report-${report.id}`} />
          ) : (
            <p className="bg-surface text-ink-2 w-full rounded-[22px] px-5 py-6 text-[14px] leading-7 shadow-[var(--shadow-1)]">{t("admin.reports.gone")}</p>
          )}
        </aside>

        <div className="flex min-w-0 flex-col gap-5 xl:col-start-1 xl:row-start-2">
          {open ? (
            <ReportActions id={report.id} canAccept={report.canAccept} canBeRight={canBeRight} priority={report.priority} suspend={suspend} />
          ) : (
            <p className="bg-surface text-ink-2 rounded-[22px] px-5 py-4 text-[14px] shadow-[var(--shadow-1)]">{t("admin.reports.closedNote")}</p>
          )}

          {loaded && editSlug && language ? (
            <details className="group bg-surface rounded-[22px] shadow-[var(--shadow-1)]" id="report-edit">
              <summary className="text-ink flex min-h-14 cursor-pointer items-center px-5 text-[15px] font-extrabold">
                {t("admin.reports.edit")} · {t("admin.reports.editWhat", { what: t(`admin.library.types.${editSlug}`) })}
              </summary>
              <div className="flex flex-col gap-6 px-1 pb-2 sm:px-3">
                <ItemForm
                  slug={editSlug}
                  id={editId}
                  language={language}
                  values={loaded.values}
                  context={loaded.context}
                  levels={levels}
                  readOnly={loaded.view.status === "retired"}
                />
              </div>
            </details>
          ) : null}
        </div>
      </div>
    </>
  );
}

import type { Metadata } from "next";
import { DatabaseBackup, Download } from "lucide-react";
import { LanguageTabs } from "@/components/admin/language-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { pickLanguage, type LanguageCode } from "@/server/content/languages";
import { librarySlugs, type LibrarySlug } from "@/server/content/library/slugs";
import { exportCounts, wordCsvColumns } from "@/server/content/transfer/export";
import { WordImport } from "./word-import";

export const metadata: Metadata = { title: t("admin.transfer.title") };

const fileHref = (language: LanguageCode, type: LibrarySlug | "all", format: "csv" | "json") => `/admin/transfer/file?${new URLSearchParams({ lang: language, type, format })}`;

/** «خروجی» (PRD §13.2): every list as CSV or JSON, and the word file import of PRD §14.7. */
export default async function TransferPage({ searchParams }: PageProps<"/admin/transfer">) {
  const admin = await requireAdmin();
  const language = pickLanguage((await searchParams).lang, admin.admin_language);
  const counts = await exportCounts(language);
  const languageName = t(`common.languages.${language}`);

  return (
    <>
      <PageHeader
        title={t("admin.transfer.title")}
        lead={t("admin.transfer.lead")}
        actions={admin.admin_language === "all" ? <LanguageTabs current={language} path="/admin/transfer" /> : null}
      />

      <section aria-labelledby="export" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="export" className="text-ink text-[19px] font-extrabold">
            {t("admin.transfer.export.title")}
          </h2>
          <p className="text-ink-2 max-w-[68ch] text-[14.5px] leading-7">{t("admin.transfer.export.lead")}</p>
        </div>

        <a
          href={fileHref(language, "all", "json")}
          download
          className="bg-surface hover:bg-tint/60 group flex items-center gap-4 rounded-[22px] px-5 py-4 shadow-[var(--shadow-1)] transition-colors sm:px-6"
        >
          <span className="bg-tint text-brand-text grid size-11 shrink-0 place-items-center rounded-[14px]">
            <DatabaseBackup className="size-5" strokeWidth={1.75} aria-hidden />
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-ink text-[15.5px] font-extrabold">{t("admin.transfer.export.all", { language: languageName })}</span>
            <span className="text-ink-3 text-[13px] text-balance">{t("admin.transfer.export.allHint")}</span>
          </span>
          <Download className="text-brand-text ms-auto size-5 shrink-0 transition-transform duration-150 group-hover:translate-y-0.5" strokeWidth={2} aria-hidden />
        </a>

        <ul aria-label={t("admin.transfer.export.tableLabel")} className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
          {librarySlugs.map((slug) => {
            const count = counts[slug];
            const name = t(`admin.library.types.${slug}`);
            return (
              <li key={slug} className="flex items-center gap-4 px-5 py-3 sm:px-6">
                <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                  <span className={cn("text-[15px] font-bold", count ? "text-ink" : "text-ink-3")}>{name}</span>
                  <span className="text-ink-3 text-[13px] tabular-nums">{count ? t("admin.transfer.export.count", { count }) : t("admin.transfer.export.none")}</span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  {(["csv", "json"] as const).map((format) =>
                    count ? (
                      <a
                        key={format}
                        href={fileHref(language, slug, format)}
                        download
                        aria-label={t("admin.transfer.export.download", { type: name, format: format.toUpperCase() })}
                        className="border-line-2 text-ink hover:bg-tint hover:text-brand-text flex h-8 items-center gap-1.5 rounded-[10px] border px-2.5 text-[12.5px] font-bold transition-colors"
                      >
                        <Download className="size-3.5" strokeWidth={2.25} aria-hidden />
                        <span dir="ltr">{format.toUpperCase()}</span>
                      </a>
                    ) : (
                      <span key={format} aria-hidden className="border-line text-ink-3/60 flex h-8 items-center gap-1.5 rounded-[10px] border px-2.5 text-[12.5px] font-bold">
                        <Download className="size-3.5" strokeWidth={2.25} />
                        <span dir="ltr">{format.toUpperCase()}</span>
                      </span>
                    ),
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="import" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="import" className="text-ink text-[19px] font-extrabold">
            {t("admin.transfer.import.title")}
          </h2>
          <p className="text-ink-2 max-w-[68ch] text-[14.5px] leading-7">{t("admin.transfer.import.lead", { language: languageName })}</p>
        </div>
        <ul className="text-ink-2 flex max-w-[72ch] flex-col gap-1.5 text-[14px] leading-7">
          {t("admin.transfer.import.rules")
            .split("\n")
            .map((line) => (
              <li key={line} className="grid grid-cols-[1.1rem_minmax(0,1fr)]">
                <span className="bg-brand/70 mt-[0.7rem] size-1.5 rounded-full" aria-hidden />
                <span>{line.replace(/^- /, "")}</span>
              </li>
            ))}
        </ul>
        <div className="flex flex-col gap-1.5">
          <p className="text-ink-3 text-[12.5px] font-bold">{t("admin.transfer.import.columns")}</p>
          <p dir="ltr" className="bg-tint/60 text-ink-2 overflow-x-auto rounded-[12px] px-3 py-2 font-mono text-[12.5px] whitespace-nowrap">
            {wordCsvColumns.join(",")}
          </p>
        </div>
        <WordImport language={language} languageName={languageName} />
      </section>
    </>
  );
}

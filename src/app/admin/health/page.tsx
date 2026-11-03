import type { Metadata } from "next";
import Link from "next/link";
import { Check, CircleCheck } from "lucide-react";
import { LanguageTabs } from "@/components/admin/language-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { formatNumber, t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { batchSize } from "@/server/content/kinds/shared";
import { pickLanguage } from "@/server/content/languages";
import { sentenceHealth, type HealthRow } from "@/server/content/health/sentences";
import { SUSPECT_MIN, SUSPECT_SHARE, suspectItems, TEXT_LOW, TEXT_HIGH, TEXT_MIN, textsOutOfPlace } from "@/server/content/health/suspects";
import { reportSlug } from "@/server/reports/slugs";
import { makeSentences } from "./actions";
import { MakeButton } from "./make-button";

export const metadata: Metadata = { title: t("admin.health.title") };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const views = ["low", "none"] as const;
type View = (typeof views)[number];
/** Rows shown at once; a big change of order can flag hundreds of words. */
const ROWS_SHOWN = 150;

function healthHref(language: string, level: string, view: View = "low") {
  const params = new URLSearchParams({ lang: language, level });
  if (view !== "low") params.set("view", view);
  return `/admin/health?${params}`;
}

/**
 * «سلامت محتوا» (PRD §13.11): how many sentences of each word a learner can use in the current order;
 * and, from learners' answers, the items they cannot get right and the texts too hard or too easy for
 * their place. `?testers=1` counts testers' and teachers' answers too.
 */
export default async function HealthPage({ searchParams }: PageProps<"/admin/health">) {
  const admin = await requireAdmin();
  const query = await searchParams;
  const language = pickLanguage(query.lang, admin.admin_language);
  const testers = one(query.testers) === "1";
  const [{ min, levels }, size, suspects, texts] = await Promise.all([sentenceHealth(language), batchSize("P-S", 10), suspectItems(language, testers), textsOutOfPlace(language, testers)]);

  const asked = levels.find((item) => item.level === one(query.level));
  const current = asked ?? levels.find((item) => item.low.length > 0) ?? levels.find((item) => item.none.length > 0) ?? levels[0];
  const view: View = one(query.view) === "none" ? "none" : "low";
  const rows = current ? current[view] : [];
  const error = one(query.error);

  return (
    <>
      <PageHeader
        title={t("admin.health.title")}
        lead={t("admin.health.lead")}
        actions={admin.admin_language === "all" ? <LanguageTabs current={language} path="/admin/health" /> : null}
      />

      {error ? (
        <p role="alert" className="bg-bad-soft text-bad rounded-[16px] px-5 py-3.5 text-[14.5px] font-medium">
          {t("errors.withCode", { code: error })}
        </p>
      ) : null}

      <section aria-labelledby="usable" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="usable" className="text-ink text-[19px] font-extrabold">
            {t("admin.health.sentences.title")}
          </h2>
          <p className="text-ink-2 max-w-[68ch] text-[14.5px] leading-7">
            {t("admin.health.sentences.lead", { min })}{" "}
            <Link href="/admin/settings/engine#setting-health.min_usable_sentences" className="text-brand-text font-bold whitespace-nowrap hover:underline">
              {t("admin.health.sentences.changeMin")}
            </Link>
          </p>
        </div>

        {!current || levels.every((item) => item.cardWords === 0) ? (
          <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-10 text-center shadow-[var(--shadow-1)]">{t("admin.health.sentences.noWords")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <nav aria-label={t("admin.health.sentences.levelsLabel")} className="bg-tint flex gap-1 rounded-[14px] p-1">
                {levels.map((item) => {
                  const selected = item.level === current.level;
                  const flagged = item.low.length;
                  return (
                    <Link
                      key={item.level}
                      href={healthHref(language, item.level)}
                      scroll={false}
                      aria-current={selected ? "page" : undefined}
                      className={cn(
                        "flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-bold transition-[background-color,color,box-shadow] duration-150",
                        selected ? "bg-surface dark:bg-tint-2 text-brand-text shadow-[var(--shadow-1)]" : "text-ink-2 hover:text-ink",
                      )}
                    >
                      <bdi className="lat text-[14.5px] font-semibold">{item.level}</bdi>
                      {flagged > 0 ? (
                        <span className="bg-bad-soft text-bad grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-[11.5px] tabular-nums">{formatNumber(flagged)}</span>
                      ) : null}
                    </Link>
                  );
                })}
              </nav>

              <nav aria-label={t("admin.health.sentences.viewsLabel")} className="flex gap-1.5">
                {views.map((item) => {
                  const selected = item === view;
                  return (
                    <Link
                      key={item}
                      href={healthHref(language, current.level, item)}
                      scroll={false}
                      aria-current={selected ? "page" : undefined}
                      className={cn(
                        "flex h-9 items-center gap-1.5 rounded-[12px] px-3.5 text-[13.5px] font-bold whitespace-nowrap transition-[background-color,color] duration-150",
                        selected ? "bg-tint text-brand-text" : "bg-surface text-ink-2 hover:text-ink shadow-[var(--shadow-1)]",
                      )}
                    >
                      {t(`admin.health.sentences.views.${item}`)}
                      <span className={cn("text-[12px] tabular-nums", selected ? "text-brand-text/70" : "text-ink-3")}>{formatNumber(current[item].length)}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            <p className="text-ink-2 text-[14px]">
              {t("admin.health.sentences.summary", { level: isolateLatin(current.level), words: current.cardWords, healthy: current.healthy, min })}
            </p>

            {rows.length === 0 ? (
              <div className="bg-surface flex items-center gap-3 rounded-[22px] px-6 py-6 shadow-[var(--shadow-1)]">
                <CircleCheck className="text-ok size-6 shrink-0" strokeWidth={1.75} aria-hidden />
                <p className="text-ink text-[15px] font-bold">
                  {view === "low"
                    ? t("admin.health.sentences.allGood", { level: isolateLatin(current.level), min })
                    : t("admin.health.sentences.noneEmpty", { level: isolateLatin(current.level) })}
                </p>
              </div>
            ) : (
              <>
                <form action={makeSentences} className="bg-tint/70 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[20px] px-5 py-4">
                  <input type="hidden" name="language" value={language} />
                  <input type="hidden" name="level" value={current.level} />
                  <input type="hidden" name="words" value={rows.map((row) => row.id).join(",")} />
                  <p className="text-ink-2 max-w-[56ch] text-[14px] leading-7">
                    {t(view === "low" ? "admin.health.sentences.makeHintLow" : "admin.health.sentences.makeHintNone", { size: Math.min(size, rows.length) })}
                  </p>
                  <MakeButton />
                </form>

                <ol className="bg-surface rounded-[22px] shadow-[var(--shadow-1)]">
                  {rows.slice(0, ROWS_SHOWN).map((row) => (
                    <Row key={row.id} row={row} min={min} language={language} />
                  ))}
                </ol>
                {rows.length > ROWS_SHOWN ? <p className="text-ink-3 text-center text-[13px]">{t("admin.health.sentences.more", { count: rows.length - ROWS_SHOWN })}</p> : null}
              </>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="answers" className="border-line flex flex-col gap-4 border-t pt-6" data-health-answers>
        <div className="flex flex-col gap-1">
          <h2 id="answers" className="text-ink text-[19px] font-extrabold">
            {t("admin.health.answers.title")}
          </h2>
          <p className="text-ink-2 max-w-[68ch] text-[14.5px] leading-7">
            {t("admin.health.answers.lead", { min: formatNumber(SUSPECT_MIN), share: formatNumber(SUSPECT_SHARE * 100) })}
          </p>
          <Link
            href={`/admin/health?lang=${language}${testers ? "" : "&testers=1"}#answers`}
            scroll={false}
            role="checkbox"
            aria-checked={testers}
            className="text-ink-2 hover:text-ink mt-1 flex w-fit items-center gap-2 text-[13.5px] font-bold"
          >
            <span className={cn("grid size-[18px] place-items-center rounded-[5px] border", testers ? "bg-brand border-brand text-on-brand" : "border-line-2")} aria-hidden>
              {testers ? <Check className="size-3.5" strokeWidth={3} /> : null}
            </span>
            {t("admin.health.testers")}
          </Link>
        </div>
        {suspects.length === 0 ? (
          <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-6 text-[14.5px] shadow-[var(--shadow-1)]">{t("admin.health.answers.none")}</p>
        ) : (
          <ul className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
            {suspects.map((row) => (
              <li key={`${row.type}:${row.id}:${row.step}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3.5" data-suspect={`${row.type}:${row.id}`}>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                  {row.href ? (
                    <Link href={row.href} className="text-ink hover:text-brand-text text-[15px] font-bold underline-offset-4 hover:underline">
                      {isolateLatin(row.title ?? "")}
                    </Link>
                  ) : (
                    <span className="text-ink-3">{t("admin.health.answers.gone")}</span>
                  )}
                  <span className="text-ink-3 text-[13px]">
                    {t(`admin.library.types.${(reportSlug[row.type] ?? "words") as "words"}`)} · {t("admin.health.answers.step", { n: formatNumber(row.step) })}
                  </span>
                </span>
                <span className="text-bad text-[13.5px] font-bold tabular-nums">
                  {t("admin.health.answers.line", { ok: formatNumber(Math.round((row.ok / row.n) * 100)), idk: formatNumber(Math.round((row.idk / row.n) * 100)), n: formatNumber(row.n) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="texts" className="border-line flex flex-col gap-4 border-t pt-6" data-health-texts>
        <div className="flex flex-col gap-1">
          <h2 id="texts" className="text-ink text-[19px] font-extrabold">
            {t("admin.health.texts.title")}
          </h2>
          <p className="text-ink-2 max-w-[68ch] text-[14.5px] leading-7">
            {t("admin.health.texts.lead", { min: formatNumber(TEXT_MIN), low: formatNumber(TEXT_LOW * 100), high: formatNumber(TEXT_HIGH * 100) })}
          </p>
        </div>
        {texts.length === 0 ? (
          <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-6 text-[14.5px] shadow-[var(--shadow-1)]">{t("admin.health.texts.none")}</p>
        ) : (
          <ul className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
            {texts.map((row) => (
              <li key={`${row.id}:${row.track}`} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3.5" data-text-flag={row.id}>
                <span className="flex min-w-0 flex-wrap items-baseline gap-x-3">
                  <Link href={row.href} className="text-ink hover:text-brand-text text-[15px] font-bold underline-offset-4 hover:underline">
                    {isolateLatin(row.title)}
                  </Link>
                  <span className="text-ink-3 text-[13px]">
                    <bdi className="lat">{row.level}</bdi> · {t(`admin.health.texts.tracks.${row.track}`)}
                  </span>
                </span>
                <span className="flex items-baseline gap-2 text-[13.5px]">
                  <span className={cn("rounded-[8px] px-2 py-0.5 text-[12.5px] font-bold", row.mean < TEXT_LOW ? "bg-bad-soft text-bad" : "bg-gender-m/10 text-gender-m")}>
                    {t(row.mean < TEXT_LOW ? "admin.health.texts.hard" : "admin.health.texts.easy")}
                  </span>
                  <span className="text-ink-2 tabular-nums">{t("admin.health.texts.line", { mean: formatNumber(Math.round(row.mean * 100)), n: formatNumber(row.n) })}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Row({ row, min, language }: { row: HealthRow; min: number; language: string }) {
  return (
    <li className="border-line grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-3 gap-y-2 border-b px-5 py-3.5 last:border-b-0 sm:grid-cols-[2.75rem_minmax(9rem,14rem)_9rem_minmax(0,1fr)] sm:items-center">
      <span className="text-ink-3 text-[12.5px] tabular-nums" title={t("admin.health.sentences.order")}>
        {row.introOrder === null ? "—" : formatNumber(row.introOrder)}
      </span>
      <Link href={`/admin/content/words/${row.id}`} className="text-ink hover:text-brand-text min-w-0 truncate text-[17px] transition-colors">
        <bdi lang={language} dir="ltr" className="lat">
          {row.lemma}
        </bdi>
      </Link>
      {row.total > 0 ? (
        <>
          <span className="col-start-2 flex items-center gap-2 sm:col-start-auto" aria-label={t("admin.health.sentences.usableLabel", { usable: row.usable, total: row.total })}>
            <span className="flex gap-1" aria-hidden>
              {Array.from({ length: min }, (_, index) => (
                <span key={index} className={cn("size-2 rounded-full", index < row.usable ? "bg-ok" : "border-bad/60 border-[1.5px]")} />
              ))}
            </span>
            <span className="text-ink-2 text-[13px] tabular-nums" aria-hidden>
              {t("admin.health.sentences.usable", { usable: row.usable, total: row.total })}
            </span>
          </span>
          <span className="col-start-2 flex min-w-0 flex-wrap items-center gap-1.5 sm:col-start-auto">
            {row.blockers.length > 0 ? <span className="text-ink-3 text-[12.5px]">{t("admin.health.sentences.because")}</span> : null}
            {row.blockers.map((blocker) => (
              <span
                key={blocker.key}
                title={t(`admin.health.sentences.reasons.${blocker.reason}`)}
                className={cn(
                  "flex h-7 items-center gap-1 rounded-[9px] px-2 text-[13px]",
                  blocker.reason === "later" ? "bg-tint text-ink" : "border-line-2 text-ink-2 border border-dashed",
                )}
              >
                <bdi lang={language} className={cn("lat text-[14px]", blocker.reason === "retired" && "line-through")}>
                  {blocker.label}
                </bdi>
                {blocker.count > 1 ? <span className="text-ink-3 text-[11.5px] tabular-nums">×{formatNumber(blocker.count)}</span> : null}
              </span>
            ))}
            {row.moreBlockers > 0 ? <span className="text-ink-3 text-[12.5px]">{t("admin.health.sentences.moreBlockers", { count: row.moreBlockers })}</span> : null}
          </span>
        </>
      ) : (
        <span className="text-ink-3 col-start-2 text-[13px] sm:col-span-2 sm:col-start-auto">{t("admin.health.sentences.noSentence")}</span>
      )}
    </li>
  );
}

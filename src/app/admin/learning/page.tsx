import Form from "next/form";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { LanguageTabs } from "@/components/admin/language-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { formatDateFa } from "@/lib/format";
import { cn } from "@/lib/utils";
import { tehranDate, tehranDayStart } from "@/engine/time";
import { requireAdmin } from "@/server/auth/session";
import { pickLanguage } from "@/server/content/languages";
import { FEW, FUNNEL, HIGH_MARK, INTERVALS, learningReport, LOW_MARK, STEPS, type Cell } from "@/server/insights/learning";
import { appSetting } from "@/server/settings/read";

export const metadata: Metadata = { title: t("admin.learning.title") };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const DAY = 86_400_000;
/** The period shown when none is asked for. */
const DEFAULT_DAYS = 30;
/** Dialogues and find-the-mistake items are judged from this many answers. */
const ITEM_FEW = 10;
const ITEM_LOW = 0.4;
const ITEM_HIGH = 0.95;
const isDay = (value: string | undefined): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function Card({ title, lead, children, id }: { title: string; lead?: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="bg-surface flex min-w-0 flex-col gap-4 rounded-[22px] p-5 shadow-[var(--shadow-1)] sm:p-6" data-section={id}>
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-ink text-[17px] font-extrabold">
          {title}
        </h2>
        {lead ? <p className="text-ink-2 max-w-[72ch] text-[14px] leading-7">{lead}</p> : null}
      </div>
      {children}
    </section>
  );
}

function GridCell({ cell }: { cell: Cell }) {
  if (cell.n === 0) return <span className="text-ink-3">—</span>;
  const share = cell.ok / cell.n;
  const judged = cell.n >= FEW;
  const tone = !judged ? "text-ink-2" : share < LOW_MARK ? "bg-bad-soft text-bad" : share > HIGH_MARK ? "bg-gender-m/10 text-gender-m" : "bg-ok-soft text-ok";
  return (
    <span
      className={cn("flex flex-col items-center rounded-[12px] px-2 py-1.5", tone)}
      title={judged && share < LOW_MARK ? t("admin.learning.grid.low") : judged && share > HIGH_MARK ? t("admin.learning.grid.high") : undefined}
    >
      <b className="text-[15px] tabular-nums">{t("admin.learning.pct", { n: formatNumber(pct(cell.ok, cell.n)) })}</b>
      <span className="text-[11.5px] tabular-nums opacity-80">{t("admin.learning.grid.answers", { n: formatNumber(cell.n) })}</span>
    </span>
  );
}

/**
 * «یادگیری واقعی» (PRD §13.11): accuracy of graded reviews by step and interval, the first review, each
 * exercise code, learners' common problems, speaking and writing, and where learners stop; in one
 * language, optionally one level, between two dates.
 */
export default async function LearningPage({ searchParams }: PageProps<"/admin/learning">) {
  const admin = await requireAdmin();
  const query = await searchParams;
  const language = pickLanguage(query.lang, admin.admin_language);
  const levels = (await appSetting<string[]>(`levels.${language}`)) ?? [];
  const askedLevel = one(query.level);
  const level = askedLevel && levels.includes(askedLevel) ? askedLevel : null;
  const today = tehranDate(new Date());
  const toDay = isDay(one(query.to)) ? one(query.to)! : today;
  const fromDay = isDay(one(query.from)) && one(query.from)! <= toDay ? one(query.from)! : tehranDate(new Date(tehranDayStart(toDay).getTime() - (DEFAULT_DAYS - 1) * DAY));
  const testers = one(query.testers) === "1";
  const report = await learningReport({ language, level, from: tehranDayStart(fromDay), to: new Date(tehranDayStart(toDay).getTime() + DAY), testers });
  const { learners: who, production } = report;
  const anyAnswers = STEPS.some((step) => INTERVALS.some((bucket) => report.grid[step][bucket].n > 0)) || report.codes.length > 0;

  return (
    <>
      <PageHeader
        title={t("admin.learning.title")}
        lead={t("admin.learning.lead")}
        actions={admin.admin_language === "all" ? <LanguageTabs current={language} path="/admin/learning" /> : null}
      />

      <Form action="/admin/learning" aria-label={t("admin.learning.filters.label")} className="bg-tint/60 flex flex-wrap items-end gap-3 rounded-[20px] px-5 py-4" data-learning-filters>
        <input type="hidden" name="lang" value={language} />
        <label className="flex flex-col gap-1.5 text-[13px] font-bold">
          <span className="text-ink-2">{t("admin.learning.filters.level")}</span>
          <select name="level" defaultValue={level ?? ""} className="bg-surface border-line-2 h-11 rounded-[12px] border px-3 text-[14.5px]">
            <option value="">{t("admin.learning.filters.allLevels")}</option>
            {levels.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-bold">
          <span className="text-ink-2">{t("admin.learning.filters.from")}</span>
          <input type="date" name="from" defaultValue={fromDay} max={today} className="bg-surface border-line-2 h-11 rounded-[12px] border px-3 text-[14.5px]" />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-bold">
          <span className="text-ink-2">{t("admin.learning.filters.to")}</span>
          <input type="date" name="to" defaultValue={toDay} max={today} className="bg-surface border-line-2 h-11 rounded-[12px] border px-3 text-[14.5px]" />
        </label>
        <label className="flex h-11 items-center gap-2 text-[13.5px] font-bold">
          <input type="checkbox" name="testers" value="1" defaultChecked={testers} className="accent-brand size-[18px]" />
          <span className="text-ink-2">{t("admin.learning.filters.testers")}</span>
        </label>
        <Button type="submit">{t("admin.learning.filters.apply")}</Button>
      </Form>

      {!anyAnswers ? <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-8 text-center shadow-[var(--shadow-1)]">{t("admin.learning.none")}</p> : null}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <Card id="grid" title={t("admin.learning.grid.title")} lead={t("admin.learning.grid.lead", { few: formatNumber(FEW) })}>
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[520px] border-separate border-spacing-1.5 text-center text-[13.5px]" data-grid>
              <thead>
                <tr>
                  <th />
                  {INTERVALS.map((bucket) => (
                    <th key={bucket} scope="col" className="text-ink-2 pb-1 font-bold">
                      {t(`admin.learning.grid.intervals.${bucket}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {STEPS.map((step) => (
                  <tr key={step}>
                    <th scope="row" className="text-ink-2 pe-2 text-start font-bold whitespace-nowrap">
                      {t("admin.learning.grid.step", { n: formatNumber(step) })}
                    </th>
                    {INTERVALS.map((bucket) => (
                      <td key={bucket}>
                        <GridCell cell={report.grid[step][bucket]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
          <Card id="first" title={t("admin.learning.first.title")} lead={t("admin.learning.first.lead")}>
            <p className="text-ink text-[22px] font-extrabold tabular-nums" data-first>
              {report.first.n > 0 ? t("admin.learning.first.value", { pct: formatNumber(pct(report.first.ok, report.first.n)), n: formatNumber(report.first.n) }) : "—"}
            </p>
          </Card>

          <Card id="learners" title={t("admin.learning.learners.title")}>
            <dl className="divide-line flex flex-col divide-y text-[14px]">
              {[
                [t("admin.learning.learners.active"), formatNumber(who.active)],
                [t("admin.learning.learners.slow"), who.active ? `${t("admin.learning.pct", { n: formatNumber(pct(who.slow, who.active)) })} (${formatNumber(who.slow)})` : "—"],
                [t("admin.learning.learners.freeze"), who.active ? `${t("admin.learning.pct", { n: formatNumber(pct(who.freeze, who.active)) })} (${formatNumber(who.freeze)})` : "—"],
                [t("admin.learning.learners.sticky"), formatNumber(who.sticky)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 py-2.5">
                  <dt className="text-ink-2">{label}</dt>
                  <dd className="text-ink font-bold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-col gap-2">
              <h3 className="text-ink text-[14.5px] font-extrabold">{t("admin.learning.learners.pairs")}</h3>
              {who.pairs.length === 0 ? (
                <p className="text-ink-3 text-[13.5px]">{t("admin.learning.learners.noPairs")}</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-[14px]">
                  {who.pairs.map((pair) => (
                    <li key={`${pair.a}-${pair.b}`} className="flex items-baseline justify-between gap-3">
                      <span className="lat text-ink" dir="ltr">
                        {pair.a} ↔ {pair.b}
                      </span>
                      <span className="text-ink-3 text-[13px] tabular-nums">{t("admin.learning.learners.pairLine", { count: formatNumber(pair.count), people: formatNumber(pair.people) })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>

        <Card id="codes" title={t("admin.learning.codes.title")} lead={t("admin.learning.codes.lead")}>
          {report.codes.length === 0 ? (
            <p className="text-ink-3 text-[14px]">{t("admin.learning.none")}</p>
          ) : (
            <div className="-mx-1 overflow-x-auto px-1">
              <table className="w-full min-w-[480px] text-[14px]" data-codes>
                <thead className="text-ink-2 text-[13px]">
                  <tr className="border-line border-b">
                    <th scope="col" className="py-2 text-start font-bold">{t("admin.learning.codes.code")}</th>
                    <th scope="col" className="py-2 text-end font-bold">{t("admin.learning.codes.n")}</th>
                    <th scope="col" className="py-2 text-end font-bold">{t("admin.learning.codes.ok")}</th>
                    <th scope="col" className="py-2 text-end font-bold">{t("admin.learning.codes.idk")}</th>
                    <th scope="col" className="py-2 text-end font-bold">{t("admin.learning.codes.time")}</th>
                  </tr>
                </thead>
                <tbody className="divide-line divide-y">
                  {report.codes.map((row) => {
                    const share = row.ok / row.n;
                    return (
                      <tr key={row.code} data-code={row.code}>
                        <th scope="row" className="py-2 text-start font-semibold">
                          <bdi className="lat">{row.code}</bdi>
                        </th>
                        <td className="py-2 text-end tabular-nums">{formatNumber(row.n)}</td>
                        <td className={cn("py-2 text-end font-bold tabular-nums", row.n >= FEW && share < LOW_MARK && "text-bad", row.n >= FEW && share > HIGH_MARK && "text-gender-m")}>
                          {t("admin.learning.pct", { n: formatNumber(pct(row.ok, row.n)) })}
                        </td>
                        <td className="py-2 text-end tabular-nums">{t("admin.learning.pct", { n: formatNumber(pct(row.idk, row.n)) })}</td>
                        <td className="text-ink-2 py-2 text-end tabular-nums">
                          {row.medianMs === null ? "—" : t("admin.learning.codes.seconds", { n: formatNumber(Math.round(row.medianMs / 100) / 10) })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card id="production" title={t("admin.learning.production.title")}>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
            <div className="flex flex-col gap-2">
              <h3 className="text-ink text-[14.5px] font-extrabold">{t("admin.learning.production.speak")}</h3>
              {production.speak.length === 0 ? (
                <p className="text-ink-3 text-[13.5px]">{t("admin.learning.none")}</p>
              ) : (
                <ul className="flex flex-col gap-2.5" data-speak>
                  {production.speak.map((row) => {
                    const total = row.ok + row.near + row.no;
                    return (
                      <li key={row.level} className="flex flex-col gap-1">
                        <span className="flex items-baseline justify-between text-[13.5px]">
                          <bdi className="lat font-semibold">{row.level}</bdi>
                          <span className="text-ink-2 tabular-nums">
                            {t("admin.learning.production.speakOk")} {t("admin.learning.pct", { n: formatNumber(pct(row.ok, total)) })} · {t("admin.learning.production.speakNear")}{" "}
                            {t("admin.learning.pct", { n: formatNumber(pct(row.near, total)) })} · {t("admin.learning.production.speakNo")} {t("admin.learning.pct", { n: formatNumber(pct(row.no, total)) })}
                          </span>
                        </span>
                        <span className="bg-line flex h-2 overflow-hidden rounded-full" aria-hidden>
                          <span className="bg-ok" style={{ width: `${pct(row.ok, total)}%` }} />
                          <span className="bg-teal/50" style={{ width: `${pct(row.near, total)}%` }} />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-ink text-[14.5px] font-extrabold">{t("admin.learning.production.writing")}</h3>
              {production.writing.length === 0 ? (
                <p className="text-ink-3 text-[13.5px]">{t("admin.learning.production.noWriting")}</p>
              ) : (
                <ul className="flex flex-col gap-1.5 text-[14px]">
                  {production.writing.map((row) => (
                    <li key={row.week.toISOString()} className="flex items-baseline justify-between">
                      <span className="text-ink-2">{t("admin.learning.production.week", { date: formatDateFa(row.week) })}</span>
                      <b className="tabular-nums">{formatNumber(row.n)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <h3 className="text-ink text-[14.5px] font-extrabold">{t("admin.learning.production.items")}</h3>
            <p className="text-ink-2 text-[13.5px] leading-6">{t("admin.learning.production.itemsLead", { few: formatNumber(ITEM_FEW) })}</p>
            {production.items.length === 0 ? (
              <p className="text-ink-3 text-[13.5px]">{t("admin.learning.none")}</p>
            ) : (
              <ul className="divide-line flex flex-col divide-y text-[14px]">
                {production.items.map((row) => {
                  const share = row.ok / row.n;
                  const flagged = row.n >= ITEM_FEW && (share < ITEM_LOW || share > ITEM_HIGH);
                  return (
                    <li key={`${row.kind}:${row.id}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2" data-prod={`${row.kind}:${row.id}`}>
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="text-ink-3 text-[12.5px]">{t(`admin.learning.production.kinds.${row.kind}`)}</span>
                        <Link href={`/admin/content/${row.kind === "dialogue" ? "dialogues" : "errorfix"}/${row.id}`} className="text-ink hover:text-brand-text min-w-0 truncate font-semibold hover:underline">
                          {isolateLatin(row.title)}
                        </Link>
                      </span>
                      <span className={cn("tabular-nums", flagged ? (share < ITEM_LOW ? "text-bad font-bold" : "text-gender-m font-bold") : "text-ink-2")}>
                        {t("admin.learning.pct", { n: formatNumber(pct(row.ok, row.n)) })} · {t("admin.learning.grid.answers", { n: formatNumber(row.n) })}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>

        <Card id="funnel" title={t("admin.learning.funnel.title")} lead={t("admin.learning.funnel.lead")}>
          <ol className="flex flex-col gap-2.5" data-funnel>
            {FUNNEL.map((step) => {
              const value = report.funnel[step];
              const share = pct(value, report.funnel.signup);
              return (
                <li key={step} className="grid grid-cols-[9rem_minmax(0,1fr)_5.5rem] items-center gap-3 text-[14px]" data-step={step}>
                  <span className="text-ink-2">{t(`admin.learning.funnel.steps.${step}`)}</span>
                  <span className="bg-line h-2.5 overflow-hidden rounded-full" aria-hidden>
                    <span className="bg-brand block h-full rounded-full" style={{ width: `${share}%` }} />
                  </span>
                  <span className="text-ink text-end font-bold tabular-nums">
                    {formatNumber(value)} <span className="text-ink-3 text-[12.5px] font-medium">({t("admin.learning.pct", { n: formatNumber(share) })})</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    </>
  );
}

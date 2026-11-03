import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/admin/page-header";
import { formatNumber, t } from "@/i18n";
import { formatDateFa } from "@/lib/format";
import { requireAdmin } from "@/server/auth/session";
import { languageCodes } from "@/server/content/languages";
import { contentStatuses, librarySlugs } from "@/server/content/library/slugs";
import { DASH_DAYS, dashboard, ENDING_HOURS } from "@/server/insights/dashboard";

export const metadata: Metadata = { title: t("admin.dashboard.title") };
export const dynamic = "force-dynamic";

const languageName = (code: string) => t(`common.languages.${code as "fr"}`);

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="bg-surface flex flex-col gap-1 rounded-[20px] px-5 py-4 shadow-[var(--shadow-1)]">
      <span className="text-ink-2 text-[13px] font-bold">{label}</span>
      <span className="text-ink text-[26px] leading-tight font-extrabold tabular-nums">{value}</span>
      {sub ? <span className="text-ink-3 text-[12.5px]">{sub}</span> : null}
    </div>
  );
}

/** «داشبورد» (PRD §13.2): sign-ups, free periods ending, subscriptions, sessions per day and content counts. */
export default async function DashboardPage() {
  const admin = await requireAdmin();
  const data = await dashboard();
  const languages = admin.admin_language && admin.admin_language !== "all" ? languageCodes.filter((code) => code === admin.admin_language) : [...languageCodes];
  const days = [...new Set(data.sessions.map((row) => row.day))].sort().reverse();
  const most = Math.max(1, ...days.map((day) => data.sessions.filter((row) => row.day === day).reduce((sum, row) => sum + row.n, 0)));

  return (
    <>
      <PageHeader title={t("admin.dashboard.title")} lead={t("admin.dashboard.lead")} />

      <section aria-labelledby="signups" className="flex flex-col gap-3" data-dash="signups">
        <h2 id="signups" className="text-ink text-[17px] font-extrabold">
          {t("admin.dashboard.signups.title")}
        </h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label={t("admin.dashboard.signups.day")} value={formatNumber(data.signups.day)} />
          <Tile label={t("admin.dashboard.signups.week")} value={formatNumber(data.signups.week)} />
          <Tile label={t("admin.dashboard.signups.month")} value={formatNumber(data.signups.month)} />
          <Tile label={t("admin.dashboard.signups.all")} value={formatNumber(data.signups.all)} />
        </div>
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 md:grid-cols-2">
        <section aria-labelledby="ending" className="flex flex-col gap-3" data-dash="ending">
          <div>
            <h2 id="ending" className="text-ink text-[17px] font-extrabold">
              {t("admin.dashboard.ending.title")}
            </h2>
            <p className="text-ink-2 text-[13.5px]">{t("admin.dashboard.ending.lead", { hours: formatNumber(ENDING_HOURS) })}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {languages.map((code) => (
              <Tile key={code} label={languageName(code)} value={formatNumber(data.ending[code] ?? 0)} />
            ))}
          </div>
        </section>
        <section aria-labelledby="subs" className="flex flex-col gap-3" data-dash="subscriptions">
          <div>
            <h2 id="subs" className="text-ink text-[17px] font-extrabold">
              {t("admin.dashboard.subscriptions.title")}
            </h2>
            <p className="text-ink-2 text-[13.5px]">{t("admin.dashboard.subscriptions.lead")}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {languages.map((code) => (
              <Tile key={code} label={languageName(code)} value={formatNumber(data.subscriptions[code] ?? 0)} />
            ))}
          </div>
        </section>
      </div>

      <section aria-labelledby="sessions" className="bg-surface flex flex-col gap-3 rounded-[22px] p-5 shadow-[var(--shadow-1)] sm:p-6" data-dash="sessions">
        <div>
          <h2 id="sessions" className="text-ink text-[17px] font-extrabold">
            {t("admin.dashboard.sessions.title")}
          </h2>
          <p className="text-ink-2 text-[13.5px]">{t("admin.dashboard.sessions.lead", { days: formatNumber(DASH_DAYS) })}</p>
        </div>
        {days.length === 0 ? (
          <p className="text-ink-3 text-[14px]">{t("admin.dashboard.sessions.none")}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {days.map((day) => {
              const rows = data.sessions.filter((row) => row.day === day);
              const n = rows.reduce((sum, row) => sum + row.n, 0);
              const people = rows.reduce((sum, row) => sum + row.people, 0);
              return (
                <li key={day} className="grid grid-cols-[7.5rem_minmax(0,1fr)_8.5rem] items-center gap-3 text-[13.5px]" data-day={day}>
                  <span className="text-ink-2 tabular-nums">{formatDateFa(new Date(`${day}T12:00:00Z`))}</span>
                  <span className="bg-line h-2.5 overflow-hidden rounded-full" aria-hidden>
                    <span className="bg-brand block h-full rounded-full" style={{ width: `${Math.round((n / most) * 100)}%` }} />
                  </span>
                  <span className="text-ink text-end tabular-nums">{t("admin.dashboard.sessions.line", { n: formatNumber(n), people: formatNumber(people) })}</span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {data.content
        .filter((block) => languages.includes(block.language))
        .map((block) => {
          const levels = [...new Set(block.rows.map((row) => row.level))].sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));
          const statuses = contentStatuses.filter((status) => block.rows.some((row) => row.status === status));
          const count = (slug: string, status: string) => block.rows.filter((row) => row.slug === slug && row.status === status).reduce((sum, row) => sum + row.n, 0);
          return (
            <section key={block.language} aria-labelledby={`content-${block.language}`} className="bg-surface flex flex-col gap-4 rounded-[22px] p-5 shadow-[var(--shadow-1)] sm:p-6" data-dash={`content-${block.language}`}>
              <div>
                <h2 id={`content-${block.language}`} className="text-ink text-[17px] font-extrabold">
                  {t("admin.dashboard.content.title")} · {languageName(block.language)}
                </h2>
                <p className="text-ink-2 text-[13.5px]">{t("admin.dashboard.content.lead")}</p>
              </div>
              {statuses.length === 0 ? (
                <p className="text-ink-3 text-[14px]">—</p>
              ) : (
                <div className="-mx-1 overflow-x-auto px-1">
                  <table className="w-full min-w-[560px] text-[13.5px]">
                    <thead className="text-ink-2 text-[12.5px]">
                      <tr className="border-line border-b">
                        <th scope="col" className="py-2 text-start font-bold">{t("admin.dashboard.content.type")}</th>
                        {statuses.map((status) => (
                          <th key={status} scope="col" className="py-2 text-end font-bold">{t(`admin.library.statuses.${status}`)}</th>
                        ))}
                        <th scope="col" className="py-2 text-end font-bold">{t("admin.dashboard.content.total")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-line divide-y">
                      {librarySlugs.map((slug) => {
                        const total = statuses.reduce((sum, status) => sum + count(slug, status), 0);
                        if (total === 0) return null;
                        const byLevel = levels
                          .map((level) => ({ level, n: block.rows.filter((row) => row.slug === slug && row.level === level).reduce((sum, row) => sum + row.n, 0) }))
                          .filter((item) => item.n > 0);
                        return (
                          <tr key={slug} data-content-row={slug}>
                            <th scope="row" className="py-2 text-start font-semibold">
                              {t(`admin.library.types.${slug}`)}
                              <span className="text-ink-3 block text-[12px] font-normal">
                                {byLevel.map((item) => `${item.level ?? t("admin.dashboard.content.noLevel")}: ${formatNumber(item.n)}`).join(" · ")}
                              </span>
                            </th>
                            {statuses.map((status) => (
                              <td key={status} className="py-2 text-end tabular-nums">
                                {count(slug, status) ? formatNumber(count(slug, status)) : <span className="text-ink-3">—</span>}
                              </td>
                            ))}
                            <td className="py-2 text-end font-bold tabular-nums">{formatNumber(total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          );
        })}
    </>
  );
}

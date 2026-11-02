import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { formatNumber, t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import type { HomeData } from "@/server/learn/home";
import type { NextLine } from "@/server/learn/rehearse";

/** Step 2: the account today, as its home screen counts it, and the way into the app. */
export function NowCard({ language, home }: { language: string; home: HomeData | null }) {
  return (
    <section aria-labelledby="now" className="flex flex-col gap-3">
      <h2 id="now" className="text-ink text-[19px] font-extrabold">
        {t("admin.rehearse.nowTitle")}
      </h2>
      {home ? (
        <div className="bg-surface flex flex-col gap-4 rounded-[22px] px-5 py-5 shadow-[var(--shadow-1)]">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
            <Fact label={t("admin.rehearse.streak")} value={home.streak.count} />
            <Fact label={t("admin.rehearse.words")} value={home.skills.find((tile) => tile.skill === "vocab")?.introduced ?? 0} />
            <Fact label={t("admin.rehearse.lessons")} value={home.skills.find((tile) => tile.skill === "grammar")?.introduced ?? 0} />
            <Fact label={t("admin.rehearse.due")} value={home.skills.reduce((sum, tile) => sum + tile.due, 0)} />
            <Fact label={t("admin.rehearse.notebook")} value={home.links.notebook} />
          </dl>
          <p className="text-ink-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
            <span className="font-bold">{t("admin.rehearse.levels")}:</span>
            {home.skills.map((tile) => (
              <span key={tile.skill}>
                {t(`admin.rehearse.skills.${tile.skill}`)} <bdi className="lat">{isolateLatin(tile.level)}</bdi>
              </span>
            ))}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href={`/learn/${language}`}
              target="_blank"
              className="bg-brand text-on-brand flex h-11 items-center gap-2 rounded-[14px] px-5 text-[15px] font-bold shadow-[var(--btn-glow)]"
            >
              <ExternalLink className="size-4.5" strokeWidth={1.75} aria-hidden />
              {t("admin.rehearse.open")}
            </Link>
            <p className="text-ink-3 max-w-[56ch] text-[13px] leading-6">{t("admin.rehearse.openHint")}</p>
          </div>
        </div>
      ) : (
        <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-8 text-center shadow-[var(--shadow-1)]">{t("admin.rehearse.notStarted")}</p>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-ink-3 text-[12.5px]">{label}</dt>
      <dd className="text-ink text-[22px] font-extrabold tabular-nums">{formatNumber(value)}</dd>
    </div>
  );
}

/** Step 3: what «شروع» would bring now, item by item. */
export function NextList({ language, next }: { language: string; next: { minutes: number; empty: boolean; lines: NextLine[] } | null }) {
  return (
    <section aria-labelledby="next" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="next" className="text-ink text-[19px] font-extrabold">
          {t("admin.rehearse.nextTitle")}
        </h2>
        <p className="text-ink-2 max-w-[68ch] text-[14.5px] leading-7">{t("admin.rehearse.nextLead")}</p>
      </div>
      {!next || next.empty ? (
        <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-6 shadow-[var(--shadow-1)]">{t("admin.rehearse.nextEmpty")}</p>
      ) : (
        <ol className="bg-surface rounded-[22px] shadow-[var(--shadow-1)]">
          {next.lines.map((line, index) => (
            <li key={index} className="border-line grid grid-cols-[2rem_9.5rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b px-5 py-2.5 last:border-b-0">
              <span className="text-ink-3 text-[12.5px] tabular-nums">{formatNumber(index + 1)}</span>
              <span className="text-ink-2 text-[13.5px] font-bold">{t(`admin.rehearse.kinds.${line.kind}`)}</span>
              <span className="text-ink min-w-0 truncate text-[15px]">
                {line.kind === "notebook" || line.kind === "newUnit" || line.kind === "unit" || line.kind === "phonics" || line.kind === "text" ? (
                  line.name
                ) : (
                  <bdi lang={language} dir="ltr" className="lat">
                    {line.name}
                  </bdi>
                )}
              </span>
              <span className="text-ink-3 text-[12.5px] tabular-nums">{line.count > 1 ? t("admin.rehearse.times", { n: line.count }) : null}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

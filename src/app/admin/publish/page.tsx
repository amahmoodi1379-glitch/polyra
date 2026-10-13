import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CircleCheck, CircleX, Eye, EyeOff, Lock, LockOpen, Send } from "lucide-react";
import { joinDots } from "@/components/admin/join-dots";
import { LanguageTabs } from "@/components/admin/language-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { Voiced } from "@/components/admin/voiced";
import { formatNumber, t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { formatDateTimeFa } from "@/lib/format";
import { formatMobileFa } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { languageInfo, pickLanguage, type LanguageCode } from "@/server/content/languages";
import { librarySlugs, type LibrarySlug } from "@/server/content/library/slugs";
import type { CheckedItem } from "@/server/content/publish/checks";
import { languageState, type CheckLine, type LevelState } from "@/server/content/publish/levels";
import { previewPublish } from "@/server/content/publish/run";
import { itemHref, libraryHref } from "../content/links";
import { liveAction, publishAction, releaseAction } from "./actions";
import { ConfirmButton } from "./confirm-button";

export const metadata: Metadata = { title: t("admin.publish.title") };

/** Blocked items shown per type before pointing to the library. */
const SHOWN_PER_TYPE = 8;

/**
 * «انتشار» (PRD §13.2, §13.5): publish every ready approved item in one go, then open levels and
 * the language to ordinary learners. The tester account sees approved content all along.
 */
export default async function PublishPage({ searchParams }: PageProps<"/admin/publish">) {
  const admin = await requireAdmin();
  const query = await searchParams;
  const language = pickLanguage(query.lang, admin.admin_language);
  const [preview, state] = await Promise.all([previewPublish(language), languageState(language)]);

  return (
    <>
      <PageHeader title={t("admin.publish.title")} lead={t("admin.publish.lead")} actions={<LanguageTabs current={language} path="/admin/publish" />} />

      <div className="flex flex-col gap-10">
        <ItemsSection language={language} ready={preview.ready} blocked={preview.blocked} />
        <LevelsSection language={language} levels={state.levels} live={state.live} />
        <LanguageSection language={language} live={state.live} firstLevel={state.firstLevel} firstOpen={state.firstOpen} />
      </div>
    </>
  );
}

function SectionHead({ id, title, lead }: { id: string; title: string; lead?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 id={id} className="text-ink text-[19px] leading-tight font-extrabold">
        {title}
      </h2>
      {lead ? <p className="text-ink-2 max-w-[68ch] text-[14px] leading-6">{lead}</p> : null}
    </div>
  );
}

function ItemsSection({ language, ready, blocked }: { language: LanguageCode; ready: CheckedItem[]; blocked: CheckedItem[] }) {
  const count = (list: CheckedItem[], slug: LibrarySlug) => list.filter((item) => item.slug === slug).length;
  const types = librarySlugs.filter((slug) => count(ready, slug) + count(blocked, slug) > 0);

  return (
    <section aria-labelledby="items-title" className="flex flex-col gap-4">
      <SectionHead id="items-title" title={t("admin.publish.items.title")} lead={t("admin.publish.items.lead")} />

      {types.length === 0 ? (
        <div className="bg-surface flex flex-wrap items-center justify-between gap-4 rounded-[22px] px-6 py-6 shadow-[var(--shadow-1)]">
          <p className="text-ink-2 max-w-[60ch]">{t("admin.publish.items.none")}</p>
          <Link href={libraryHref({ language, type: "words" })} className="text-brand-text text-[14px] font-bold hover:underline">
            {t("admin.publish.items.toLibrary")}
          </Link>
        </div>
      ) : (
        <div className="bg-surface flex flex-col rounded-[22px] shadow-[var(--shadow-1)]">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5 px-5 pt-5 pb-5 sm:px-6">
            <dl className="flex flex-wrap gap-x-10 gap-y-3">
              <Stat value={ready.length} label={t("admin.publish.items.readyLabel")} tone={ready.length > 0 ? "brand" : "quiet"} />
              <Stat value={blocked.length} label={t("admin.publish.items.blockedLabel")} tone="quiet" />
            </dl>
            {ready.length > 0 ? (
              <ConfirmButton
                label={t("admin.publish.items.publish")}
                icon={<Send strokeWidth={2} aria-hidden className="rtl:-scale-x-100" />}
                title={t("admin.publish.items.confirmTitle", { count: ready.length })}
                description={t("admin.publish.items.confirm")}
                confirmLabel={t("admin.publish.items.confirmYes")}
                run={publishAction.bind(null, language)}
              />
            ) : (
              <p className="text-ink-2 max-w-[34ch] text-[13.5px] leading-6">{t("admin.publish.items.noneReady")}</p>
            )}
          </div>

          <div className="border-line overflow-x-auto border-t">
            <table className="w-full max-w-[38rem] min-w-[20rem] text-[14px]" aria-label={t("admin.publish.items.tableLabel")}>
              <thead>
                <tr className="text-ink-3 text-[12.5px]">
                  <th scope="col" className="px-5 py-2.5 text-start font-bold sm:px-6">
                    {t("admin.publish.items.colType")}
                  </th>
                  <th scope="col" className="w-20 px-3 py-2.5 text-end font-bold sm:w-28">
                    {t("admin.publish.items.colReady")}
                  </th>
                  <th scope="col" className="w-20 px-5 py-2.5 text-end font-bold sm:w-28 sm:px-6">
                    {t("admin.publish.items.colBlocked")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {types.map((slug) => (
                  <tr key={slug} className="border-line border-t">
                    <th scope="row" className="text-ink px-5 py-2.5 text-start font-bold sm:px-6">
                      {t(`admin.library.types.${slug}`)}
                    </th>
                    <td className={cn("px-3 py-2.5 text-end tabular-nums", count(ready, slug) ? "text-brand-text font-bold" : "text-ink-3")}>{formatNumber(count(ready, slug))}</td>
                    <td className={cn("px-5 py-2.5 text-end tabular-nums sm:px-6", count(blocked, slug) ? "text-ink-2" : "text-ink-3")}>{formatNumber(count(blocked, slug))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {blocked.length > 0 ? (
            <div className="border-line flex flex-col gap-5 border-t px-5 py-5 sm:px-6">
              <h3 className="text-ink text-[15px] font-extrabold">{t("admin.publish.items.blockedTitle")}</h3>
              {types
                .filter((slug) => count(blocked, slug) > 0)
                .map((slug) => {
                  const list = blocked.filter((item) => item.slug === slug);
                  return (
                    <div key={slug} className="flex flex-col gap-1">
                      <h4 className="text-ink-3 text-[12.5px] font-bold">
                        {t(`admin.library.types.${slug}`)} <span className="tabular-nums">({formatNumber(list.length)})</span>
                      </h4>
                      <ul className="flex flex-col">
                        {list.slice(0, SHOWN_PER_TYPE).map((item) => (
                          <BlockedRow key={item.id} item={item} language={language} />
                        ))}
                      </ul>
                      {list.length > SHOWN_PER_TYPE ? (
                        <Link href={libraryHref({ language, type: slug, status: "approved" })} className="text-brand-text self-start text-[13px] font-bold hover:underline">
                          {t("admin.publish.items.more", { count: list.length - SHOWN_PER_TYPE })}
                        </Link>
                      ) : null}
                    </div>
                  );
                })}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Stat({ value, label, tone }: { value: number; label: string; tone: "brand" | "quiet" }) {
  return (
    <div className="flex flex-col-reverse gap-0.5">
      <dt className="text-ink-2 text-[13px]">{label}</dt>
      <dd className={cn("text-[30px] leading-none font-extrabold tabular-nums", tone === "brand" ? "text-brand-text" : value === 0 ? "text-ink-3" : "text-ink")}>
        {formatNumber(value)}
      </dd>
    </div>
  );
}

function BlockedRow({ item, language }: { item: CheckedItem; language: string }) {
  return (
    <li className="border-line flex items-baseline gap-3 border-b py-2 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-4">
        <Link href={itemHref(item.slug, item.id)} className="text-ink hover:text-brand-text min-w-0 shrink-0 truncate transition-colors sm:max-w-[45%]">
          <Voiced text={item.title} voice={item.voice} language={language} className={item.voice === "target" ? "text-[15.5px]" : "text-[14px] font-bold"} />
        </Link>
        <p className="text-ink-2 min-w-0 text-[13px] leading-6">{joinDots(item.reasons)}</p>
      </div>
      {item.level ? <bdi className="lat text-ink-3 shrink-0 text-[12.5px] font-semibold">{item.level}</bdi> : null}
    </li>
  );
}

function LevelsSection({ language, levels, live }: { language: LanguageCode; levels: LevelState[]; live: boolean }) {
  return (
    <section aria-labelledby="levels-title" className="flex flex-col gap-4">
      <SectionHead id="levels-title" title={t("admin.publish.levels.title")} lead={t("admin.publish.levels.lead")} />
      <ol className="flex flex-col gap-3">
        {levels.map((level, index) => (
          <LevelCard key={level.level} language={language} state={level} previous={levels[index - 1]?.level} next={levels[index + 1]?.level} first={index === 0} live={live} />
        ))}
      </ol>
    </section>
  );
}

function LevelCard({
  language,
  state,
  previous,
  next,
  first,
  live,
}: {
  language: LanguageCode;
  state: LevelState;
  previous?: string;
  next?: string;
  first: boolean;
  live: boolean;
}) {
  const { level, released } = state;
  const waiting = !released && !state.lowerOpen;
  const blocking = state.lines.some((line) => line.kind === "block" && !line.ok);
  const warnings = state.lines.filter((line) => line.kind === "warn" && !line.ok);
  const hint = released
    ? state.higherOpen
      ? t("admin.publish.levels.needHigherClosed", { level: next ?? "" })
      : first && live
        ? t("admin.publish.levels.needNotLive")
        : null
    : waiting
      ? t("admin.publish.levels.needLower", { level: previous ?? "" })
      : blocking
        ? t("admin.publish.levels.blocking")
        : null;
  const canAct = released ? !state.higherOpen && !(first && live) : !waiting && !blocking;

  return (
    <li className={cn("bg-surface flex flex-col rounded-[22px] shadow-[var(--shadow-1)]", waiting && "bg-surface/60 shadow-none")}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h3 className={cn("lat text-[26px] leading-none font-semibold", waiting ? "text-ink-3" : "text-ink")}>{level}</h3>
          <span
            className={cn(
              "flex h-6 items-center gap-1.5 rounded-[8px] px-2 text-[12px] font-bold",
              released ? "text-ok bg-[color-mix(in_oklab,var(--ok),transparent_86%)]" : "bg-tint text-ink-2",
            )}
          >
            {released ? <LockOpen className="size-3.5" strokeWidth={2.25} aria-hidden /> : <Lock className="size-3.5" strokeWidth={2.25} aria-hidden />}
            {released ? t("admin.publish.levels.open") : t("admin.publish.levels.closed")}
          </span>
          {released ? (
            <span className="text-ink-3 text-[12.5px] tabular-nums">
              {t("admin.publish.levels.since", { date: formatDateTimeFa(released.at), who: released.by ? formatMobileFa(released.by) : t("admin.log.byUnknown") })}
            </span>
          ) : null}
          {waiting ? <span className="text-ink-3 text-[13px]">{isolateLatin(hint ?? "")}</span> : null}
        </div>
        {waiting ? null : released ? (
          <ConfirmButton
            label={t("admin.publish.levels.close", { level })}
            icon={<Lock strokeWidth={2} aria-hidden />}
            variant="outline"
            disabled={!canAct}
            title={t("admin.publish.levels.confirmCloseTitle", { level })}
            description={t("admin.publish.levels.confirmClose")}
            confirmLabel={t("admin.publish.levels.confirmCloseYes")}
            run={releaseAction.bind(null, language, level, false, false)}
          />
        ) : (
          <ConfirmButton
            label={t("admin.publish.levels.release", { level })}
            icon={<LockOpen strokeWidth={2} aria-hidden />}
            variant={canAct ? "default" : "secondary"}
            disabled={!canAct}
            title={t("admin.publish.levels.confirmOpenTitle", { level })}
            description={t("admin.publish.levels.confirmOpen")}
            list={warnings.flatMap((line) => [line.text, ...line.details])}
            listLead={warnings.length ? t("admin.publish.levels.warnings") : undefined}
            confirmLabel={warnings.length ? t("admin.publish.levels.confirmOpenAnyway") : t("admin.publish.levels.confirmOpenYes")}
            run={releaseAction.bind(null, language, level, true, true)}
          />
        )}
      </div>

      {state.lines.length > 0 ? (
        <div className="border-line flex flex-col gap-3 border-t px-5 py-4 sm:px-6">
          <ul aria-label={t("admin.publish.levels.checklistLabel", { level })} className="gap-x-10 lg:columns-2 [&>li]:mb-3 [&>li]:break-inside-avoid">
            {state.lines.map((line) => (
              <Line key={line.key} line={line} />
            ))}
          </ul>
          {hint ? <p className="text-ink-3 text-[12.5px] leading-5">{isolateLatin(hint)}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

function Line({ line }: { line: CheckLine }) {
  const Icon = line.ok ? CircleCheck : line.kind === "block" ? CircleX : AlertTriangle;
  return (
    <li className="flex items-start gap-2.5">
      <Icon className={cn("mt-0.5 size-[18px] shrink-0", line.ok ? "text-ok" : line.kind === "block" ? "text-bad" : "text-idk")} strokeWidth={2} aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <p className={cn("text-[14px] leading-6", line.ok ? "text-ink-2" : "text-ink font-bold")}>
          <span className="sr-only">{line.ok ? "" : `${line.kind === "block" ? t("admin.publish.levels.blockLabel") : t("admin.publish.levels.warnLabel")}: `}</span>
          {line.text}
        </p>
        {!line.ok && line.details.length > 0 ? (
          <ul className="text-ink-2 flex flex-col gap-0.5 text-[13px] leading-6">
            {line.details.map((detail) => (
              <li key={detail} className="min-w-0 break-words">
                {detail}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function LanguageSection({ language, live, firstLevel, firstOpen }: { language: LanguageCode; live: boolean; firstLevel: string; firstOpen: boolean }) {
  const name = languageInfo[language].name_fa;
  return (
    <section aria-labelledby="language-title" className="flex flex-col gap-4">
      <SectionHead id="language-title" title={t("admin.publish.language.title")} />
      <div className="bg-surface flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-[22px] px-5 py-5 shadow-[var(--shadow-1)] sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "mt-1 flex size-9 shrink-0 items-center justify-center rounded-full",
              live ? "bg-[color-mix(in_oklab,var(--ok),transparent_86%)] text-ok" : "bg-tint text-ink-3",
            )}
          >
            {live ? <Eye className="size-[18px]" strokeWidth={2} aria-hidden /> : <EyeOff className="size-[18px]" strokeWidth={2} aria-hidden />}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-ink text-[15px] font-extrabold">{t(live ? "admin.publish.language.on" : "admin.publish.language.off", { language: name })}</p>
            <p className="text-ink-2 text-[13.5px] leading-6">{t(live ? "admin.publish.language.onHint" : "admin.publish.language.offHint")}</p>
          </div>
        </div>
        <div className="flex flex-col items-start gap-1.5">
          {live ? (
            <ConfirmButton
              label={t("admin.publish.language.hide", { language: name })}
              icon={<EyeOff strokeWidth={2} aria-hidden />}
              variant="outline"
              title={t("admin.publish.language.confirmHideTitle", { language: name })}
              description={t("admin.publish.language.confirmHide")}
              confirmLabel={t("admin.publish.language.confirmHideYes")}
              run={liveAction.bind(null, language, false)}
            />
          ) : (
            <ConfirmButton
              label={t("admin.publish.language.show", { language: name })}
              icon={<Eye strokeWidth={2} aria-hidden />}
              variant={firstOpen ? "default" : "secondary"}
              disabled={!firstOpen}
              title={t("admin.publish.language.confirmShowTitle", { language: name })}
              description={t("admin.publish.language.confirmShow")}
              confirmLabel={t("admin.publish.language.confirmShowYes")}
              run={liveAction.bind(null, language, true)}
            />
          )}
          {!live && !firstOpen ? <p className="text-ink-3 text-[12.5px]">{isolateLatin(t("admin.publish.language.needFirst", { level: firstLevel }))}</p> : null}
        </div>
      </div>
    </section>
  );
}

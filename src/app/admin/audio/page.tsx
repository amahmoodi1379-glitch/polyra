import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AudioRow } from "@/components/admin/audio/slot-controls";
import { LanguageTabs } from "@/components/admin/language-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { audioCounts, audioList, audioTabs, audioTypes, isAudioTab, isAudioType, type AudioTab, type AudioType } from "@/server/content/audio/lists";
import type { SlotView } from "@/server/content/audio/view";
import { pickLanguage } from "@/server/content/languages";
import { itemHref } from "../content/links";
import { BulkUpload } from "./bulk-upload";

export const metadata: Metadata = { title: t("admin.nav.audio") };

type Tab = AudioTab | "upload";
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function audioHref(language: string, tab: Tab, type?: AudioType, page = 1) {
  const params = new URLSearchParams({ lang: language, tab });
  if (type) params.set("type", type);
  if (page > 1) params.set("page", String(page));
  return `/admin/audio?${params}`;
}

const slugOf = { word: "words", sentence: "sentences", text: "texts", phonics: "phonics" } as const;

/** What a row says above its text: the level, or which item of a phonics lesson it is. */
function rowLabel(slot: SlotView) {
  if (slot.kind === "phonics" && slot.part && slot.index !== null) return t(`admin.audio.parts.${slot.part}`, { number: slot.index + 1 });
  return slot.level ?? undefined;
}

/**
 * «صدا» (PRD §13.2, §13.8): files waiting to be heard, stale files to record again, places without a
 * file, and bulk upload. The phone's voice reads every place that has no file.
 */
export default async function AudioPage({ searchParams }: PageProps<"/admin/audio">) {
  const admin = await requireAdmin();
  const query = await searchParams;
  const language = pickLanguage(query.lang, admin.admin_language);
  const tabParam = one(query.tab);
  const tab: Tab = tabParam === "upload" ? "upload" : isAudioTab(tabParam) ? tabParam : "listen";
  const counts = await audioCounts(language);
  const total = (name: AudioTab) => audioTypes.reduce((sum, type) => sum + counts[name][type], 0);

  return (
    <>
      <PageHeader title={t("admin.nav.audio")} lead={t("admin.audio.page.lead")} actions={<LanguageTabs current={language} path={`/admin/audio?tab=${tab}`} />} />

      <div className="flex flex-col gap-5">
        <nav aria-label={t("admin.audio.page.tabsLabel")} className="-mx-5 overflow-x-auto px-5 pb-1 lg:mx-0 lg:overflow-visible lg:px-0">
          <ul className="flex w-max gap-1.5">
            {[...audioTabs, "upload" as const].map((item) => (
              <li key={item}>
                <Link
                  href={audioHref(language, item)}
                  aria-current={item === tab ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center gap-2 rounded-[13px] px-4 text-[14px] font-bold whitespace-nowrap transition-[background-color,color] duration-150",
                    item === tab ? "bg-tint text-brand-text" : "bg-surface text-ink-2 hover:text-ink shadow-[var(--shadow-1)]",
                  )}
                >
                  {t(`admin.audio.page.tabs.${item}`)}
                  {item !== "upload" ? (
                    <span className={cn("text-[12.5px] tabular-nums", item === tab ? "text-brand-text" : "text-ink-3")}>{formatNumber(total(item))}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {tab === "upload" ? (
          <BulkUpload language={language} />
        ) : (
          <TabList language={language} tab={tab} counts={counts[tab]} typeParam={one(query.type)} page={Number(one(query.page)) || 1} />
        )}
      </div>
    </>
  );
}

async function TabList({ language, tab, counts, typeParam, page }: { language: string; tab: AudioTab; counts: Record<AudioType, number>; typeParam?: string; page: number }) {
  // The type asked for, else the first one with something in it.
  const type: AudioType = isAudioType(typeParam) ? typeParam : (audioTypes.find((item) => counts[item] > 0) ?? "words");
  const list = await audioList(language, tab, type, page);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3">
        <p className="text-ink-2 max-w-[68ch] text-[14px] leading-6">{t(`admin.audio.page.leads.${tab}`)}</p>
        <nav aria-label={t("admin.audio.page.typesLabel")} className="-mx-5 overflow-x-auto px-5 pb-1 lg:mx-0 lg:px-0">
          <ul className="flex w-max gap-1.5">
            {audioTypes.map((item) => (
              <li key={item}>
                <Link
                  href={audioHref(language, tab, item)}
                  scroll={false}
                  aria-current={item === type ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-1.5 rounded-[12px] border px-3 text-[13.5px] font-bold whitespace-nowrap transition-colors",
                    item === type ? "border-brand text-brand-text bg-surface" : "border-line-2 text-ink-2 hover:text-ink",
                  )}
                >
                  {t(`admin.audio.page.types.${item}`)}
                  <span className="text-ink-3 text-[12px] tabular-nums">{formatNumber(counts[item])}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      {list.items.length === 0 ? (
        <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-10 text-center shadow-[var(--shadow-1)]">
          {t(`admin.audio.page.empty.${tab}`, { type: t(`admin.audio.page.types.${type}`) })}
        </p>
      ) : (
        <div className="bg-surface rounded-[22px] px-5 shadow-[var(--shadow-1)] sm:px-6">
          <ol className="divide-line flex flex-col divide-y">
            {list.items.map((slot) => (
              <AudioRow key={slot.key} slot={slot} language={language} label={rowLabel(slot)} href={itemHref(slugOf[slot.kind], slot.id)} />
            ))}
          </ol>
        </div>
      )}

      {list.pages > 1 ? (
        <nav className="flex items-center justify-between gap-3" aria-label={t("admin.audio.page.pageOf", { page: list.page, pages: list.pages })}>
          <Button asChild variant="outline" size="sm" className={cn(list.page <= 1 && "pointer-events-none opacity-40")}>
            <Link href={audioHref(language, tab, type, list.page - 1)} aria-disabled={list.page <= 1}>
              <ChevronRight className="ltr:rotate-180" strokeWidth={2} aria-hidden />
              {t("admin.audio.page.previous")}
            </Link>
          </Button>
          <span className="text-ink-3 text-[13.5px] font-bold">{t("admin.audio.page.pageOf", { page: list.page, pages: list.pages })}</span>
          <Button asChild variant="outline" size="sm" className={cn(list.page >= list.pages && "pointer-events-none opacity-40")}>
            <Link href={audioHref(language, tab, type, list.page + 1)} aria-disabled={list.page >= list.pages}>
              {t("admin.audio.page.next")}
              <ChevronLeft className="ltr:rotate-180" strokeWidth={2} aria-hidden />
            </Link>
          </Button>
        </nav>
      ) : null}
    </section>
  );
}

import type { Metadata } from "next";
import Link from "@/components/admin/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { ItemAudioPanel } from "@/components/admin/audio/item-audio";
import { LearnerPreview } from "@/components/admin/review/learner-preview";
import { FindingList, QaMark } from "@/components/admin/qa-mark";
import { LevelChip, StatusChip } from "@/components/admin/status-chip";
import { Voiced } from "@/components/admin/voiced";
import { formatNumber, t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { itemAudio } from "@/server/content/audio/view";
import { editors } from "@/server/content/library/edit";
import type { ItemView } from "@/server/content/library/edit/types";
import { entityOf, isLibrarySlug, type LibrarySlug } from "@/server/content/library/slugs";
import { findingMark, findingsOf } from "@/server/content/review/findings";
import { previewItem } from "@/server/content/review/preview";
import type { EntityRef } from "@/server/content/report";
import { appSetting } from "@/server/settings/read";
import { libraryHref } from "../../links";
import { ItemAside } from "./aside";
import { ItemActions } from "./item-actions";
import { ItemForm } from "./item-form";

type Params = { type: string; id: string };

const PREVIEWED = new Set<LibrarySlug>(["dialogues", "errorfix", "writing"]);

async function load(params: Promise<Params>) {
  const { type, id } = await params;
  const itemId = Number(id);
  if (!isLibrarySlug(type) || !Number.isInteger(itemId) || itemId <= 0) return null;
  const loaded = await editors[type].load(itemId);
  return loaded ? { slug: type as LibrarySlug, id: itemId, loaded } : null;
}

export async function generateMetadata({ params }: PageProps<"/admin/content/[type]/[id]">): Promise<Metadata> {
  await requireAdmin();
  const item = await load(params);
  return { title: item ? `${item.loaded.view.title.slice(0, 60)} · ${t(`admin.library.types.${item.slug}`)}` : t("admin.library.title") };
}

/**
 * One item of the library (PRD §13.2 «فرم ویرایش»): its status and what can be done with it at the
 * top, the form in the middle, and where it came from and what depends on it at the side.
 */
export default async function ItemPage({ params }: PageProps<"/admin/content/[type]/[id]">) {
  await requireAdmin();
  const item = await load(params);
  if (!item) notFound();
  const { slug, id, loaded } = item;
  const { view, language } = loaded;
  const levels = await appSetting<string[]>(`levels.${language}`);
  // Audio (PRD §13.8): a word's or a sentence's sits at the side, a text's and a lesson's under the form.
  const audio = view.status === "retired" ? null : await itemAudio(slug, id);
  const audioPanel = audio ? <ItemAudioPanel audio={audio} language={language} /> : null;
  const audioAside = audio?.kind === "single";
  // What the quality check found stays in sight until the item is approved (PRD §13.9).
  const early = view.status === "draft" || view.status === "needs_review";
  const findings = early ? ((await findingsOf(entityOf[slug] as EntityRef["type"], [id])).get(id) ?? []) : [];
  const mark = findingMark(findings);
  // The speaking and writing screens, as in «بازبینی», at any status: an approved item leaves the review queue.
  const preview = view.status !== "retired" && PREVIEWED.has(slug) ? await previewItem(slug, language, id) : null;

  return (
    <>
      <header className="flex flex-col gap-4">
        <Link
          href={libraryHref({ language, type: slug })}
          className="text-ink-3 hover:text-ink -ms-1 flex w-fit items-center gap-1 rounded-[10px] py-1 pe-2 text-[13.5px] font-bold transition-colors"
        >
          <ChevronRight className="size-4 ltr:rotate-180" strokeWidth={2} aria-hidden />
          {t(`admin.library.types.${slug}`)}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
          <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-3">
            <h1 className="min-w-0">
              <Voiced
                text={view.title}
                voice={view.titleVoice}
                language={language}
                className={cn("text-ink inline-block max-w-full", view.titleVoice === "target" ? "text-[28px] leading-tight sm:text-[32px]" : "text-[22px] leading-snug font-extrabold sm:text-2xl")}
              />
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              {view.level ? <LevelChip level={view.level} /> : null}
              <StatusChip status={view.status} suspended={view.suspended} />
              {mark ? <QaMark count={mark.count} severity={mark.severity} /> : null}
              <StatusNote view={view} />
            </div>
          </div>
          <ItemActions slug={slug} id={id} language={language} status={view.status} suspended={view.suspended} />
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          {findings.length > 0 ? (
            <section className="flex flex-col gap-2.5" aria-labelledby="qa-title">
              <h2 id="qa-title" className="text-ink text-[15px] font-extrabold">
                {t("admin.review.findings", { count: formatNumber(findings.length) })}
              </h2>
              <FindingList findings={findings} />
            </section>
          ) : null}
          <ItemForm slug={slug} id={id} language={language} values={loaded.values} context={loaded.context} levels={levels} readOnly={view.status === "retired"} />
          {audioAside ? null : audioPanel}
          {preview ? (
            <details id="learner" className="bg-surface rounded-[22px] px-5 py-4 shadow-[var(--shadow-1)]" open>
              <summary className="text-ink cursor-pointer text-[15px] font-extrabold">{t("admin.review.preview.title")}</summary>
              <div className="flex justify-center pt-4">
                {preview.state === "ready" ? (
                  <LearnerPreview preview={preview} languageName={t(`common.languages.${language}` as MessageKey)} itemKey={`${slug}-${id}`} />
                ) : (
                  <p className="text-ink-2 text-[14px] leading-7">{t(`admin.review.preview.${preview.reason}`)}</p>
                )}
              </div>
            </details>
          ) : null}
        </div>
        <ItemAside slug={slug} language={language} view={view} context={loaded.context} top={audioAside ? audioPanel : null} />
      </div>
    </>
  );
}

function StatusNote({ view }: { view: ItemView }) {
  const text = view.suspended ? t("admin.library.item.suspended") : view.status === "published" ? t("admin.library.item.published") : null;
  return text ? <span className="text-ink-3 text-[13px] leading-6">{text}</span> : null;
}

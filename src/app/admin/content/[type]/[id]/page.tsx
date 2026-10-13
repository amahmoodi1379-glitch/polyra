import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { LevelChip, StatusChip } from "@/components/admin/status-chip";
import { ItemAudioPanel } from "@/components/admin/audio/item-audio";
import { Voiced } from "@/components/admin/voiced";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { itemAudio } from "@/server/content/audio/view";
import { editors } from "@/server/content/library/edit";
import type { ItemView } from "@/server/content/library/edit/types";
import { isLibrarySlug, type LibrarySlug } from "@/server/content/library/slugs";
import { appSetting } from "@/server/settings/read";
import { libraryHref } from "../../links";
import { ItemAside } from "./aside";
import { ItemActions } from "./item-actions";
import { ItemForm } from "./item-form";

type Params = { type: string; id: string };

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
              <StatusNote view={view} />
            </div>
          </div>
          <ItemActions slug={slug} id={id} language={language} status={view.status} suspended={view.suspended} />
        </div>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_300px] xl:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <ItemForm slug={slug} id={id} language={language} values={loaded.values} context={loaded.context} levels={levels} readOnly={view.status === "retired"} />
          {audioAside ? null : audioPanel}
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

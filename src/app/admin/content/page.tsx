import type { Metadata } from "next";
import Link from "next/link";
import { LanguageTabs } from "@/components/admin/language-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { pickLanguage } from "@/server/content/languages";
import { listItems, typeCounts, type LibraryFilters, type StatusFilter } from "@/server/content/library/list";
import { contentStatuses, isLibrarySlug, withoutLevel, type LibrarySlug } from "@/server/content/library/slugs";
import { appSetting } from "@/server/settings/read";
import { FilterBar } from "./filter-bar";
import { LibraryList } from "./library-list";
import { libraryHref } from "./links";

export const metadata: Metadata = { title: t("admin.library.title") };

/** The types in the order of the learner's skills (PRD §13.2 «محتوا»). */
const groups: { key: "vocabulary" | "grammar" | "texts" | "speaking" | "phonics"; slugs: LibrarySlug[] }[] = [
  { key: "vocabulary", slugs: ["words", "sentences"] },
  { key: "grammar", slugs: ["units", "tables", "transforms", "translations"] },
  { key: "texts", slugs: ["texts"] },
  { key: "speaking", slugs: ["dialogues", "errorfix", "writing"] },
  { key: "phonics", slugs: ["phonics"] },
];

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function LibraryPage({ searchParams }: PageProps<"/admin/content">) {
  const admin = await requireAdmin();
  const query = await searchParams;
  const language = pickLanguage(query.lang, admin.admin_language);
  const type: LibrarySlug = isLibrarySlug(one(query.type)) ? (one(query.type) as LibrarySlug) : "words";
  const levels = await appSetting<string[]>(`levels.${language}`);
  const level = one(query.level);
  const status = one(query.status);
  const filters: LibraryFilters = {
    level: level && levels.includes(level) && !withoutLevel.has(type) ? level : null,
    status: status === "suspended" || contentStatuses.includes(status as never) ? (status as StatusFilter) : null,
    incomplete: one(query.missing) === "1",
    q: (one(query.q) ?? "").trim().slice(0, 80),
    page: Math.max(1, Number(one(query.page)) || 1),
  };
  const [counts, page] = await Promise.all([typeCounts(language), listItems(type, language, filters)]);
  const state = { language, type, ...filters };
  const filtered = Boolean(filters.level || filters.status || filters.incomplete || filters.q);

  return (
    <>
      <PageHeader
        title={t("admin.library.title")}
        lead={t("admin.library.lead")}
        actions={<LanguageTabs current={language} path={`/admin/content?type=${type}`} />}
      />

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[208px_minmax(0,1fr)] lg:gap-8">
        <nav aria-label={t("admin.library.typesLabel")} className="-mx-5 min-w-0 lg:sticky lg:top-8 lg:mx-0">
          {/* Phone: one scrolling row of chips. Desktop: the types grouped by skill, like folders. */}
          <ul className="flex gap-2 overflow-x-auto px-5 pb-1 lg:hidden">
            {groups.flatMap((group) => group.slugs).map((slug) => (
              <li key={slug} className="shrink-0">
                <TypeLink slug={slug} count={counts[slug]} current={type === slug} href={libraryHref({ language, type: slug })} chip />
              </li>
            ))}
          </ul>
          <div className="hidden flex-col gap-5 lg:flex">
            {groups.map((group) => (
              <section key={group.key} className="flex flex-col gap-1">
                <h2 className="text-ink-3 px-3 text-[12.5px] font-bold">{t(`admin.library.groups.${group.key}`)}</h2>
                <ul className="flex flex-col gap-0.5">
                  {group.slugs.map((slug) => (
                    <li key={slug}>
                      <TypeLink slug={slug} count={counts[slug]} current={type === slug} href={libraryHref({ language, type: slug })} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </nav>

        <div className="flex min-w-0 flex-col gap-4">
          <FilterBar key={`${language}-${type}`} state={state} levels={withoutLevel.has(type) ? [] : levels} placeholder={t(`admin.library.search.${type}`)} />
          <LibraryList
            key={`${language}-${type}-${filters.page}-${filters.level}-${filters.status}-${filters.incomplete}-${filters.q}`}
            language={language}
            type={type}
            page={page}
            state={state}
            emptyText={filtered || counts[type] > 0 ? t("admin.library.empty") : t("admin.library.emptyType")}
          />
        </div>
      </div>
    </>
  );
}

function TypeLink({ slug, count, current, href, chip }: { slug: LibrarySlug; count: number; current: boolean; href: string; chip?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex items-center justify-between gap-3 font-bold transition-[background-color,color] duration-150",
        chip
          ? "h-10 rounded-[12px] px-3.5 text-[13.5px] whitespace-nowrap"
          : "h-10 rounded-[12px] px-3 text-[14px]",
        current ? "bg-tint text-brand-text" : chip ? "bg-surface text-ink-2 shadow-[var(--shadow-1)]" : "text-ink-2 hover:bg-tint hover:text-ink",
      )}
    >
      <span>{t(`admin.library.types.${slug}`)}</span>
      <span className={cn("text-[12.5px] tabular-nums", current ? "text-brand-text" : "text-ink-3")}>{formatNumber(count)}</span>
    </Link>
  );
}

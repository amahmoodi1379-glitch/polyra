import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { LanguageTabs } from "@/components/admin/language-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { t } from "@/i18n";
import { requireAdmin } from "@/server/auth/session";
import { pickLanguage } from "@/server/content/languages";
import { openItems } from "@/server/content/resolve";
import { appSetting } from "@/server/settings/read";
import { ResolveList } from "./resolve-list";

export const metadata: Metadata = { title: t("admin.resolve.title") };

/** Candidates, suspect mappings and duplicate words, each settled with one button (PRD §13.9). */
export default async function ResolvePage({ searchParams }: PageProps<"/admin/resolve">) {
  const admin = await requireAdmin();
  const language = pickLanguage((await searchParams).lang, admin.admin_language);
  const [items, levels] = await Promise.all([openItems(language), appSetting<string[]>(`levels.${language}`)]);

  return (
    <>
      <div className="flex flex-col gap-3">
        <Link
          href="/admin"
          className="text-ink-3 hover:text-ink -ms-1 inline-flex w-fit items-center gap-1.5 rounded-[10px] px-1 py-1 text-[14px] font-bold transition-colors"
        >
          <ArrowRight className="size-4 ltr:-scale-x-100" strokeWidth={2} aria-hidden />
          {t("admin.resolve.back")}
        </Link>
        <PageHeader
          title={t("admin.resolve.title")}
          lead={t("admin.resolve.lead")}
          actions={admin.admin_language === "all" ? <LanguageTabs current={language} path="/admin/resolve" /> : null}
        />
      </div>
      <ResolveList language={language} items={items} levels={levels} />
    </>
  );
}

import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { t } from "@/i18n";
import { languageInfo } from "@/server/content/languages";
import { db } from "@/server/db";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { mayPlace, placementScreen } from "@/server/learn/placement";
import { PlacementFlow } from "./placement-flow";

export const metadata: Metadata = { title: t("learn.placement.title") };

/** The placement test (PRD §11.1–§11.3): one question at a time, then the result of each skill. */
export default async function PlacementPage({ params }: PageProps<"/learn/[lang]/placement">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/learn/${language}/placement`);
  if (!(await mayPlace(user, language))) redirect(`/learn/${language}`);
  const screen = await placementScreen(user, language);
  if (!screen) redirect(`/learn/${language}`);
  const row = await db.language.findUnique({ where: { code: language }, select: { coming_soon_fa: true } });
  return <PlacementFlow language={language} languageName={languageInfo[language].name_fa} initial={screen} comingSoon={row?.coming_soon_fa?.trim() || null} />;
}

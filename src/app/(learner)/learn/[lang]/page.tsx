import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { t } from "@/i18n";
import { num } from "@/engine/settings";
import { languageInfo } from "@/server/content/languages";
import { db } from "@/server/db";
import { enrollments, learnerLanguages, SESSION_LENGTHS } from "@/server/learn/enroll";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { homeData } from "@/server/learn/home";
import { engineSettings } from "@/server/settings/read";
import { placementRunning } from "@/server/learn/placement";
import { takeReportNotices } from "@/server/reports/file";
import { Home } from "./home";
import { PlacementPaused } from "./placement/paused";

export const metadata: Metadata = { title: t("learn.home.startLabel") };

/** The home of one language (PRD §3.2). */
export default async function LanguageHomePage({ params }: PageProps<"/learn/[lang]">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/learn/${language}`);
  // A test left half-way (PRD §11.1): «ادامه تعیین سطح» and «از همین‌جا شروع کن» instead of «شروع».
  if (await placementRunning(user.id, language)) return <PlacementPaused language={language} languageName={languageInfo[language].name_fa} />;
  const [data, allowed, enrolled, account, settings, fixed] = await Promise.all([
    homeData(user, language),
    learnerLanguages(user),
    enrollments(user.id),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { session_length_min: true } }),
    engineSettings(),
    // «حق با تو بود» is shown once (PRD §3.11, §13.10).
    takeReportNotices(user.id, language),
  ]);
  if (!data) redirect(allowed.includes(language) ? `/start/${language}` : "/start");

  const languages = allowed.map((code) => ({ code, name: languageInfo[code].name_fa, enrolled: enrolled.some((row) => row.language === code) }));
  return (
    <Home
      data={data}
      languageName={languageInfo[language].name_fa}
      languages={languages}
      account={{ admin: user.is_admin, tester: user.is_admin || user.is_tester, sessionLength: account.session_length_min }}
      lengths={[...SESSION_LENGTHS]}
      freeze={{ max: num(settings, "freeze.max"), minutes: num(settings, "freeze.min_daily_minutes") }}
      notice={fixed > 0 ? "report_fixed" : null}
    />
  );
}

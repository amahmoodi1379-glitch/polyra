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
import { Home } from "./home";

export const metadata: Metadata = { title: t("learn.home.startLabel") };

/** The home of one language (PRD §3.2). */
export default async function LanguageHomePage({ params }: PageProps<"/learn/[lang]">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/learn/${language}`);
  const [data, allowed, enrolled, account, settings] = await Promise.all([
    homeData(user, language),
    learnerLanguages(user),
    enrollments(user.id),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { session_length_min: true } }),
    engineSettings(),
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
    />
  );
}

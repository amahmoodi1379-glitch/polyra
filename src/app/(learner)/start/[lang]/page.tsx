import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { t } from "@/i18n";
import { db } from "@/server/db";
import { languageInfo } from "@/server/content/languages";
import { appSetting } from "@/server/settings/read";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { enrollments, learnerLanguages, SESSION_LENGTHS } from "@/server/learn/enroll";
import { StartFlow } from "./start-flow";

export const metadata: Metadata = { title: t("learn.start.fromZero") };

/**
 * Starting a language (PRD §3.1, steps 3 and 4): the session length, asked once in the learner's
 * first language, then «از صفر شروع می‌کنم». Nothing is saved until that button is pressed.
 */
export default async function StartLanguagePage({ params }: PageProps<"/start/[lang]">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/start/${language}`);
  const [allowed, enrolled, estimates, account] = await Promise.all([
    learnerLanguages(user),
    enrollments(user.id),
    appSetting<Record<string, string>>("pace_estimate_fa"),
    db.user.findUniqueOrThrow({ where: { id: user.id }, select: { session_length_min: true } }),
  ]);
  if (!allowed.includes(language)) notFound();
  if (enrolled.some((row) => row.language === language)) redirect(`/learn/${language}`);

  return (
    <StartFlow
      language={language}
      languageName={languageInfo[language].name_fa}
      askLength={enrolled.length === 0}
      lengths={[...SESSION_LENGTHS]}
      initialLength={account.session_length_min}
      estimates={estimates ?? {}}
      canGoBack={allowed.length > 1}
    />
  );
}

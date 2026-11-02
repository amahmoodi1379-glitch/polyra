import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Player } from "@/components/learn/session/player";
import { SCOPES } from "@/engine/session";
import { t } from "@/i18n";
import { languageInfo } from "@/server/content/languages";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { placementRunning } from "@/server/learn/placement";

export const metadata: Metadata = { title: t("learn.session.title") };

/** A session (PRD §3.4); the player builds or resumes it on the device. */
export default async function SessionPage({ params, searchParams }: PageProps<"/learn/[lang]/session">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const { scope: asked } = await searchParams;
  const scope = SCOPES.find((item) => item === asked) ?? "mixed";
  const user = await requireLearner(`/learn/${language}/session${scope === "mixed" ? "" : `?scope=${scope}`}`);
  // No session while a placement test waits: the home offers to go on with it or to start from here (PRD §11.1).
  if (await placementRunning(user.id, language)) redirect(`/learn/${language}`);
  return <Player language={language} languageName={languageInfo[language].name_fa} scope={scope} />;
}

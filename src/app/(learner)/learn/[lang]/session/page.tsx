import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Player } from "@/components/learn/session/player";
import type { Scope } from "@/engine/session";
import { t } from "@/i18n";
import { languageInfo } from "@/server/content/languages";
import { languageParam, requireLearner } from "@/server/learn/guard";

export const metadata: Metadata = { title: t("learn.session.title") };

const scopes: Scope[] = ["mixed", "quick", "vocab", "grammar", "notebook", "extra"];

/** A session (PRD §3.4); the player builds or resumes it on the device. */
export default async function SessionPage({ params, searchParams }: PageProps<"/learn/[lang]/session">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const { scope: asked } = await searchParams;
  const scope = scopes.find((item) => item === asked) ?? "mixed";
  await requireLearner(`/learn/${language}/session${scope === "mixed" ? "" : `?scope=${scope}`}`);
  return <Player language={language} languageName={languageInfo[language].name_fa} scope={scope} />;
}

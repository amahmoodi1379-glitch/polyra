import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageBar } from "@/components/learn/page-bar";
import { TextReader } from "@/components/learn/session/text-reader";
import { t } from "@/i18n";
import { languageInfo } from "@/server/content/languages";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { myText } from "@/server/learn/lists";

export const metadata: Metadata = { title: t("learn.texts.title") };

/** One text from «متن‌های من»: only to listen and read, nothing is scored or logged (PRD §7.9). */
export default async function MyTextPage({ params }: PageProps<"/learn/[lang]/texts/[id]">) {
  const { lang, id } = await params;
  const language = languageParam(lang);
  const textId = Number(id);
  if (!language || !Number.isInteger(textId) || textId <= 0) notFound();
  const user = await requireLearner(`/learn/${language}/texts/${textId}`);
  const text = await myText(user, language, textId);
  if (!text) notFound();
  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.texts.title")} back={`/learn/${language}/texts`} />
        <TextReader view={text.view} language={language} languageName={languageInfo[language].name_fa} listenFirst={text.listenFirst} />
      </div>
    </main>
  );
}

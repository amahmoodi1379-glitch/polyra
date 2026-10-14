import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "@/components/learn/icons";
import { PageBar } from "@/components/learn/page-bar";
import { t } from "@/i18n";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { myWords } from "@/server/learn/lists";
import { WordList } from "./word-list";

export const metadata: Metadata = { title: t("learn.words.title") };

/** «کلمه‌های من» (PRD §3.10). */
export default async function MyWordsPage({ params }: PageProps<"/learn/[lang]/words">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/learn/${language}/words`);
  const words = await myWords(user, language);
  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.words.title")} back={`/learn/${language}`} />
        {words.length === 0 ? (
          <div className="empty">
            <Icon name="l-stack" />
            <p>{t("learn.words.empty")}</p>
          </div>
        ) : (
          <WordList language={language} words={words} />
        )}
      </div>
    </main>
  );
}

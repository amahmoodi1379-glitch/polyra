import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageBar } from "@/components/learn/page-bar";
import { WordFace } from "@/components/learn/session/cards";
import { t } from "@/i18n";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { myWord } from "@/server/learn/lists";

export const metadata: Metadata = { title: t("learn.words.title") };

/** One word's card from «کلمه‌های من»: only to read and listen (PRD §3.10). */
export default async function MyWordPage({ params }: PageProps<"/learn/[lang]/words/[id]">) {
  const { lang, id } = await params;
  const language = languageParam(lang);
  const wordId = Number(id);
  if (!language || !Number.isInteger(wordId) || wordId <= 0) notFound();
  const user = await requireLearner(`/learn/${language}/words/${wordId}`);
  const card = await myWord(user, language, wordId);
  if (!card) notFound();
  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.words.title")} back={`/learn/${language}/words`} />
        <WordFace id={`word:${wordId}`} card={card} muted={false} autoplay={false} />
      </div>
    </main>
  );
}

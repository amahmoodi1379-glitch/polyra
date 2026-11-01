import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageBar } from "@/components/learn/page-bar";
import { PhonicsFace } from "@/components/learn/session/cards";
import { t } from "@/i18n";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { myPhonicsLesson } from "@/server/learn/lists";

export const metadata: Metadata = { title: t("learn.phonicsPage.title") };

/** One phonics lesson from «الفبا و تلفظ», to read and hear again: the tip, every example word and sentence. */
export default async function PhonicsLessonPage({ params }: PageProps<"/learn/[lang]/phonics/[id]">) {
  const { lang, id } = await params;
  const language = languageParam(lang);
  const lessonId = Number(id);
  if (!language || !Number.isInteger(lessonId) || lessonId <= 0) notFound();
  const user = await requireLearner(`/learn/${language}/phonics/${lessonId}`);
  const lesson = await myPhonicsLesson(user, language, lessonId);
  if (!lesson) notFound();
  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.phonicsPage.title")} back={`/learn/${language}/phonics`} />
        <PhonicsFace id={`phonics:${lessonId}`} view={lesson} kicker={t("learn.phonics.kicker", { index: lesson.index, total: lesson.total })} />
      </div>
    </main>
  );
}

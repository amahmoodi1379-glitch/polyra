import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageBar } from "@/components/learn/page-bar";
import { LessonFace } from "@/components/learn/session/cards";
import { t } from "@/i18n";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { myLesson } from "@/server/learn/lists";

export const metadata: Metadata = { title: t("learn.lessons.title") };

/** One lesson from «درسنامه‌های من»: the lesson, its build table, examples and the rule line (PRD §3.10). */
export default async function MyLessonPage({ params }: PageProps<"/learn/[lang]/lessons/[id]">) {
  const { lang, id } = await params;
  const language = languageParam(lang);
  const unitId = Number(id);
  if (!language || !Number.isInteger(unitId) || unitId <= 0) notFound();
  const user = await requireLearner(`/learn/${language}/lessons/${unitId}`);
  const lesson = await myLesson(user, language, unitId);
  if (!lesson) notFound();
  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.lessons.title")} back={`/learn/${language}/lessons`} />
        <LessonFace id={`lesson:${unitId}`} lesson={lesson} />
      </div>
    </main>
  );
}

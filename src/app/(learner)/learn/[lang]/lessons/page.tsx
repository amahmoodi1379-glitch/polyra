import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/learn/icons";
import { Mixed } from "@/components/learn/mixed";
import { PageBar } from "@/components/learn/page-bar";
import { formatNumber, t } from "@/i18n";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { myLessons } from "@/server/learn/lists";

export const metadata: Metadata = { title: t("learn.lessons.title") };

/** «درسنامه‌های من»: the opened grammar units in teaching order (PRD §3.10). */
export default async function MyLessonsPage({ params }: PageProps<"/learn/[lang]/lessons">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/learn/${language}/lessons`);
  const lessons = await myLessons(user, language);
  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.lessons.title")} back={`/learn/${language}`} />
        {lessons.length === 0 ? (
          <div className="empty">
            <Icon name="l-book" />
            <p>{t("learn.lessons.empty")}</p>
          </div>
        ) : (
          <>
            <p className="count-line num">{t("learn.lessons.count", { n: lessons.length })}</p>
            <ul className="entries" role="list">
              {lessons.map((lesson) => (
                <li key={lesson.id}>
                  <Link className="entry" href={`/learn/${language}/lessons/${lesson.id}`}>
                    <span className="no num">{formatNumber(lesson.order)}</span>
                    <span className="t">
                      <b>
                        <Mixed text={lesson.title} />
                      </b>
                      {lesson.canDo ? (
                        <span>
                          <Mixed text={lesson.canDo} />
                        </span>
                      ) : null}
                    </span>
                    <Icon name="l-back" className="i s fwd" />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/learn/icons";
import { PageBar } from "@/components/learn/page-bar";
import { WritingEditor } from "@/components/learn/writing";
import { t } from "@/i18n";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { writingPage } from "@/server/learn/writing";

export const metadata: Metadata = { title: t("learn.writing.title") };
export const dynamic = "force-dynamic";

/**
 * This week's guided writing (PRD §8b.6). A teacher or a tester opens any visible task with `?task=id`
 * («آزمایش مثل زبان‌آموز» links here); such a try is kept but changes nothing in their week or streak.
 */
export default async function WritingPage({ params, searchParams }: PageProps<"/learn/[lang]/writing">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const query = await searchParams;
  const taskParam = Number(Array.isArray(query.task) ? query.task[0] : query.task);
  const taskId = Number.isInteger(taskParam) && taskParam > 0 ? taskParam : null;
  const user = await requireLearner(`/learn/${language}/writing${taskId ? `?task=${taskId}` : ""}`);
  const page = await writingPage(user, language, taskId);
  return (
    <main className="app">
      <div className="screen fill">
        <PageBar title={t("learn.writing.title")} back={`/learn/${language}`} />
        {!page || page.locked ? (
          <div className="empty">
            <Icon name="l-text" />
            <p>{page?.locked ? t("learn.writing.locked") : t("learn.writing.none")}</p>
            <Link className="ghost" href={`/learn/${language}/writings`}>
              {t("learn.writing.toList")}
            </Link>
          </div>
        ) : (
          <WritingEditor language={language} task={page.task} minToFinish={page.minToFinish} trying={page.trying} />
        )}
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/learn/icons";
import { Mixed } from "@/components/learn/mixed";
import { PageBar } from "@/components/learn/page-bar";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { myPhonics } from "@/server/learn/lists";

export const metadata: Metadata = { title: t("learn.phonicsPage.title") };

/**
 * «الفبا و تلفظ» (PRD §3.2, §8.4, DECISIONS.md): «درس بعدی» starts the next round as a phonics session,
 * and every lesson opened so far can be read and heard again.
 */
export default async function PhonicsPage({ params }: PageProps<"/learn/[lang]/phonics">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/learn/${language}/phonics`);
  const { lessons, progress, next } = await myPhonics(user, language);
  if (lessons.length === 0) notFound();
  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.phonicsPage.title")} back={`/learn/${language}`} />
        <p className="phon-lead">{progress.done ? t("learn.phonicsPage.allDone") : t("learn.phonicsPage.lead")}</p>
        {progress.done ? null : next ? (
          <Link className="primary jelly-press" href={`/learn/${language}/session?scope=phonics`}>
            {t(next.round === 1 ? "learn.phonicsPage.start" : "learn.phonicsPage.round2", { no: next.no })}
          </Link>
        ) : (
          <p className="phon-wait">
            <Icon name="l-clock" className="i s" />
            {t("learn.phonicsPage.wait")}
          </p>
        )}
        <ul className="entries" role="list" aria-label={t("learn.phonicsPage.listLabel")}>
          {lessons.map((lesson) => {
            const opened = lesson.state !== "next" && lesson.state !== "closed";
            const inner = (
              <>
                <span className="no num">{formatNumber(lesson.no)}</span>
                <span className="t">
                  <b>
                    <Mixed text={lesson.label} />
                  </b>
                  <span>{t(`learn.phonicsPage.state.${lesson.state}`)}</span>
                </span>
                {opened ? <Icon name="l-back" className="i s fwd" /> : null}
              </>
            );
            return (
              <li key={lesson.id}>
                {opened ? (
                  <Link className="entry" href={`/learn/${language}/phonics/${lesson.id}`}>
                    {inner}
                  </Link>
                ) : (
                  <div className={cn("entry", lesson.state === "closed" && "shut")}>{inner}</div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}

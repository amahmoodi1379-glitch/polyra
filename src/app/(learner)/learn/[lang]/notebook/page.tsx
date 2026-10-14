import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/learn/icons";
import { Mixed } from "@/components/learn/mixed";
import { PageBar } from "@/components/learn/page-bar";
import { genderClass } from "@/components/learn/gender";
import { t } from "@/i18n";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { notebookLines } from "@/server/learn/lists";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: t("learn.notebook.title") };

/** The mistakes notebook (PRD §9.5): what was missed lately; practising it starts a notebook session. */
export default async function NotebookPage({ params }: PageProps<"/learn/[lang]/notebook">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/learn/${language}/notebook`);
  const lines = await notebookLines(user, language);

  return (
    <main className="app">
      <div className="screen fill">
        <PageBar title={t("learn.notebook.title")} back={`/learn/${language}`} />
        {lines.length === 0 ? (
          <div className="empty">
            <Icon name="l-note" />
            <p>{t("learn.notebook.empty")}</p>
          </div>
        ) : (
          <>
            <p className="lead">{t("learn.notebook.lead")}</p>
            <p className="count-line num">{t("learn.notebook.count", { n: lines.length })}</p>
            <ul className="entries" role="list">
              {lines.map((line) => (
                <li key={line.key} className="entry">
                  <span className="t">
                    <span className="lat" lang={language} dir="ltr">
                      {line.article ? <i className={cn("art", genderClass(line.gender))}>{line.article} </i> : null}
                      {line.target}
                    </span>
                    <span>
                      <Mixed text={line.fa} />
                    </span>
                  </span>
                  <span className="kind">{t(`learn.notebook.kind.${line.kind}`)}</span>
                </li>
              ))}
            </ul>
            <div className="cta">
              <Link className="primary" href={`/learn/${language}/session?scope=notebook`}>
                {t("learn.notebook.practice")}
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "@/components/learn/icons";
import { PageBar } from "@/components/learn/page-bar";
import { WrittenView } from "@/components/learn/writing";
import { writingWords } from "@/engine/production";
import { t } from "@/i18n";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { myWritings } from "@/server/learn/writing";

export const metadata: Metadata = { title: t("learn.writings.title") };
export const dynamic = "force-dynamic";

const dateFa = new Intl.DateTimeFormat("fa-IR", {
  timeZone: "Asia/Tehran",
  year: "numeric",
  month: "long",
  day: "numeric",
});

/** «نوشته‌های من» (PRD §3.10): every finished writing, the newest first, beside its model answer. */
export default async function MyWritingsPage({ params }: PageProps<"/learn/[lang]/writings">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/learn/${language}/writings`);
  const entries = await myWritings(user, language);
  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.writings.title")} back={`/learn/${language}`} />
        {entries.length === 0 ? (
          <div className="empty">
            <Icon name="l-text" />
            <p>{t("learn.writings.empty")}</p>
          </div>
        ) : (
          <>
            <p className="count-line num">{t("learn.writings.count", { n: entries.length })}</p>
            {entries.map((entry) => (
              <details key={entry.id} className="write-box" open={entry === entries[0]}>
                <summary className="write-prompt">
                  {entry.task.promptFa}
                  <span className="prod-kicker num">
                    {" "}
                    · {entry.task.level} · {dateFa.format(new Date(entry.at))} · {t("learn.writings.words", { n: writingWords(entry.text) })}
                  </span>
                </summary>
                <WrittenView id={entry.id} text={entry.text} ticks={entry.ticks} task={entry.task} language={language} />
              </details>
            ))}
          </>
        )}
      </div>
    </main>
  );
}

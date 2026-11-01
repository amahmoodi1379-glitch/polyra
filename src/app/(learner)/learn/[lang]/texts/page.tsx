import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/learn/icons";
import { PageBar } from "@/components/learn/page-bar";
import { t } from "@/i18n";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { myTexts } from "@/server/learn/lists";

export const metadata: Metadata = { title: t("learn.texts.title") };

/** «متن‌های من»: texts with a finished stage, the latest first, with their tracks (PRD §3.10, §7.9). */
export default async function MyTextsPage({ params }: PageProps<"/learn/[lang]/texts">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/learn/${language}/texts`);
  const texts = await myTexts(user, language);
  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.texts.title")} back={`/learn/${language}`} />
        {texts.length === 0 ? (
          <div className="empty">
            <Icon name="l-text" />
            <p>{t("learn.texts.empty")}</p>
          </div>
        ) : (
          <>
            <p className="count-line num">{t("learn.texts.count", { n: texts.length })}</p>
            <ul className="entries" role="list">
              {texts.map((text) => (
                <li key={text.id}>
                  <Link className="entry" href={`/learn/${language}/texts/${text.id}`}>
                    <span className="t">
                      <span className="lat" lang={language} dir="ltr">
                        {text.title}
                      </span>
                      <span className="num">{[text.level, ...text.tracks.map((track) => t(`learn.text.${track}`))].join(" · ")}</span>
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

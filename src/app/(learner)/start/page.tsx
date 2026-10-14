import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/learn/icons";
import { t } from "@/i18n";
import { languageInfo } from "@/server/content/languages";
import { requireLearner } from "@/server/learn/guard";
import { enrollments, learnerLanguages } from "@/server/learn/enroll";

export const metadata: Metadata = { title: t("learn.start.pickTitle") };

const monogram = (code: string) => code.charAt(0).toUpperCase() + code.slice(1);

/** Choosing a language (PRD §3.1, step 2); skipped when only one is open. */
export default async function StartPage() {
  const user = await requireLearner("/start");
  const [languages, enrolled] = await Promise.all([learnerLanguages(user), enrollments(user.id)]);
  if (languages.length === 1) redirect(enrolled.some((row) => row.language === languages[0]) ? `/learn/${languages[0]}` : `/start/${languages[0]}`);

  return (
    <main className="app">
      <div className="screen fill">
        {languages.length === 0 ? (
          <div className="calm">
            <span className="mark">
              <Icon name="l-book" />
            </span>
            <h1>{t("learn.noLanguage.title")}</h1>
            <p>{t("learn.noLanguage.body")}</p>
          </div>
        ) : (
          <>
            <header className="intro-head">
              <h1>{t("learn.start.pickTitle")}</h1>
            </header>
            <nav className="choices">
              {languages.map((code) => {
                const learning = enrolled.some((row) => row.language === code);
                return (
                  <Link key={code} className="choice" href={learning ? `/learn/${code}` : `/start/${code}`}>
                    <span className="monogram lat">{monogram(code)}</span>
                    <span>
                      {languageInfo[code].name_fa}
                      <small>{learning ? t("learn.start.learning") : t("learn.start.fresh")}</small>
                    </span>
                    <Icon name="l-back" className="i s fwd" />
                  </Link>
                );
              })}
            </nav>
          </>
        )}
      </div>
    </main>
  );
}

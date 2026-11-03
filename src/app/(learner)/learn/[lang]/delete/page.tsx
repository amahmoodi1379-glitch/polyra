import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "@/components/learn/icons";
import { PageBar } from "@/components/learn/page-bar";
import { t } from "@/i18n";
import { languageInfo, isLanguage } from "@/server/content/languages";
import { deletionNotes } from "@/server/learn/account";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { DeleteAccount } from "./delete-account";

export const metadata: Metadata = { title: t("learn.account.delete.title") };
export const dynamic = "force-dynamic";

const nameOf = (language: string) => (isLanguage(language) ? languageInfo[language].name_fa : language);

/** «حذف حساب» (PRD §15.5): what goes and what stays, then a confirmation. A teacher is sent to another teacher. */
export default async function DeletePage({ params }: PageProps<"/learn/[lang]/delete">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/learn/${language}/delete`);
  const notes = await deletionNotes(user.id);
  const subscriptionNote =
    notes.activeLanguages.length > 0 ? t("learn.account.delete.subscription", { languages: notes.activeLanguages.map(nameOf).join(t("learn.home.and")) }) : null;

  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.account.delete.title")} back={`/learn/${language}`} />
        <p className="account-lead">{t("learn.account.delete.lead")}</p>
        <div className="facts">
          <div className="fact">
            <Icon name="l-erase" />
            <p>{t("learn.account.delete.goes")}</p>
          </div>
          <div className="fact">
            <Icon name="l-info" />
            <p>{t("learn.account.delete.stays")}</p>
          </div>
          {subscriptionNote ? (
            <div className="fact" data-active-subscription>
              <Icon name="l-cal" />
              <p>{subscriptionNote}</p>
            </div>
          ) : null}
        </div>
        {notes.teacher ? <p className="account-hint">{t("learn.account.delete.teacher")}</p> : <DeleteAccount subscriptionNote={subscriptionNote} />}
      </div>
    </main>
  );
}

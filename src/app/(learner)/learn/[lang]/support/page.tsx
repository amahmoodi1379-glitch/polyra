import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Icon } from "@/components/learn/icons";
import { PageBar } from "@/components/learn/page-bar";
import { PlainText } from "@/components/plain-text";
import { t } from "@/i18n";
import { db } from "@/server/db";
import { languageParam, requireLearner } from "@/server/learn/guard";

export const metadata: Metadata = { title: t("learn.account.support.title") };
export const dynamic = "force-dynamic";

/** «پشتیبانی» (PRD §3 settings, §4 `language.support_contact_fa`): the teachers' text for this language, and the report button. */
export default async function SupportPage({ params }: PageProps<"/learn/[lang]/support">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  await requireLearner(`/learn/${language}/support`);
  const row = await db.language.findUnique({ where: { code: language }, select: { support_contact_fa: true } });
  const text = row?.support_contact_fa?.trim() || null;
  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.account.support.title")} back={`/learn/${language}`} />
        {text ? <PlainText text={text} className="prose-card" /> : <p className="prose-card">{t("learn.account.support.empty")}</p>}
        <div className="facts">
          <div className="fact">
            <Icon name="l-flag" />
            <p>{t("learn.account.support.report")}</p>
          </div>
        </div>
      </div>
    </main>
  );
}

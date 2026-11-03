import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageBar } from "@/components/learn/page-bar";
import { t } from "@/i18n";
import { languageParam, requireLearner } from "@/server/learn/guard";
import { PhoneFlow } from "./phone-flow";

export const metadata: Metadata = { title: t("learn.account.phone.title") };
export const dynamic = "force-dynamic";

/** «تغییر شماره» from the settings sheet (PRD §15.5). */
export default async function PhonePage({ params }: PageProps<"/learn/[lang]/phone">) {
  const { lang } = await params;
  const language = languageParam(lang);
  if (!language) notFound();
  const user = await requireLearner(`/learn/${language}/phone`);
  return (
    <main className="app">
      <div className="screen">
        <PageBar title={t("learn.account.phone.title")} back={`/learn/${language}`} />
        <PhoneFlow current={user.phone ?? ""} home={`/learn/${language}`} />
      </div>
    </main>
  );
}

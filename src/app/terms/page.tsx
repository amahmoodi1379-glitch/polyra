import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { PlainText } from "@/components/plain-text";
import { t } from "@/i18n";
import { appSetting } from "@/server/settings/read";

export const metadata: Metadata = { title: t("terms.title") };
export const dynamic = "force-dynamic";

const prose = "text-ink-2 flex flex-col gap-4 text-[15.5px] leading-8 [&_a]:text-brand-text [&_a]:underline [&_a]:underline-offset-4 [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-1.5 [&_ul]:ps-5";

/** «قوانین و حریم خصوصی» (PRD §13.2 texts, §15.5): the teachers' texts, or plain defaults until they write them. Open to everyone. */
export default async function TermsPage() {
  const [terms, privacy] = await Promise.all([appSetting<string>("terms_fa"), appSetting<string>("privacy_fa")]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[600px] flex-col gap-10 px-5 pt-12 pb-16 sm:pt-16">
      <Link href="/" aria-label={t("about.back")} className="w-fit rounded-[10px]">
        <Wordmark className="text-[34px]" />
      </Link>
      <h1 className="text-ink text-[28px] leading-tight font-extrabold text-balance">{t("terms.title")}</h1>
      <section aria-labelledby="privacy" className="flex flex-col gap-3" data-privacy>
        <h2 id="privacy" className="text-ink text-[20px] font-extrabold">
          {t("terms.privacy")}
        </h2>
        <PlainText text={privacy.trim() || t("terms.privacyDefault")} className={prose} />
      </section>
      <section aria-labelledby="terms" className="flex flex-col gap-3" data-terms>
        <h2 id="terms" className="text-ink text-[20px] font-extrabold">
          {t("terms.terms")}
        </h2>
        <PlainText text={terms.trim() || t("terms.termsDefault")} className={prose} />
      </section>
    </main>
  );
}

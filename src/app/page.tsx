import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { t } from "@/i18n";

/** Placeholder until the learner app is built (PRD §16.4 phase 2). */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[440px] flex-col justify-center gap-6 px-5 py-12">
      <Wordmark as="p" className="text-[60px]" />
      <div className="flex flex-col gap-1">
        <h1 className="text-ink text-2xl leading-snug font-extrabold">{t("home.building")}</h1>
        <p className="text-ink-2">{t("home.buildingHint")}</p>
      </div>
      <Link href="/admin" className="text-brand-text hover:bg-tint -ms-3 inline-flex min-h-11 w-fit items-center rounded-[14px] px-3 font-bold transition-colors">
        {t("home.adminLink")}
      </Link>
      <Link href="/about" className="text-ink-3 hover:text-ink w-fit text-[13.5px] underline-offset-4 hover:underline">
        {t("about.link")}
      </Link>
    </main>
  );
}

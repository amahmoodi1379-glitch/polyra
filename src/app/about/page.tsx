import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpLeft } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";

export const metadata: Metadata = { title: t("about.title") };

const licences = {
  "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  "LGPL-LR": "http://www.labri.fr/perso/clement/lefff/licence-LGPLLR.html",
} as const;

/**
 * The open data Polyra is built with (DECISIONS.md, 12 October 2026: frequency lists and the second
 * source for verb tables). CC BY-SA asks for the title, the authors, a link, the licence and what was changed.
 */
const sources = [
  { id: "lexique", name: "Lexique 3.83", authors: "Boris New, Christophe Pallier, Marc Brysbaert, Ludovic Ferrand", url: "http://www.lexique.org", licence: "CC BY-SA 4.0" },
  {
    id: "frequencyWords",
    name: "FrequencyWords",
    authors: "Hermit Dave, from OpenSubtitles 2018",
    url: "https://github.com/hermitdave/FrequencyWords",
    licence: "CC BY-SA 4.0",
  },
  { id: "lefff", name: "Lefff", authors: "Benoît Sagot", url: "http://pauillac.inria.fr/~sagot/index.html#lefff", licence: "LGPL-LR" },
  {
    id: "morphy",
    name: "Morphy",
    authors: "Wolfgang Lezius, through german-pos-dict by LanguageTool",
    url: "https://github.com/languagetool-org/german-pos-dict",
    licence: "CC BY-SA 4.0",
  },
] as const;

/** «درباره»: what Polyra is and whose open data it is built with. Open to everyone, signed in or not. */
export default function AboutPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[600px] flex-col gap-12 px-5 pt-12 pb-16 sm:pt-16">
      <Link href="/" aria-label={t("about.back")} className="w-fit rounded-[10px]">
        <Wordmark className="text-[34px]" />
      </Link>

      <header className="flex flex-col gap-3">
        <h1 className="text-ink text-[28px] leading-tight font-extrabold text-balance">{isolateLatin(t("about.title"))}</h1>
        <p className="text-ink-2 text-[16px] leading-8">{isolateLatin(t("about.lead"))}</p>
      </header>

      <section aria-labelledby="sources" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 id="sources" className="text-ink text-[20px] font-extrabold">
            {t("about.sources.title")}
          </h2>
          <p className="text-ink-2 text-[15px] leading-7">{isolateLatin(t("about.sources.lead"))}</p>
        </div>

        <ul className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
          {sources.map((source) => (
            <li key={source.id} className="flex flex-col gap-2 px-5 py-4 sm:px-6">
              <p className="text-ink text-[15.5px] font-bold">{t(`about.sources.items.${source.id}.use`)}</p>
              <div className="flex flex-col items-start gap-0.5">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="lat text-brand-text flex items-center gap-1 text-[17px] font-semibold underline-offset-4 hover:underline"
                >
                  <bdi dir="ltr">{source.name}</bdi>
                  <ArrowUpLeft className="size-3.5 ltr:-scale-x-100" strokeWidth={2.25} aria-hidden />
                </a>
                <p className="text-ink-2 text-[13.5px] leading-6">
                  <bdi dir="ltr">{source.authors}</bdi>
                </p>
              </div>
              <p className="text-ink-2 text-[14px] leading-7">{isolateLatin(t(`about.sources.items.${source.id}.change`))}</p>
              <p className="text-ink-3 flex flex-wrap items-center gap-x-2 text-[13px]">
                {t("about.sources.licence")}
                <a
                  href={licences[source.licence]}
                  target="_blank"
                  rel="noreferrer"
                  dir="ltr"
                  className="bg-tint text-brand-text rounded-[8px] px-2 py-0.5 text-[12.5px] font-bold underline-offset-4 hover:underline"
                >
                  {source.licence}
                </a>
              </p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="fonts" className="flex flex-col gap-1.5">
        <h2 id="fonts" className="text-ink text-[20px] font-extrabold">
          {t("about.fonts.title")}
        </h2>
        <p className="text-ink-2 text-[15px] leading-7">{isolateLatin(t("about.fonts.body"))}</p>
      </section>
    </main>
  );
}

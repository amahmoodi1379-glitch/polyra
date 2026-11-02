"use client";

import Link from "next/link";
import { useTransition } from "react";
import { squish } from "@/components/learn/motion";
import { sfx } from "@/components/learn/sfx";
import { t } from "@/i18n";
import { startFromHere } from "../../../actions";

/** The home while a placement test waits (PRD §11.1): go on with it, or start from what it found so far. */
export function PlacementPaused({ language, languageName }: { language: string; languageName: string }) {
  const [pending, start] = useTransition();
  return (
    <main className="app">
      <section className="screen fill" aria-label={languageName}>
        <header className="intro-head" style={{ paddingTop: "8vh" }}>
          <h1>{t("learn.placement.resumeTitle")}</h1>
          <p className="promise">{t("learn.placement.resumeLead")}</p>
        </header>
        <div className="cta">
          <Link
            className="primary jelly-press"
            href={`/learn/${language}/placement`}
            onPointerDown={(event) => squish(event.currentTarget)}
            onClick={() => sfx("release", 0.45)}
          >
            {t("learn.placement.resume")}
          </Link>
          <button type="button" className="ghost" disabled={pending} onClick={() => start(() => startFromHere(language))}>
            {t("learn.placement.fromHere")}
          </button>
        </div>
      </section>
    </main>
  );
}

"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Icon } from "@/components/learn/icons";
import { squish } from "@/components/learn/motion";
import { buzz, sfx } from "@/components/learn/sfx";
import { t } from "@/i18n";
import { beginFromZero } from "../../actions";

type Props = {
  language: string;
  languageName: string;
  askLength: boolean;
  lengths: number[];
  initialLength: number;
  estimates: Record<string, string>;
  canGoBack: boolean;
};

export function StartFlow({ language, languageName, askLength, lengths, initialLength, estimates, canGoBack }: Props) {
  const [step, setStep] = useState<"length" | "begin">(askLength ? "length" : "begin");
  const [minutes, setMinutes] = useState(lengths.includes(initialLength) ? initialLength : 15);
  const [pending, startTransition] = useTransition();
  const estimate = estimates[String(minutes)]?.trim();

  const back =
    step === "begin" && askLength ? (
      <button type="button" className="icon-btn" aria-label={t("learn.start.back")} onClick={() => setStep("length")}>
        <Icon name="l-fwd" className="i fwd" />
      </button>
    ) : canGoBack ? (
      <Link className="icon-btn" href="/start" aria-label={t("learn.start.back")}>
        <Icon name="l-fwd" className="i fwd" />
      </Link>
    ) : null;

  return (
    <main className="app">
      <div className="screen fill">
        <div className="sbar">{back ?? <span style={{ height: 44 }} />}</div>
        {step === "length" ? (
          <>
            <header className="intro-head" style={{ paddingTop: "4vh" }}>
              <h1 id="length-title">{t("learn.start.lengthTitle")}</h1>
              <p className="promise">{t("learn.start.lengthHint")}</p>
            </header>
            <div className="choices" role="radiogroup" aria-labelledby="length-title">
              {lengths.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={value === minutes}
                  className="choice"
                  onClick={() => {
                    setMinutes(value);
                    sfx("toggle", 0.4);
                  }}
                >
                  <span className="num">{t("learn.start.minutes", { n: value })}</span>
                  <span className="dot" aria-hidden="true" />
                </button>
              ))}
            </div>
            {estimate ? <p className="promise num">{estimate}</p> : null}
            <div className="cta">
              <button
                type="button"
                className="primary jelly-press"
                onPointerDown={(event) => squish(event.currentTarget)}
                onClick={() => {
                  sfx("release", 0.45);
                  setStep("begin");
                }}
              >
                {t("learn.start.next")}
              </button>
            </div>
          </>
        ) : (
          <>
            <header className="intro-head" style={{ paddingTop: "4vh" }}>
              <h1>{t("learn.start.beginTitle", { language: languageName })}</h1>
              <p className="promise">{t("learn.start.promise")}</p>
            </header>
            <div className="choices">
              <button
                type="button"
                className="choice jelly-press"
                disabled={pending}
                onPointerDown={(event) => squish(event.currentTarget)}
                onClick={() => {
                  sfx("arrival", 0.5);
                  buzz(10);
                  startTransition(() => beginFromZero(language, askLength ? minutes : null));
                }}
              >
                <span>
                  {t("learn.start.fromZero")}
                  <small>{t("learn.start.fromZeroHint")}</small>
                </span>
                <Icon name="l-back" className="i s fwd" />
              </button>
              <button type="button" className="choice" disabled aria-describedby="placement-soon">
                <span>
                  {t("learn.start.placement")}
                  <small>{t("learn.start.placementHint")}</small>
                </span>
                <span className="soon-tag" id="placement-soon">
                  {t("learn.start.soon")}
                </span>
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

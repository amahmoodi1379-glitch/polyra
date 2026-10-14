"use client";

import { useEffect, useRef } from "react";
import { Icon } from "@/components/learn/icons";
import { Mixed } from "@/components/learn/mixed";
import { dropIn, enter, squish } from "@/components/learn/motion";
import { buzz, sfx } from "@/components/learn/sfx";
import { formatNumber, t, tRich } from "@/i18n";
import type { EndSummary } from "@/server/learn/session";

/**
 * The end of a session (PRD §3.9), in its order: right and wrong, what was new today, «حالا
 * می‌توانی…», a station passed, the streak and tomorrow's reviews. The counts of this device show at
 * once; the rest waits for the server's answer.
 */

export function EndScreen({
  summary,
  local,
  languageName,
  minutes,
  waiting,
  onAgain,
  onBack,
}: {
  summary: EndSummary | null;
  local: { correct: number; wrong: number };
  languageName: string;
  minutes: number;
  waiting: "sending" | "offline" | null;
  onAgain: () => void;
  onBack: () => void;
}) {
  const station = useRef<HTMLDivElement>(null);
  const drop = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  useEffect(() => {
    enter(head.current);
  }, []);
  const hasStation = !!summary?.station;
  useEffect(() => {
    if (!summary) return;
    if (!hasStation) {
      sfx("ready", 0.45);
      return;
    }
    dropIn(drop.current);
    enter(station.current, 120);
    const timer = window.setTimeout(() => {
      sfx("ready", 0.5);
      buzz(10);
    }, 640);
    return () => window.clearTimeout(timer);
  }, [summary, hasStation]);

  const correct = summary?.correct ?? local.correct;
  const wrong = summary?.wrong ?? local.wrong;
  const today = summary
    ? [summary.newWordsToday > 0 ? t("learn.end.todayWords", { n: summary.newWordsToday }) : null, summary.newUnitsToday > 0 ? t("learn.end.todayUnits", { n: summary.newUnitsToday }) : null].filter(Boolean)
    : [];
  const stationInfo = summary?.station;

  return (
    <>
      <div className="end-head" ref={head}>
        <h1>{t("learn.end.title")}</h1>
        <p className="num">{t("learn.end.meta", { language: languageName, minutes })}</p>
      </div>
      <div className="score num">
        <div className="okc">
          <b>{formatNumber(correct)}</b>
          <span>{t("learn.end.correct")}</span>
        </div>
        <div className="badc">
          <b>{formatNumber(wrong)}</b>
          <span>{t("learn.end.wrong")}</span>
        </div>
      </div>

      {summary ? (
        <>
          {today.length > 0 || summary.knownWords > 0 || summary.canDo ? (
            <div className="facts">
              {today.length > 0 || summary.knownWords > 0 ? (
                <div className="fact">
                  <Icon name="i-vocab" />
                  <p className="num">
                    {today.length > 0 ? t("learn.end.today", { parts: today.join(t("learn.home.and")) }) : null} {summary.knownWords > 0 ? t("learn.end.known", { n: summary.knownWords }) : null}
                  </p>
                </div>
              ) : null}
              {summary.canDo ? (
                <div className="fact">
                  <Icon name="i-gram" />
                  <p>
                    <Mixed text={summary.canDo} />
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {stationInfo ? (
            <div className="station" ref={station}>
              <div className="drop" ref={drop} aria-hidden="true">
                <svg viewBox="0 0 100 100">
                  <ellipse cx="50" cy="94" rx="30" ry="4" style={{ fill: "var(--brand-press)", opacity: 0.18 }} />
                  <path d="M50 6C66 30 84 44 84 62a34 34 0 0 1-68 0C16 44 34 30 50 6Z" fill="url(#drop-g)" />
                  <ellipse cx="28" cy="60" rx="4.5" ry="10" transform="rotate(18 28 60)" fill="#fff" opacity=".5" />
                </svg>
                <span className="n num">{formatNumber(stationInfo.number)}</span>
              </div>
              <p className="num">
                {tRich("learn.end.station", {
                  n: stationInfo.number,
                  total: stationInfo.total,
                  skill: t(`learn.skill.${stationInfo.skill}`),
                  level: <span className="lat">{stationInfo.level}</span>,
                  count: stationInfo.count,
                  unit: stationInfo.skill === "vocab" ? t("learn.end.stationWords") : t("learn.end.stationUnits"),
                })}
                <small>{stationInfo.number >= stationInfo.total ? t("learn.end.stationLast") : t("learn.end.stationNext", { n: stationInfo.number + 1 })}</small>
              </p>
            </div>
          ) : null}

          <div className="facts">
            {summary.streak.counted ? (
              <div className="fact str">
                <Icon name="l-chain" />
                <p className="num">{t("learn.end.streak", { n: summary.streak.count })}</p>
              </div>
            ) : null}
            {summary.streak.freezeEarned ? (
              <div className="fact frz">
                <Icon name="l-snow" />
                <p>{t("learn.end.freeze")}</p>
              </div>
            ) : null}
            <div className="fact">
              <Icon name="l-cal" />
              <p className="num">{summary.tomorrow > 0 ? t("learn.end.tomorrow", { n: summary.tomorrow }) : t("learn.end.tomorrowNone")}</p>
            </div>
          </div>
        </>
      ) : (
        <div className="facts">
          <div className="fact wait" role="status">
            <Icon name={waiting === "offline" ? "l-offline" : "l-cal"} />
            <p>{waiting === "offline" ? t("learn.end.offline") : t("learn.end.waiting")}</p>
          </div>
        </div>
      )}

      <div className="cta">
        <button
          type="button"
          className="primary jelly-press"
          onPointerDown={(event) => squish(event.currentTarget)}
          onClick={() => {
            sfx("arrival", 0.45);
            onAgain();
          }}
        >
          {t("learn.end.again")}
        </button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            sfx("droplet", 0.4);
            onBack();
          }}
        >
          {t("learn.end.back")}
        </button>
      </div>
    </>
  );
}

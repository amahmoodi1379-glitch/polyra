"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { changeSessionLength, levelDown } from "@/app/(learner)/actions";
import { promptInstall } from "@/components/learn/install";
import { Icon, type IconName } from "@/components/learn/icons";
import { Mixed } from "@/components/learn/mixed";
import { dropIn, enter, squish } from "@/components/learn/motion";
import { buzz, sfx } from "@/components/learn/sfx";
import { formatNumber, t, tRich } from "@/i18n";
import type { EndMessage, EndSummary } from "@/server/learn/session";

/**
 * The end of a session (PRD §3.9), in its order: right and wrong, what was new today, «حالا
 * می‌توانی…», a station passed, the streak, tomorrow's reviews and at most one message (PRD §3.11).
 * The counts of this device show at once; the rest waits for the server's answer.
 */

export function EndScreen({
  summary,
  local,
  languageName,
  language,
  sessionId,
  minutes,
  waiting,
  onAgain,
  onBack,
}: {
  summary: EndSummary | null;
  /** For the messages' buttons: the exam's page and «بله» on a level lower. */
  language: string;
  sessionId: string | null;
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
    ? [
        summary.newWordsToday > 0 ? t("learn.end.todayWords", { n: summary.newWordsToday }) : null,
        summary.newUnitsToday > 0 ? t("learn.end.todayUnits", { n: summary.newUnitsToday }) : null,
      ].filter(Boolean)
    : [];
  const stationInfo = summary?.station;

  if (summary?.pathDone) return <PathDone done={summary.pathDone} onBack={onBack} />;

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
                    {today.length > 0 ? t("learn.end.today", { parts: today.join(t("learn.home.and")) }) : null}{" "}
                    {summary.knownWords > 0 ? t("learn.end.known", { n: summary.knownWords }) : null}
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

          {summary.message ? <EndNote message={summary.message} language={language} sessionId={sessionId} /> : null}
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

/** «مسیر عمومی را تا B2 تمام کردی.» (PRD §3.13): once, in place of the end screen, with what was learned. */
function PathDone({ done, onBack }: { done: NonNullable<EndSummary["pathDone"]>; onBack: () => void }) {
  const facts: [IconName, string][] = [
    ["i-vocab", t("learn.end.path.words", { n: formatNumber(done.words) })],
    ["i-gram", t("learn.end.path.units", { n: formatNumber(done.units) })],
    ["i-read", t("learn.end.path.texts", { n: formatNumber(done.texts) })],
    ["l-cal", t("learn.end.path.days", { n: formatNumber(done.days) })],
  ];
  return (
    <>
      <div className="end-head" data-path-done>
        <h1>{t("learn.end.path.title", { level: done.level })}</h1>
        <p>{t("learn.end.path.lead")}</p>
      </div>
      <div className="facts">
        {facts.map(([icon, text]) => (
          <div className="fact" key={icon}>
            <Icon name={icon} />
            <p className="num">{text}</p>
          </div>
        ))}
      </div>
      <p className="end-path-note">{t("learn.end.path.after")}</p>
      <div className="cta">
        <button
          type="button"
          className="primary jelly-press"
          onPointerDown={(event) => squish(event.currentTarget)}
          onClick={() => {
            sfx("arrival", 0.45);
            onBack();
          }}
        >
          {t("learn.end.back")}
        </button>
      </div>
    </>
  );
}

/** The one message of the end screen (PRD §3.11) with its buttons; it goes once it is answered. */
function EndNote({ message, language, sessionId }: { message: EndMessage; language: string; sessionId: string | null }) {
  if (message.kind === "install") return <InstallNote ios={message.ios} />;
  return <AskNote message={message} language={language} sessionId={sessionId} />;
}

/**
 * «اپ را به صفحه گوشی‌ات اضافه کن» (PRD §3.11 row 7): «نصب» opens Chrome's install window; on an iPhone
 * it shows Safari's two steps instead, and where the window is gone it points at the browser's menu.
 */
function InstallNote({ ios }: { ios: boolean }) {
  const [state, setState] = useState<"open" | "steps" | "done" | "closed">("open");
  const [pending, start] = useTransition();
  if (state === "closed") return null;
  if (state === "done") {
    return (
      <div className="end-note" role="status" data-message="install">
        <p>{t("learn.end.message.installed")}</p>
      </div>
    );
  }
  const install = () =>
    start(async () => {
      if (ios) return setState("steps");
      // Chrome may have no window to show any more (it was answered on another page): its menu still installs.
      const answer = await promptInstall();
      setState(answer === "accepted" ? "done" : answer === "dismissed" ? "closed" : "steps");
    });
  return (
    <div className="end-note install-note" data-message="install">
      <p>{t("learn.end.message.install")}</p>
      {state === "steps" ? (
        <ol className="install-steps">
          {ios ? (
            <>
              <li>{tRich("learn.end.message.iosStep1", { icon: <Icon name="l-share" /> })}</li>
              <li>{tRich("learn.end.message.iosStep2", { icon: <Icon name="l-add" />, add: <Mixed text="Add to Home Screen" />, ok: <Mixed text="Add" /> })}</li>
              <li className="sub">{t("learn.end.message.iosNotSafari")}</li>
            </>
          ) : (
            <li>{tRich("learn.end.message.menuStep", { install: <Mixed text="Install app" /> })}</li>
          )}
        </ol>
      ) : null}
      <div className="row">
        {state === "open" ? (
          <button type="button" className="secondary" disabled={pending} onClick={install}>
            {t("learn.end.message.installYes")}
          </button>
        ) : null}
        <button type="button" className={state === "open" ? "ghost" : "secondary"} disabled={pending} onClick={() => setState("closed")}>
          {state === "open" ? t("learn.end.message.later") : t("learn.end.message.ok")}
        </button>
      </div>
    </div>
  );
}

function AskNote({ message, language, sessionId }: { message: Exclude<EndMessage, { kind: "install" }>; language: string; sessionId: string | null }) {
  const [state, setState] = useState<"open" | "done" | "closed">(message.kind === "leveldown" && message.applied ? "done" : "open");
  const [pending, start] = useTransition();
  if (state === "closed") return null;
  // A new session length: one step shorter (row 2) or 15 minutes for long texts (row 3).
  const length = message.kind === "shorter" && message.to !== null ? message.to : message.kind === "longer" ? message.to : null;
  if (state === "done") {
    const text =
      message.kind === "leveldown"
        ? t("learn.end.message.lowered", { skill: t(`learn.skill.${message.skill}`), level: message.to })
        : t("learn.end.message.shortened", { n: length ?? 0 });
    return (
      <div className="end-note" role="status">
        <p className="num">{text}</p>
      </div>
    );
  }
  const text =
    message.kind === "leveldown"
      ? t("learn.end.message.leveldown")
      : message.kind === "longer"
        ? t("learn.end.message.longer", { n: message.to })
        : message.kind === "skipTest"
          ? t("learn.end.message.skipTest")
          : message.kind === "shorter"
            ? message.to !== null
              ? t("learn.end.message.shorter", { from: message.from, to: message.to })
              : t("learn.end.message.busy")
            : message.kind === "phonicsOff"
              ? t("learn.end.message.phonicsOff")
              : message.kind === "sample"
                ? t(message.skill === "vocab" ? "learn.end.message.sampleVocab" : "learn.end.message.sampleGrammar", { level: message.level })
                : t("learn.end.message.slowPace");
  const yes = (act: () => Promise<unknown>) => () =>
    start(async () => {
      await act();
      setState("done");
    });
  return (
    <div className="end-note" data-message={message.kind}>
      <p className="num">{text}</p>
      {message.kind === "leveldown" ? (
        <p className="num sub">{t("learn.end.message.leveldownWhich", { skill: t(`learn.skill.${message.skill}`), from: message.from, to: message.to })}</p>
      ) : null}
      <div className="row">
        {message.kind === "leveldown" && sessionId ? (
          <>
            <button type="button" className="secondary" disabled={pending} onClick={yes(() => levelDown(sessionId))}>
              {t("learn.end.message.yes")}
            </button>
            <button type="button" className="ghost" disabled={pending} onClick={() => setState("closed")}>
              {t("learn.end.message.keepLevel")}
            </button>
          </>
        ) : length !== null ? (
          <>
            <button type="button" className="secondary" disabled={pending} onClick={yes(() => changeSessionLength(length))}>
              {t("learn.end.message.yes")}
            </button>
            <button type="button" className="ghost" disabled={pending} onClick={() => setState("closed")}>
              {t("learn.end.message.no")}
            </button>
          </>
        ) : message.kind === "skipTest" ? (
          <>
            <Link className="secondary" href={`/learn/${language}/exam/${message.skill}`}>
              {t("learn.end.message.takeExam")}
            </Link>
            <button type="button" className="ghost" onClick={() => setState("closed")}>
              {t("learn.end.message.notNow")}
            </button>
          </>
        ) : (
          <button type="button" className="secondary" onClick={() => setState("closed")}>
            {t("learn.end.message.ok")}
          </button>
        )}
      </div>
    </div>
  );
}

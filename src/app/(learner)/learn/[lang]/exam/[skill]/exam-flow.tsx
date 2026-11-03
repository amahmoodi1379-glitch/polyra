"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";
import { Icon } from "@/components/learn/icons";
import { squish } from "@/components/learn/motion";
import { sfx } from "@/components/learn/sfx";
import { Exercise } from "@/components/learn/session/exercise";
import { TextStage } from "@/components/learn/session/text";
import type { RawAnswer } from "@/engine/ex";
import type { QuestionAnswer } from "@/engine/questions";
import type { SkillName } from "@/engine/state";
import type { Lang } from "@/engine/text";
import { formatNumber, t } from "@/i18n";
import { formatDateFa } from "@/lib/format";
import type { ExamScreen } from "@/server/learn/exam";
import { beginSkillExam, examStep } from "../../../../actions";

type Rules = { size: number; pass: number; percent: number; days: number };

type Props = {
  language: string;
  languageName: string;
  skill: SkillName;
  /** The exam half-way, or null for its first page. */
  initial: ExamScreen | null;
  /** The levels of the exam on offer, for its first page. */
  offer: { level: string; next: string } | null;
  rules: Rules;
};

/**
 * A level exam on the device (PRD §11.6): its first page says what it asks and what a pass changes; then
 * one question or text at a time with no feedback and no help; then the result. Closing keeps the exam
 * for later. The server grades every answer.
 */
export function ExamFlow({ language, languageName, skill, initial, offer, rules }: Props) {
  const router = useRouter();
  const [screen, setScreen] = useState<ExamScreen | null>(initial);
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const home = () => router.push(`/learn/${language}`);

  if (!screen) {
    const levels = offer ?? { level: "", next: "" };
    return (
      <main className="app">
        <div className="screen fill">
          <header className="intro-head" style={{ paddingTop: "4vh" }}>
            <h1 data-exam-intro>{t("learn.exam.introTitle", { level: levels.level, next: levels.next })}</h1>
            <p className="promise">
              {t(`learn.exam.lead.${skill}`, { size: formatNumber(rules.size), pass: formatNumber(rules.pass), percent: `${formatNumber(rules.percent)}٪`, level: levels.level, next: levels.next })}
            </p>
            <p className="promise">{t("learn.exam.rules")}</p>
            <p className="promise">{t("learn.exam.retryRule", { days: formatNumber(rules.days) })}</p>
            {failed ? (
              <p className="promise" role="alert">
                {t("learn.exam.unavailable")}
              </p>
            ) : null}
          </header>
          <div className="cta">
            <button
              type="button"
              className="primary jelly-press"
              disabled={pending}
              onPointerDown={(event) => squish(event.currentTarget)}
              onClick={() =>
                start(async () => {
                  sfx("release", 0.45);
                  const first = await beginSkillExam(language, skill);
                  if (first) setScreen(first);
                  else setFailed(true);
                })
              }
            >
              {t("learn.exam.start")}
            </button>
            <button type="button" className="ghost" onClick={home}>
              {t("learn.exam.back")}
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (screen.kind === "done") return <Result screen={screen} onHome={home} />;

  const send = (input: Parameters<typeof examStep>[2], number: number) =>
    start(async () => {
      const next = await examStep(language, skill, input, number);
      if (next) setScreen(next);
      else home();
    });
  const progress = (screen.number - 1) / Math.max(1, screen.size);

  return (
    <main className="app">
      <div className="screen fill">
        <div className="sbar">
          <button type="button" className="icon-btn" aria-label={t("learn.exam.later")} title={t("learn.exam.later")} onClick={home}>
            <Icon name="l-x" />
          </button>
          <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span style={{ "--p": `${Math.round(progress * 100)}%` } as CSSProperties} />
          </div>
          <span style={{ width: 44 }} />
        </div>
        <p className="plan num" data-exam-part>
          {t("learn.exam.title")} · {screen.level} · {t(screen.kind === "text" ? "learn.exam.textCounter" : "learn.exam.counter", { n: screen.number, of: screen.size })}
        </p>
        {screen.kind === "question" ? (
          <div className="screen-body" key={`${screen.number}`}>
            <Exercise
              id={`exam:${skill}:${screen.number}`}
              ex={screen.ex}
              language={language as Lang}
              languageName={languageName}
              verdict={null}
              muted={false}
              tip={false}
              submit={(raw: RawAnswer) => {
                if (pending) return null;
                sfx("press", 0.3);
                send({ answer: raw }, screen.number);
                return null;
              }}
            />
          </div>
        ) : (
          <TextStage
            key={`${screen.number}:${screen.view.id}`}
            id={`exam:${skill}:${screen.view.id}`}
            view={screen.view}
            info={{ textId: screen.view.id, track: screen.info.track, attempt: screen.info.attempt, stage: "again", set: screen.info.set, borrowed: false, rules: screen.info.rules, cost: 0, resume: null }}
            prefill={{}}
            language={language}
            submit={(raw) => send({ answers: ("answers" in raw ? raw.answers : {}) as Record<string, QuestionAnswer> }, screen.number)}
          />
        )}
      </div>
    </main>
  );
}

function Result({ screen, onHome }: { screen: Extract<ExamScreen, { kind: "done" }>; onHome: () => void }) {
  const { result, skill, level, next } = screen;
  const track = skill === "listening" || skill === "reading";
  const retry = screen.retryOn ? formatDateFa(new Date(`${screen.retryOn}T12:00:00+03:30`)) : "";
  return (
    <main className="app">
      <div className="screen fill">
        <header className="intro-head" style={{ paddingTop: "6vh" }}>
          <span className="mark">
            <Icon name={result.passed ? "l-check" : "l-tempo"} />
          </span>
          <h1 data-exam-result={result.passed ? "passed" : "failed"}>{t(result.passed ? "learn.exam.passedTitle" : "learn.exam.failedTitle")}</h1>
          <p className="plan num">
            {track ? t("learn.exam.scoreText", { percent: `${formatNumber(result.score)}٪` }) : t("learn.exam.score", { right: formatNumber(result.score), of: formatNumber(result.size) })}
          </p>
          <p className="promise">{result.passed ? t(`learn.exam.passed.${skill}`, { level, next }) : t("learn.exam.failed", { date: retry })}</p>
        </header>
        <div className="cta">
          <button
            type="button"
            className="primary jelly-press"
            onPointerDown={(event) => squish(event.currentTarget)}
            onClick={() => {
              sfx("release", 0.45);
              onHome();
            }}
          >
            {t("learn.exam.toHome")}
          </button>
        </div>
      </div>
    </main>
  );
}

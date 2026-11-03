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
import type { Lang } from "@/engine/text";
import { t } from "@/i18n";
import type { PlacementScreen } from "@/server/learn/placement";
import { placementStep } from "../../../actions";

type Props = { language: string; languageName: string; initial: PlacementScreen; comingSoon: string | null };

const SKILLS = ["vocab", "grammar", "listening", "reading"] as const;

/**
 * The placement test on the device (PRD §11.1): the line about «نمی‌دانم», one question at a time with
 * no feedback, «بعداً ادامه می‌دهم» (the close button: the test waits on the home) and «ادامه نمی‌دهم».
 * The server grades every answer and says what comes next.
 */
export function PlacementFlow({ language, languageName, initial, comingSoon }: Props) {
  const router = useRouter();
  const [screen, setScreen] = useState<PlacementScreen>(initial);
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  const home = () => router.push(`/learn/${language}`);

  const send = (input: Parameters<typeof placementStep>[1], shown: { part: string; number: number } | null) =>
    start(async () => {
      const next = await placementStep(language, input, shown);
      setAsking(false);
      if (next) setScreen(next);
      else home();
    });

  if (screen.kind === "done") return <Result language={language} languageName={languageName} result={screen.result} comingSoon={comingSoon} onHome={home} />;

  const progress = screen.kind === "question" ? (screen.number - 1) / Math.max(1, screen.size) : null;
  const partName =
    screen.kind === "question" ? t(screen.part === "vocab" ? "learn.placement.partVocab" : "learn.placement.partGrammar", { level: screen.level }) : t(screen.track === "listening" ? "learn.placement.partListening" : "learn.placement.partReading", { level: screen.level });

  return (
    <main className="app">
      <div className="screen fill">
        <div className="sbar">
          <button type="button" className="icon-btn" aria-label={t("learn.placement.later")} title={t("learn.placement.later")} onClick={home}>
            <Icon name="l-x" />
          </button>
          {progress === null ? (
            <div className="track" aria-hidden="true" />
          ) : (
            <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
              <span style={{ "--p": `${Math.round(progress * 100)}%` } as CSSProperties} />
            </div>
          )}
          <span style={{ width: 44 }} />
        </div>
        <p className="plan num" data-placement-part>
          {screen.kind === "question" ? t("learn.placement.counter", { part: partName, n: screen.number, of: screen.size }) : partName}
        </p>
        <p className="promise">{t("learn.placement.idkLine")}</p>
        {screen.kind === "question" ? (
          <div className="screen-body" key={`${screen.part}:${screen.level}:${screen.number}`}>
            <Exercise
              id={`pl:${screen.part}:${screen.level}:${screen.number}`}
              ex={screen.ex}
              language={language as Lang}
              languageName={languageName}
              verdict={null}
              muted={false}
              tip={false}
              submit={(raw: RawAnswer) => {
                if (pending) return null;
                sfx("press", 0.3);
                send({ answer: raw }, { part: screen.part, number: screen.number });
                return null;
              }}
            />
          </div>
        ) : (
          <TextStage
            key={`${screen.track}:${screen.view.id}`}
            id={`pl:${screen.track}:${screen.view.id}`}
            view={screen.view}
            info={{ textId: screen.view.id, track: screen.track, attempt: 2, stage: "again", set: "A", borrowed: false, rules: screen.rules, cost: 0, resume: null }}
            prefill={{}}
            language={language}
            submit={(raw) => send({ answers: ("answers" in raw ? raw.answers : {}) as Record<string, QuestionAnswer> }, { part: screen.track, number: 0 })}
          />
        )}
        <div className="cta">
          {asking ? (
            <div className="end-note" role="alertdialog" aria-label={t("learn.placement.stopAsk")}>
              <p>{t("learn.placement.stopAsk")}</p>
              <div className="row">
                <button type="button" className="secondary" disabled={pending} onClick={() => send({ stop: true }, null)}>
                  {t("learn.placement.stopYes")}
                </button>
                <button type="button" className="ghost" disabled={pending} onClick={() => setAsking(false)}>
                  {t("learn.placement.stopNo")}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="ghost" disabled={pending} onClick={() => setAsking(true)}>
              {t("learn.placement.stop")}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}

function Result({
  language,
  languageName,
  result,
  comingSoon,
  onHome,
}: {
  language: string;
  languageName: string;
  result: Extract<PlacementScreen, { kind: "done" }>["result"];
  comingSoon: string | null;
  onHome: () => void;
}) {
  const levels: Record<(typeof SKILLS)[number], string> = { vocab: result.fv, grammar: result.fg, listening: result.listening, reading: result.reading };
  return (
    <main className="app">
      <div className="screen fill">
        <header className="intro-head" style={{ paddingTop: "4vh" }}>
          <h1>{t("learn.placement.resultTitle", { language: languageName })}</h1>
          <p className="promise">{result.stopped ? t("learn.placement.resultStopped") : t("learn.placement.resultLead")}</p>
        </header>
        <ul className="choices" aria-label={t("learn.placement.resultTitle", { language: languageName })} data-placement-result>
          {SKILLS.map((skill) => (
            <li key={skill} className="choice" data-skill={skill}>
              <span>{t(`learn.skill.${skill}`)}</span>
              <b className="lat" lang="en" dir="ltr">
                {levels[skill]}
              </b>
            </li>
          ))}
        </ul>
        {result.above ? (
          <p className="promise" role="status">
            {t(result.above === "path" ? "learn.placement.abovePath" : "learn.placement.aboveContent")}
            {comingSoon ? ` ${comingSoon}` : ""}
          </p>
        ) : null}
        {result.pv ? <p className="promise">{t("learn.placement.sampleNote", { level: result.pv })}</p> : null}
        <div className="cta">
          <button
            type="button"
            className="primary jelly-press"
            data-lang={language}
            onPointerDown={(event) => squish(event.currentTarget)}
            onClick={() => {
              sfx("release", 0.45);
              onHome();
            }}
          >
            {t("learn.placement.toHome")}
          </button>
        </div>
      </div>
    </main>
  );
}

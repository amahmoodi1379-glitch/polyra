"use client";

import { useEffect, useRef } from "react";
import { Mixed } from "@/components/learn/mixed";
import { pop, springIn, squish } from "@/components/learn/motion";
import { say } from "@/components/learn/speak";
import type { Ex } from "@/engine/ex";
import type { Graded } from "@/engine/grade";
import type { Card, SessionPlan } from "@/engine/session";
import { parseItemKey } from "@/engine/state";
import { t, tRich } from "@/i18n";
import { MiniPlay, WordText } from "./cards";
import { rightAnswer } from "./exercise";

/**
 * The sheet after every answer (PRD §3.5): the verdict, the right answer, why it was nearly right,
 * and after a mistake the word with its example or the unit's one-line rule. The sentence or word
 * plays by itself unless sound is off.
 */

const tones = { correct: "ok", near: "ok", wrong: "bad", idk: "idk" } as const;

const marks = {
  ok: <path d="M5 12.5l4.5 4.5L19 7" />,
  bad: <path d="M17 7L7 17M7 7l10 10" />,
  idk: <path d="M12 7.5v6M12 16.8v.2" />,
};

export function Feedback({
  verdict,
  ex,
  card,
  plan,
  language,
  muted,
  onContinue,
}: {
  verdict: Graded;
  ex: Ex;
  card: Card;
  plan: SessionPlan;
  language: string;
  muted: boolean;
  onContinue: () => void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const tone = tones[verdict.result];

  useEffect(() => {
    springIn(sheet.current);
    pop(mark.current);
    next.current?.focus({ preventScroll: true });
    if (!ex.after || muted) return;
    const timer = window.setTimeout(() => say(`fb:${card.id}`, ex.after!), 420);
    return () => window.clearTimeout(timer);
    // One sheet per answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const answer = verdict.result === "correct" ? null : rightAnswer(ex);
  const item = card.item.startsWith("t:") ? null : parseItemKey(card.item);
  const word = item?.type === "word" ? plan.words[item.id] : undefined;
  const lesson = item?.type === "grammar_unit" ? plan.lessons[item.id] : undefined;
  const missed = verdict.result === "wrong" || verdict.result === "idk";
  const sentence = ex.q.sentence;
  const why =
    verdict.result === "near" && verdict.reason
      ? verdict.reason === "gender"
        ? tRich("learn.fb.why.gender", { article: <span className="lat">{ex.a.kind === "type" && ex.a.gender ? ex.a.gender.correct : (word?.word.article ?? "")}</span> })
        : verdict.reason === "case" && language === "de" && word?.word.pos === "noun"
          ? t("learn.fb.germanCase")
          : t(`learn.fb.why.${verdict.reason}`)
      : null;

  return (
    <div className="fb" data-tone={tone}>
      <div className="fb-card" ref={sheet} role="status" aria-live="polite">
        <div className="fb-head">
          <div className="fb-title">
            <span className="fb-mark" ref={mark} aria-hidden="true">
              <svg viewBox="0 0 24 24">{marks[tone]}</svg>
            </span>
            {t(`learn.fb.${verdict.result}`)}
          </div>
          {ex.after ? <MiniPlay id={`fb:${card.id}`} speak={ex.after} label={t("learn.session.playAgain")} /> : null}
        </div>
        {answer ? (
          <p className="fb-answer">
            {verdict.result === "idk" ? t("learn.fb.idkAnswer") : t("learn.fb.answer")}{" "}
            <span className="lat" lang={language} dir="ltr">
              {answer}
            </span>
          </p>
        ) : null}
        {why ? <p className="fb-why">{why}</p> : null}
        {missed && word ? (
          <div className="fb-word">
            <WordText word={word.word} />
            <span>{word.word.meaning}</span>
          </div>
        ) : null}
        {missed && word?.example && word.example.id !== sentence?.id ? (
          <p className="fb-ex">
            <span className="lat" lang={language} dir="ltr">
              {word.example.text}
            </span>
            {word.example.translation ? <span>{word.example.translation}</span> : null}
          </p>
        ) : null}
        {missed && lesson ? (
          <p className="fb-why">
            <b>{t("learn.session.rule")}: </b>
            <Mixed text={lesson.ruleLine} />
          </p>
        ) : null}
        {sentence?.translation && verdict.result !== "correct" ? <p className="fb-tr">{sentence.translation}</p> : null}
        <button
          ref={next}
          type="button"
          className="primary jelly-press"
          onPointerDown={(event) => squish(event.currentTarget)}
          onClick={onContinue}
        >
          {t("learn.session.continue")}
        </button>
      </div>
    </div>
  );
}

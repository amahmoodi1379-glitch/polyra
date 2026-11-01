"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/learn/icons";
import { squish } from "@/components/learn/motion";
import { sfx } from "@/components/learn/sfx";
import { hush } from "@/components/learn/speak";
import type { Gloss, RawAnswer } from "@/engine/ex";
import type { QuestionAnswer } from "@/engine/questions";
import type { TextCard, TextOutcome, TextView, WordCard } from "@/engine/session";
import { TEXT_RULE } from "@/engine/texts";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { MiniPlay, WordText } from "./cards";
import { Keyboard, SpecialRow, useTouchKeyboard } from "./keyboard";
import { TextBody } from "./text-body";
import { complete, QuestionBlock, ReviewQuestion, type Answers } from "./text-questions";
import { sentenceStarts, useTextSound, type TextSound } from "./text-sound";

/**
 * A text in a session (PRD §7.3–7.5): «کلمه‌های این متن» before the first attempt, one stage of an
 * attempt with all its questions on one screen, and the review page after each attempt.
 */

export type TextProgressNote = { answers: Answers; plays: number; positionMs: number };

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const into = (el: Element | null, block: ScrollLogicalPosition = "center") => el?.scrollIntoView({ block, behavior: reduced() ? "auto" : "smooth" });

const attemptsOf = (band: number) => (band === 1 ? TEXT_RULE.band1Attempts : TEXT_RULE.attempts);

function Kicker({ view, info }: { view: TextView; info: Pick<TextCard, "attempt" | "stage"> | null }) {
  const listening = view.track === "listening";
  return (
    <p className="ask">
      <Icon name={listening ? "i-listen" : "i-read"} />
      <span>
        {[
          view.level,
          listening ? t("learn.text.listening") : t("learn.text.reading"),
          info
            ? info.stage === "help"
              ? t("learn.text.attemptHelp", { n: formatNumber(info.attempt) })
              : t("learn.text.attemptOf", { n: formatNumber(info.attempt), of: formatNumber(attemptsOf(view.band)) })
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </p>
  );
}

// ───────────────────────────── «کلمه‌های این متن» ─────────────────────────────

export function TextWordsFace({ id, view, words }: { id: string; view: TextView | undefined; words: WordCard[] }) {
  return (
    <>
      {view ? <Kicker view={view} info={null} /> : null}
      <h1 className="tx-title">{t("learn.text.wordsTitle")}</h1>
      <p className="tx-lead">{t("learn.text.wordsLead")}</p>
      <ul className="tx-words">
        {words.map((item) => (
          <li key={item.word.id}>
            <WordText word={item.word} />
            <span className="m">{item.word.meaning}</span>
            <MiniPlay id={`tw:${id}:${item.word.id}`} speak={item.word.speak} />
          </li>
        ))}
      </ul>
    </>
  );
}

// ───────────────────────────── the sound ─────────────────────────────

function Segments({ view, current }: { view: TextView; current: number | null }) {
  const starts = sentenceStarts(view);
  const end = view.audio ? view.audio.durationSec * 1000 : starts[starts.length - 1] + (view.sentences[starts.length - 1]?.text.split(/\s+/).length ?? 1) * (1000 / TEXT_RULE.deviceWordsPerSec);
  return (
    <div className="tx-segs" aria-hidden="true">
      {starts.map((start, i) => (
        <span key={i} className={cn(current !== null && i < current && "done", current === i && "now")} style={{ flexGrow: Math.max(1, (starts[i + 1] ?? end) - start) }} />
      ))}
    </div>
  );
}

function SoundPanel({ view, sound, slow, onSlow, bySentence }: { view: TextView; sound: TextSound; slow: boolean | null; onSlow: (next: boolean) => void; bySentence: boolean }) {
  const spent = sound.left === 0 && !sound.paused && !sound.playing;
  const label = sound.playing ? t("learn.text.pause") : sound.paused ? t("learn.text.goOn") : spent ? t("learn.text.noPlays") : sound.plays === 0 ? t("learn.text.play") : t("learn.text.playAgain");
  return (
    <section className="tx-sound" aria-label={t("learn.text.sound")}>
      <div className="tx-sound-row">
        <button type="button" className={cn("tx-play jelly-press", sound.playing && "on")} disabled={spent} aria-label={label} onPointerDown={(event) => !spent && squish(event.currentTarget)} onClick={sound.toggle}>
          <Icon name={sound.playing ? "l-pause" : "l-play"} />
        </button>
        <div className="tx-sound-m">
          <p className="state">
            <b>{label}</b>
            {sound.left !== null && !spent ? <span>{t("learn.text.playsLeft", { n: formatNumber(sound.left) })}</span> : null}
          </p>
          <Segments view={view} current={sound.sentenceAt} />
        </div>
        {slow !== null ? (
          <button type="button" className="act" aria-pressed={slow} onClick={() => onSlow(!slow)}>
            <Icon name="l-tempo" className="i s" />
            {t("learn.session.slow")}
          </button>
        ) : null}
      </div>
      {bySentence ? (
        <div className="tx-by">
          <p>{t("learn.text.bySentence")}</p>
          <div className="tx-nums" role="group" aria-label={t("learn.text.bySentence")}>
            {view.sentences.map((_, i) => (
              <button key={i} type="button" className="num" aria-label={t("learn.text.sentenceN", { n: formatNumber(i + 1) })} onClick={() => sound.sentence(i)}>
                {formatNumber(i + 1)}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ───────────────────────────── one stage ─────────────────────────────

function leadOf(info: TextCard): string {
  const listening = info.track === "listening";
  if (info.stage === "first") return t("learn.text.leadFirst");
  if (info.stage === "help") return listening ? t("learn.text.leadHelpListening") : t("learn.text.leadHelpReading");
  if (info.attempt === 3) return listening ? t("learn.text.leadExamListening") : t("learn.text.leadExamReading");
  return listening ? t("learn.text.leadAgainListening") : t("learn.text.leadAgainReading");
}

const clock = (sec: number) => `${formatNumber(Math.floor(sec / 60))}:${formatNumber(sec % 60).padStart(2, formatNumber(0))}`;

export function TextStage({
  id,
  view,
  info,
  prefill,
  language,
  submit,
  onTap,
  onProgress,
}: {
  id: string;
  view: TextView;
  info: TextCard;
  /** The answers to start from: the attempt's own when it goes on, else the first round's with help. */
  prefill: Answers;
  language: string;
  submit: (raw: RawAnswer) => void;
  onTap?: (gloss: Gloss) => void;
  /** Where the stage stands, now and then, so a session closed half-way goes on from here; none in the panel's preview. */
  onProgress?: (note: TextProgressNote) => void;
}) {
  const questions = view.questions[info.set];
  const rules = info.rules;
  const listening = info.track === "listening";
  const resume = info.resume;
  const touch = useTouchKeyboard();
  const [answers, setAnswers] = useState<Answers>(prefill);
  const [slow, setSlow] = useState(false);
  const [picking, setPicking] = useState<number | null>(null);
  const [typing, setTyping] = useState<number | null>(null);
  const done = useRef(false);
  const body = useRef<HTMLDivElement>(null);

  // A timed reading counts on from where it stopped: its place is the time spent (DECISIONS.md).
  const spentBefore = listening ? 0 : (resume?.positionMs ?? 0);
  const [openedAt] = useState(() => Date.now());
  const elapsedMs = useCallback(() => spentBefore + (Date.now() - openedAt), [spentBefore, openedAt]);
  const [leftSec, setLeftSec] = useState(() => (rules.timedSec === null ? null : Math.max(0, Math.ceil(rules.timedSec - spentBefore / 1000))));

  const report = useRef<() => void>(() => {});
  const sound = useTextSound(view, {
    id: `text:${id}`,
    limit: rules.plays,
    plays: resume?.plays ?? 0,
    positionMs: listening ? (resume?.positionMs ?? 0) : 0,
    slow,
    onChange: () => window.setTimeout(() => report.current(), 60),
  });

  // The note sent to the server: only when something changed since the last one.
  const latest = useRef({ answers, sound });
  useEffect(() => {
    latest.current = { answers, sound };
  });
  const sent = useRef(JSON.stringify([answers, resume?.plays ?? 0, Math.round((resume?.positionMs ?? 0) / 1000)]));
  useEffect(() => {
    report.current = () => {
      if (!onProgress || done.current) return;
      const { answers: given, sound: now } = latest.current;
      const positionMs = listening ? now.positionMs() : elapsedMs();
      const key = JSON.stringify([given, now.plays, Math.round(positionMs / 1000)]);
      if (key === sent.current) return;
      sent.current = key;
      onProgress({ answers: given, plays: now.plays, positionMs });
    };
  }, [onProgress, listening, elapsedMs]);
  useEffect(() => {
    const timer = window.setTimeout(() => report.current(), 1200);
    return () => window.clearTimeout(timer);
  }, [answers]);
  useEffect(() => {
    const every = window.setInterval(() => report.current(), 10_000);
    const hidden = () => document.visibilityState === "hidden" && report.current();
    const leave = () => report.current();
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", leave);
    return () => {
      window.clearInterval(every);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", leave);
      // Closing the session in the middle keeps the place.
      report.current();
    };
  }, []);

  const send = useCallback(
    (timedOut: boolean) => {
      if (done.current) return;
      done.current = true;
      hush();
      const given = latest.current.answers;
      const finished = Object.fromEntries(questions.filter((question) => complete(question, given[String(question.id)])).map((question) => [String(question.id), given[String(question.id)]]));
      submit({ answers: finished, ...(timedOut ? { timedOut: true } : {}) });
    },
    [questions, submit],
  );

  // Time of a timed reading: what is not answered when it runs out is wrong (PRD §7.4).
  useEffect(() => {
    if (rules.timedSec === null) return;
    const limit = rules.timedSec;
    const tick = () => {
      const left = Math.max(0, Math.ceil(limit - elapsedMs() / 1000));
      setLeftSec(left);
      if (left === 0) send(true);
    };
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [rules.timedSec, elapsedMs, send]);

  const set = (id: number, answer: QuestionAnswer | undefined) =>
    setAnswers((before) => {
      const next = { ...before };
      if (answer) next[String(id)] = answer;
      else delete next[String(id)];
      return next;
    });
  const textOf = (id: number) => {
    const answer = answers[String(id)];
    return answer && "text" in answer ? answer.text : "";
  };
  const insert = (text: string) => {
    if (typing === null) return;
    const before = textOf(typing);
    const field = document.getElementById(`tf-${typing}`) as HTMLInputElement | HTMLTextAreaElement | null;
    if (touch || !field || field.selectionStart === null) {
      set(typing, { text: before + text });
      return;
    }
    const start = field.selectionStart;
    const end = field.selectionEnd ?? start;
    set(typing, { text: before.slice(0, start) + text + before.slice(end) });
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(start + text.length, start + text.length);
    });
  };
  const erase = () => {
    if (typing === null) return;
    const next = [...textOf(typing)].slice(0, -1).join("");
    set(typing, next ? { text: next } : undefined);
  };

  const pickQuestion = questions.find((question) => question.id === picking);
  const chosen = pickQuestion ? answers[String(pickQuestion.id)] : undefined;
  const unanswered = questions.filter((question) => !complete(question, answers[String(question.id)])).length;
  const any = unanswered < questions.length;

  return (
    <>
      <div className="screen-body tx">
        <header className="tx-head">
          <Kicker view={view} info={info} />
          <h1 className="tx-title lat" lang={language} dir="ltr">
            {view.title}
          </h1>
          <p className="tx-lead">{leadOf(info)}</p>
        </header>
        {leftSec !== null ? (
          <p className={cn("tx-timer num", leftSec <= 30 && "low")} role="timer" aria-live={leftSec <= 30 ? "polite" : "off"}>
            <Icon name="l-clock" className="i s" />
            {t("learn.text.timeLeft", { time: clock(leftSec) })}
          </p>
        ) : null}
        {listening ? (
          // In listening the text is never on the screen while answering (PRD §7.3).
          <SoundPanel view={view} sound={sound} slow={rules.slow ? slow : null} onSlow={setSlow} bySentence={rules.bySentence} />
        ) : (
          <div ref={body}>
            {pickQuestion ? <p className="tx-picking">{t("learn.text.pickNow")}</p> : null}
            <TextBody
              view={view}
              language={language}
              wordTap={rules.wordTap}
              translations={rules.translations ? "tap" : "never"}
              pick={
                pickQuestion
                  ? {
                      chosen: chosen && "sentence" in chosen ? chosen.sentence : null,
                      onPick: (index) => {
                        set(pickQuestion.id, { sentence: index });
                        setPicking(null);
                        sfx("toggle", 0.35);
                        requestAnimationFrame(() => into(document.getElementById(`tq-${pickQuestion.id}`)));
                      },
                    }
                  : null
              }
              onTap={onTap}
            />
          </div>
        )}
        <h2 className="tx-h2">{t("learn.text.questions", { n: formatNumber(questions.length) })}</h2>
        <ol className="tx-qs">
          {questions.map((question, index) => (
            <QuestionBlock
              key={question.id}
              question={question}
              index={index}
              answer={answers[String(question.id)]}
              band={view.band}
              canTranslate={info.attempt === 1}
              language={language}
              set={(answer) => set(question.id, answer)}
              playSentence={sound.sentence}
              typing={{ touch, active: typing === question.id, focus: () => setTyping(question.id) }}
              find={{
                active: picking === question.id,
                start: () => {
                  const next = picking === question.id ? null : question.id;
                  setPicking(next);
                  if (next !== null) into(body.current, "start");
                },
                sentence: (index) => view.sentences[index]?.text ?? "",
              }}
            />
          ))}
        </ol>
      </div>
      <div className={cn("cta", touch && typing !== null && "with-kb")}>
        {any && unanswered > 0 ? <p className="tx-left">{t("learn.text.unanswered", { n: formatNumber(unanswered) })}</p> : null}
        <div className="row">
          {!any ? (
            <button type="button" className="ghost" onClick={() => send(false)}>
              {t("learn.session.idk")}
            </button>
          ) : null}
          <button
            type="button"
            className="primary jelly-press"
            disabled={!any}
            onPointerDown={(event) => any && squish(event.currentTarget)}
            onClick={() => {
              sfx("release", 0.45);
              send(false);
            }}
          >
            {t("learn.text.submit")}
          </button>
        </div>
        {typing !== null ? (
          touch ? (
            <>
              <button type="button" className="ghost tx-kb-close" onClick={() => setTyping(null)}>
                {t("learn.text.closeKeyboard")}
              </button>
              <Keyboard language={language} onKey={insert} onErase={erase} />
            </>
          ) : (
            <SpecialRow language={language} onKey={insert} />
          )
        ) : null}
      </div>
    </>
  );
}

// ───────────────────────────── the review page ─────────────────────────────

const DAY = 86_400_000;

export function TextReview({
  view,
  outcome,
  answers,
  timedOut,
  language,
  preview,
  onTap,
  onContinue,
}: {
  view: TextView;
  /** `state`: the text's state after the stage; none in the panel. */
  outcome: Pick<TextOutcome, "attempt" | "questions" | "graded"> & { state: TextOutcome["state"] | null };
  answers: Answers;
  timedOut: boolean;
  language: string;
  /** In the panel: no attempt comes next, so its line is left out. */
  preview?: boolean;
  onTap?: (gloss: Gloss) => void;
  onContinue: () => void;
}) {
  const [slow, setSlow] = useState(false);
  const [translated, setTranslated] = useState(true);
  const sound = useTextSound(view, { id: `review:${view.id}`, limit: null, plays: 0, positionMs: 0, slow });
  const n = outcome.questions.length;
  const right = outcome.graded.filter((item) => item.result === "correct").length;
  const first = outcome.attempt === 1 ? outcome.state?.scores.find((score) => score.attempt === 1) : null;
  const next = outcome.state?.nextAttemptAt;
  const last = outcome.state?.lastAttemptAt;
  const days = next && last ? Math.max(1, Math.round((new Date(next).getTime() - new Date(last).getTime()) / DAY)) : null;
  const finds = outcome.questions.flatMap((question) => (question.type === "find" ? [question.correctSentence] : []));
  return (
    <>
      <div className="screen-body tx">
        <header className="tx-head">
          <Kicker view={view} info={null} />
          <h1 className="tx-title">{t("learn.text.reviewTitle")}</h1>
          <p className="tx-score num">
            {first ? (
              <>
                <span>{t("learn.text.firstScore", { n: formatNumber(Math.round(first.score * n)), of: formatNumber(n) })}</span>
                <span>{t("learn.text.helpScore", { n: formatNumber(right), of: formatNumber(n) })}</span>
              </>
            ) : (
              <span>{t("learn.text.score", { n: formatNumber(right), of: formatNumber(n) })}</span>
            )}
          </p>
          {preview ? null : <p className="tx-lead">{days ? t("learn.text.nextIn", { n: formatNumber(days) }) : t("learn.text.allDone")}</p>}
        </header>
        <SoundPanel view={view} sound={sound} slow={slow} onSlow={setSlow} bySentence={false} />
        <div className="tx-title-row">
          <h2 className="tx-h2 lat" lang={language} dir="ltr">
            {view.title}
          </h2>
          <button type="button" className="tx-tr" aria-pressed={translated} onClick={() => setTranslated(!translated)}>
            {translated ? t("learn.text.hideTranslations") : t("learn.text.showTranslations")}
          </button>
        </div>
        <TextBody view={view} language={language} wordTap translations={translated ? "always" : "tap"} play={sound.sentence} current={sound.sentenceAt} marked={finds} onTap={onTap} />
        <h2 className="tx-h2">{t("learn.text.answers")}</h2>
        <ol className="tx-qs">
          {outcome.questions.map((question, index) => (
            <ReviewQuestion
              key={question.id}
              question={question}
              answer={answers[String(question.id)]}
              graded={outcome.graded[index]}
              view={view}
              language={language}
              timedOut={timedOut}
            />
          ))}
        </ol>
      </div>
      <div className="cta">
        <button
          type="button"
          className="primary jelly-press"
          onPointerDown={(event) => squish(event.currentTarget)}
          onClick={() => {
            hush();
            sfx("page", 0.4);
            onContinue();
          }}
        >
          {t("learn.session.continue")}
        </button>
      </div>
    </>
  );
}

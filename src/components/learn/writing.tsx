"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { squish } from "@/components/learn/motion";
import { sfx } from "@/components/learn/sfx";
import { useToast } from "@/components/learn/toast";
import { writingWords, type WritingTaskC } from "@/engine/production";
import { t } from "@/i18n";

/**
 * The weekly guided writing (PRD §8b.6): the prompt and its useful phrases, a box with the word count,
 * «تمام شد» once enough is written, then the writing beside the model answer with the checklist to tick.
 * Nothing is scored; the text is kept in «نوشته‌های من».
 */

type Model = Pick<WritingTaskC, "checklist" | "modelAnswer" | "modelAnswerFa">;

/** The writing beside the model answer, with its checklist; ticks are saved as they change (not for a try or in «بازبینی», id null). */
export function WrittenView({ id, text, ticks: initial, task, language }: { id: number | null; text: string; ticks: number[]; task: Model; language: string }) {
  const toast = useToast();
  const [ticks, setTicks] = useState(initial);
  const [showFa, setShowFa] = useState(false);
  const toggle = async (index: number) => {
    const next = ticks.includes(index) ? ticks.filter((tick) => tick !== index) : [...ticks, index].sort((a, b) => a - b);
    setTicks(next);
    sfx("toggle", 0.35);
    if (id === null) return;
    const response = await fetch("/api/learn/writing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, ticks: next }),
    }).catch(() => null);
    if (!response?.ok) toast(t("learn.writing.failed"));
  };
  return (
    <>
      <div className="side">
        <section>
          <h3>{t("learn.writing.mine")}</h3>
          <p className="written" lang={language} dir="ltr">
            {text}
          </p>
        </section>
        <section>
          <h3>{t("learn.writing.model")}</h3>
          <p className="written" lang={language} dir="ltr">
            {task.modelAnswer}
          </p>
          {showFa ? (
            <p className="tr">{task.modelAnswerFa}</p>
          ) : (
            <button type="button" className="ghost" onClick={() => setShowFa(true)}>
              {t("learn.writing.modelFa")}
            </button>
          )}
        </section>
      </div>
      {task.checklist.length > 0 ? (
        <section className="write-box">
          <h3 className="prod-kicker">{t("learn.writing.checklist")}</h3>
          <ul className="ticks">
            {task.checklist.map((item, index) => (
              <li key={index}>
                <label>
                  <input type="checkbox" checked={ticks.includes(index)} onChange={() => void toggle(index)} />
                  <span>{item}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

export function WritingEditor({
  language,
  task,
  minToFinish,
  trying,
  preview = false,
}: {
  language: string;
  task: WritingTaskC;
  minToFinish: number;
  trying: boolean;
  /** «بازبینی»: the same page in the panel's phone frame; nothing is sent or saved. */
  preview?: boolean;
}) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [state, setState] = useState<"write" | "sending" | "done">("write");
  /** The stored writing; null for a try or in «بازبینی», where nothing is kept. */
  const [saved, setSaved] = useState<number | null>(null);
  const started = useRef<number | null>(null);
  const active = useRef(0);
  const last = useRef<number | null>(null);
  const words = writingWords(text);

  /** Only time spent typing counts (PRD §15.4): gaps over a minute are left out. */
  const touch = () => {
    const now = Date.now();
    if (started.current === null) started.current = now;
    if (last.current !== null) active.current += Math.min(now - last.current, 60_000);
    last.current = now;
  };

  useEffect(() => {
    if (state !== "write" || text === "") return;
    const leave = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [state, text]);

  const finish = async () => {
    if (preview) {
      sfx("success", 0.45);
      setSaved(null);
      setState("done");
      return;
    }
    setState("sending");
    const response = await fetch("/api/learn/writing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        language,
        taskId: task.id,
        text,
        ticks: [],
        seconds: Math.round(active.current / 1000),
      }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as {
      kind?: string;
      id?: number;
    } | null;
    if (!response?.ok || body?.kind !== "ok") {
      setState("write");
      toast(body?.kind === "locked" ? t("learn.writing.locked") : t("learn.writing.failed"));
      return;
    }
    sfx("success", 0.45);
    setSaved(body.id ?? null);
    setState("done");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (state === "done") {
    return (
      <>
        <div className="screen-body">
          {preview ? null : <p className="note">{saved === null ? t("learn.writing.triedNote") : t("learn.writing.saved")}</p>}
          <WrittenView id={saved} text={text.trim()} ticks={[]} task={task} language={language} />
        </div>
        {preview ? null : (
          <div className="cta">
            <Link className="primary jelly-press" href={`/learn/${language}`}>
              {t("learn.writing.back")}
            </Link>
            <Link className="ghost" href={`/learn/${language}/writings`}>
              {t("learn.writing.toList")}
            </Link>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      <div className="screen-body">
        {trying ? <p className="note">{t("learn.writing.trying")}</p> : null}
        <p className="write-prompt">{task.promptFa}</p>
        {task.phrases.length > 0 ? (
          <section className="write-box">
            <h3 className="prod-kicker">{t("learn.writing.phrases")}</h3>
            <ul className="phrases">
              {task.phrases.map((phrase, index) => (
                <li key={index}>
                  <span className="lat" lang={language} dir="ltr">
                    {phrase.text}
                  </span>
                  <span className="fa">{phrase.translationFa}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <label className="write-box">
          <textarea
            lang={language}
            dir="ltr"
            spellCheck={false}
            autoCapitalize="sentences"
            placeholder={t("learn.writing.placeholder")}
            value={text}
            disabled={state === "sending"}
            onChange={(event) => {
              touch();
              setText(event.target.value);
            }}
          />
          <span className="prod-kicker num">
            {t("learn.writing.count", {
              n: words,
              min: task.minWords,
              max: task.maxWords,
            })}
          </span>
        </label>
      </div>
      <div className="cta">
        {words < minToFinish ? <p className="prompt-sub">{t("learn.writing.needMore", { n: minToFinish })}</p> : null}
        <button
          type="button"
          className="primary jelly-press"
          disabled={words < minToFinish || state === "sending"}
          onPointerDown={(event) => squish(event.currentTarget)}
          onClick={() => void finish()}
        >
          {state === "sending" ? t("learn.writing.sending") : t("learn.writing.finish")}
        </button>
      </div>
    </>
  );
}

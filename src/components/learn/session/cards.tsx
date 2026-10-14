"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/learn/icons";
import { Mixed } from "@/components/learn/mixed";
import { squish } from "@/components/learn/motion";
import { sfx } from "@/components/learn/sfx";
import { Sheet } from "@/components/learn/sheet";
import { say, usePlaying } from "@/components/learn/speak";
import { useToast } from "@/components/learn/toast";
import type { Gender, Speak } from "@/engine/content";
import type { SentenceView, WordView } from "@/engine/ex";
import type { LessonView, TableView, WordCard } from "@/engine/session";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * The cards without a score (PRD §9.2): a new word, a grammar lesson, a new conjugation table and
 * «این دو را قاطی می‌کنی». The same word card opens from «کلمه‌های من» (PRD §3.10).
 */

export const genderClass = (gender: Gender | null) =>
  gender === "m" || gender === "der" ? "g-m" : gender === "f" || gender === "die" ? "g-f" : gender === "das" ? "g-n" : gender === "mf" ? "g-x" : undefined;

/** The word as written, with its article in the colour of its gender (DESIGN.md, «Gender»). */
export function WordText({ word }: { word: WordView }) {
  return (
    <span className="lat" lang={word.speak.lang}>
      {word.article ? <i className={cn("art", genderClass(word.gender))}>{word.article} </i> : null}
      {word.lemma}
    </span>
  );
}

export function Headword({ word, animate }: { word: WordView; animate?: boolean }) {
  const letters = [...word.lemma];
  return (
    <p className="headword lat" lang={word.speak.lang} dir="ltr" aria-label={word.display} style={{ "--len": Math.max(4, letters.length + (word.article ? 2 : 0)) } as CSSProperties}>
      {word.article ? <span className={cn("art", genderClass(word.gender))}>{word.article}</span> : null}
      {letters.map((char, index) => (
        <span key={index} aria-hidden="true" style={animate ? { animationDelay: `${0.06 + index * 0.05}s` } : undefined}>
          {char === " " ? " " : char}
        </span>
      ))}
    </p>
  );
}

export function PlayButton({ id, speak, big, slow, label, autoplay }: { id: string; speak: Speak; big?: boolean; slow?: boolean; label?: string; autoplay?: boolean }) {
  const playing = usePlaying(id);
  const started = useRef(false);
  useEffect(() => {
    if (!autoplay || started.current) return;
    started.current = true;
    const timer = window.setTimeout(() => say(id, speak, slow), 380);
    return () => window.clearTimeout(timer);
  }, [autoplay, id, speak, slow]);
  return (
    <button
      type="button"
      className={cn("play jelly-press", big && "big", playing && "playing")}
      aria-label={label ?? t("learn.session.playAgain")}
      onPointerDown={(event) => squish(event.currentTarget)}
      onClick={() => say(id, speak, slow)}
    >
      <Icon name="l-spk" />
    </button>
  );
}

export function MiniPlay({ id, speak, label }: { id: string; speak: Speak; label?: string }) {
  const playing = usePlaying(id);
  return (
    <button type="button" className={cn("mini-play", playing && "playing")} aria-label={label ?? t("learn.session.playSentence")} onClick={() => say(id, speak)}>
      <Icon name="l-spk1" className="i s" />
    </button>
  );
}

/** A sentence with the learned word in italics, its translation and its sound. */
export function Example({ id, sentence, wordId, label }: { id: string; sentence: SentenceView; wordId?: number; label?: string }) {
  const marks = sentence.glosses.filter((gloss) => wordId !== undefined && gloss.wordId === wordId);
  const parts: ReactNode[] = [];
  let at = 0;
  for (const mark of marks) {
    if (mark.start < at) continue;
    parts.push(sentence.text.slice(at, mark.start));
    parts.push(<em key={mark.start}>{sentence.text.slice(mark.start, mark.end)}</em>);
    at = mark.end;
  }
  parts.push(sentence.text.slice(at));
  return (
    <div className="example">
      <div className="h">
        <span>{label ?? t("learn.session.example")}</span>
        <MiniPlay id={`${id}:ex`} speak={sentence.speak} />
      </div>
      <p className="tl lat" lang={sentence.speak.lang} dir="ltr">
        {parts}
      </p>
      {sentence.translation ? <p className="fa">{sentence.translation}</p> : null}
    </div>
  );
}

/** «صدای خودت» (PRD §5.2): up to five seconds from the microphone, played back at once and kept nowhere. */
function Recorder({ seconds = 5 }: { seconds?: number }) {
  const toast = useToast();
  const [state, setState] = useState<"idle" | "recording">("idle");
  const [denied, setDenied] = useState(() => {
    try {
      return sessionStorage.getItem("polyra.mic") === "denied";
    } catch {
      return false;
    }
  });
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  if (denied || typeof MediaRecorder === "undefined") return null;

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => chunks.push(event.data);
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setState("idle");
        const url = URL.createObjectURL(new Blob(chunks, { type: media.mimeType }));
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        void audio.play().catch(() => URL.revokeObjectURL(url));
      };
      recorder.current = media;
      media.start();
      setState("recording");
      sfx("toggle", 0.4);
      timer.current = window.setTimeout(() => media.state === "recording" && media.stop(), seconds * 1000);
    } catch {
      try {
        sessionStorage.setItem("polyra.mic", "denied");
      } catch {
        // Hidden for this visit only.
      }
      setDenied(true);
      toast(t("learn.session.micDenied"));
    }
  };
  const stop = () => {
    window.clearTimeout(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  return state === "recording" ? (
    <button type="button" className="act" aria-pressed="true" onClick={stop}>
      <Icon name="l-stop" className="i s" />
      {t("learn.session.recording")}
    </button>
  ) : (
    <button type="button" className="act" onClick={() => void start()}>
      <Icon name="l-mic" className="i s" />
      {t("learn.session.record")}
    </button>
  );
}

export function ConjTable({ table }: { table: TableView }) {
  return (
    <div className="conj" dir="ltr">
      {table.rows.map((row) => (
        <div key={row.pronoun}>
          <span className="p lat">{row.pronoun}</span>
          <span className="f lat">{row.form}</span>
        </div>
      ))}
    </div>
  );
}

/** The word card: meaning, sound, an example, collocations and its tables (PRD §5.2, §3.10). */
export function WordFace({ id, card, muted, autoplay, animate }: { id: string; card: WordCard; muted: boolean; autoplay: boolean; animate?: boolean }) {
  const [slow, setSlow] = useState(false);
  const [tables, setTables] = useState(false);
  const { word } = card;
  return (
    <>
      <div className={cn("word", animate && "enter")}>
        {card.knownMeaning ? <p className="known-as">{t("learn.session.knownAs", { meaning: card.knownMeaning })}</p> : null}
        <Headword word={word} animate={animate} />
        <p className="meaning">{word.meaning}</p>
        {word.meanings.length > 1 ? <p className="note">{word.meanings.slice(1).join("، ")}</p> : null}
        {word.noteFa ? (
          <p className="note">
            <Mixed text={word.noteFa} />
          </p>
        ) : null}
        {word.image ? <img className="word-img" src={word.image} alt="" /> : null}
        <div className="aud">
          <PlayButton id={`${id}:word`} speak={word.speak} slow={slow} autoplay={autoplay && !muted} />
          <button
            type="button"
            className="act"
            aria-pressed={slow}
            onClick={() => {
              setSlow(!slow);
              sfx("toggle", 0.4);
              say(`${id}:word`, word.speak, !slow);
            }}
          >
            <Icon name="l-tempo" className="i s" />
            {t("learn.session.slow")}
          </button>
          {muted ? null : <Recorder />}
          {card.tables.length > 0 ? (
            <button type="button" className="act" onClick={() => setTables(true)}>
              <Icon name="l-table" className="i s" />
              {t("learn.session.conjugation")}
            </button>
          ) : null}
        </div>
      </div>
      {card.example ? <Example id={id} sentence={card.example} wordId={word.id} /> : null}
      {card.collocations.length > 0 ? (
        <div className="coll">
          <p>{t("learn.session.collocations")}</p>
          {card.collocations.map((item) => (
            <div key={item.text}>
              <span className="lat" lang={word.speak.lang} dir="ltr">
                {item.text}
              </span>
              <span>{item.translation_fa}</span>
            </div>
          ))}
        </div>
      ) : null}
      {card.tables.length > 0 ? (
        <Sheet open={tables} onClose={() => setTables(false)} labelledBy={`${id}-tables`}>
          <h2 id={`${id}-tables`}>{t("learn.session.tableTitle", { verb: word.lemma })}</h2>
          {card.tables.map((table) => (
            <div key={table.id} className="field">
              <span>{table.tense}</span>
              <ConjTable table={table} />
            </div>
          ))}
          <button type="button" className="ghost" onClick={() => setTables(false)}>
            {t("learn.skillSheet.close")}
          </button>
        </Sheet>
      ) : null}
    </>
  );
}

export function LessonFace({ id, lesson }: { id: string; lesson: LessonView }) {
  const [head, ...rows] = lesson.buildTable ?? [];
  return (
    <div className="lesson">
      <h1>
        <Mixed text={lesson.title} />
      </h1>
      {lesson.lesson
        .split(/\n{2,}/)
        .filter(Boolean)
        .map((paragraph, index) => (
          <p key={index} className="body">
            <Mixed text={paragraph} />
          </p>
        ))}
      {head ? (
        <div className="build">
          <table>
            <thead>
              <tr>
                {head.map((cell, index) => (
                  <th key={index}>
                    <Mixed text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column}>
                      <Mixed text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <p className="rule">
        <Mixed text={lesson.ruleLine} />
      </p>
      {lesson.examples.length > 0 ? (
        <div className="examples">
          {lesson.examples.map((sentence, index) => (
            <Example key={sentence.id} id={`${id}:${index}`} sentence={sentence} label={t("learn.session.examples")} />
          ))}
        </div>
      ) : null}
      {lesson.commonMistake ? (
        <p className="mistake">
          <Icon name="l-info" className="i s" />
          <span>
            <b>{t("learn.session.commonMistake")}: </b>
            <Mixed text={lesson.commonMistake} />
          </span>
        </p>
      ) : null}
    </div>
  );
}

export function TableFace({ id, table, muted }: { id: string; table: TableView; muted: boolean }) {
  return (
    <div className="lesson">
      <div className="verb-head">
        <span className="lat" dir="ltr">
          {table.verb}
        </span>
        <span className="tense">{table.tense}</span>
      </div>
      <ConjTable table={table} />
      {table.speak ? (
        <div className="aud">
          <PlayButton id={`${id}:table`} speak={table.speak} label={t("learn.session.playTable")} autoplay={!muted} />
        </div>
      ) : null}
    </div>
  );
}

export function ConfusionFace({ id, words }: { id: string; words: [WordCard, WordCard] }) {
  return (
    <div className="lesson">
      <h1>{t("learn.session.confusionTitle")}</h1>
      <p className="lead">{t("learn.session.confusionLead")}</p>
      <div className="duo">
        {words.map((card) => (
          <div key={card.word.id}>
            <WordText word={card.word} />
            <p>{card.word.meaning}</p>
            <MiniPlay id={`${id}:${card.word.id}`} speak={card.word.speak} label={t("learn.session.play")} />
          </div>
        ))}
      </div>
      {words.map((card) => (card.example ? <Example key={card.word.id} id={`${id}:x${card.word.id}`} sentence={card.example} wordId={card.word.id} /> : null))}
    </div>
  );
}

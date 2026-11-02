"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/learn/icons";
import { squish } from "@/components/learn/motion";
import { sfx } from "@/components/learn/sfx";
import { hush, say } from "@/components/learn/speak";
import { useToast } from "@/components/learn/toast";
import type { RawAnswer, SentenceView } from "@/engine/ex";
import { gradeErrorfix, type DialogueView, type ErrorfixView, type SpeakView } from "@/engine/production";
import type { Lang } from "@/engine/text";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { MiniPlay, PlayButton } from "./cards";

/**
 * The speaking screens (PRD §8b): «بگو، بعد بشنو» (S1), a situational dialogue turn by turn (S3) and
 * find the mistake (S4). Each screen runs its own steps and feedback, graded with the engine's own
 * functions, and hands the answer over only on its last «ادامه», so the session moves on after the
 * learner has seen everything. The panel's «بازبینی» shows the same screens.
 */

type Finish = (raw: RawAnswer) => void;

/** Up to ten seconds of the learner's voice, kept in this page only and never sent (PRD §8b.1, §5.2). */
const MAX_RECORD_SEC = 10;

function useRecorder() {
  const toast = useToast();
  const [state, setState] = useState<"idle" | "recording">("idle");
  const [url, setUrl] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const available = typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices;
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      recorder.current?.stream.getTracks().forEach((track) => track.stop());
    },
    [],
  );
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const media = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      media.ondataavailable = (event) => chunks.push(event.data);
      media.onstop = () => {
        stream.getTracks().forEach((track) => track.stop());
        setState("idle");
        setUrl(URL.createObjectURL(new Blob(chunks, { type: media.mimeType })));
      };
      recorder.current = media;
      media.start();
      setState("recording");
      sfx("toggle", 0.4);
      timer.current = window.setTimeout(() => media.state === "recording" && media.stop(), MAX_RECORD_SEC * 1000);
    } catch {
      toast(t("learn.session.micDenied"));
    }
  };
  const stop = () => {
    window.clearTimeout(timer.current);
    if (recorder.current?.state === "recording") recorder.current.stop();
  };
  const play = () => {
    if (!url) return;
    hush();
    void new Audio(url).play().catch(() => {});
  };
  return { available, state, url, start, stop, play };
}

function RecordButtons({ recorder }: { recorder: ReturnType<typeof useRecorder> }) {
  if (!recorder.available) return null;
  return (
    <div className="actions">
      {recorder.state === "recording" ? (
        <button type="button" className="act" aria-pressed="true" onClick={recorder.stop}>
          <Icon name="l-stop" className="i s" />
          {t("learn.session.recording")}
        </button>
      ) : (
        <button type="button" className="act" onClick={() => void recorder.start()}>
          <Icon name="l-mic" className="i s" />
          {recorder.url ? t("learn.speak.recordAgain") : t("learn.speak.record")}
        </button>
      )}
      {recorder.url && recorder.state === "idle" ? (
        <button type="button" className="act" onClick={recorder.play}>
          <Icon name="l-spk1" className="i s" />
          {t("learn.speak.playMine")}
        </button>
      ) : null}
    </div>
  );
}

function Primary({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="cta">
      <button
        type="button"
        className="primary jelly-press"
        disabled={disabled}
        onPointerDown={(event) => squish(event.currentTarget)}
        onClick={() => {
          sfx("release", 0.45);
          onClick();
        }}
      >
        {label}
      </button>
    </div>
  );
}

const Latin = ({ text, lang, className }: { text: string; lang: string; className?: string }) => (
  <span className={cn("lat", className)} lang={lang} dir="ltr">
    {text}
  </span>
);

// ───────────────────────────── S1 ─────────────────────────────

/** «بگو، بعد بشنو» (PRD §8b.2): say the Persian sentence aloud, then see and hear it and judge yourself. */
export function SpeakStage({ id, view, languageName, muted, onFinish }: { id: string; view: SpeakView; languageName: string; muted: boolean; onFinish: Finish }) {
  const [shown, setShown] = useState(false);
  const recorder = useRecorder();
  const sentence = view.sentence;
  return (
    <>
      <div className="screen-body speak" data-card={id}>
        <p className="ask">{t("learn.speak.ask", { language: languageName })}</p>
        <p className="prompt-fa big">{sentence.translation}</p>
        <RecordButtons recorder={recorder} />
        {shown ? (
          <div className="reveal">
            <div className="line">
              <PlayButton id={`${id}:s`} speak={sentence.speak} autoplay={!muted} />
              <Latin text={sentence.text} lang={sentence.speak.lang} className="tl" />
            </div>
          </div>
        ) : null}
      </div>
      {shown ? (
        <div className="cta rate" role="group" aria-label={t("learn.speak.rateLabel")}>
          {(["ok", "near", "no"] as const).map((rating) => (
            <button
              key={rating}
              type="button"
              className={cn(rating === "ok" ? "primary" : "ghost", "jelly-press")}
              onClick={() => {
                hush();
                sfx(rating === "ok" ? "success" : "release", 0.4);
                onFinish({ self: rating });
              }}
            >
              {t(`learn.speak.${rating}`)}
            </button>
          ))}
        </div>
      ) : (
        <Primary label={t("learn.speak.show")} onClick={() => (recorder.stop(), setShown(true))} />
      )}
    </>
  );
}

// ───────────────────────────── S3 ─────────────────────────────

/**
 * A situational dialogue (PRD §8b.4): the other side's line is played and written (its translation a tap
 * away in attempt 1), one of three answers is chosen, then right or wrong, why, and the right answer's
 * sound, with an optional «بلند بگو». Without sound it is read only (§8b.1).
 */
export function DialogueStage({
  id,
  view,
  attempt,
  sound,
  onFinish,
}: {
  id: string;
  view: DialogueView;
  attempt: number;
  /** False in a session without sound or after «الان نمی‌توانم گوش بدهم»: the reading mode. */
  sound: boolean;
  onFinish: Finish;
}) {
  const [turn, setTurn] = useState(0);
  const [firsts, setFirsts] = useState<number[]>([]);
  const [showFa, setShowFa] = useState(false);
  const recorder = useRecorder();
  const total = view.turns.length;
  const over = turn >= total;
  const current = view.turns[Math.min(turn, total - 1)];
  const chosen = firsts[turn];
  const answered = chosen !== undefined;
  const lang = current.line.speak.lang;

  useEffect(() => {
    if (!over && sound) {
      const timer = window.setTimeout(() => say(`${id}:l${turn}`, current.line.speak), 380);
      return () => window.clearTimeout(timer);
    }
  }, [turn]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (index: number) => {
    if (answered) return;
    const right = index === current.correct;
    sfx(right ? "success" : "error", 0.45);
    setFirsts([...firsts, index]);
    if (sound) window.setTimeout(() => say(`${id}:c${turn}`, current.choices[current.correct].speak), 500);
  };

  if (over) {
    const right = view.turns.filter((item, i) => firsts[i] === item.correct).length;
    return (
      <>
        <div className="screen-body dialogue" data-card={id}>
          <p className="kicker">{view.title}</p>
          <h2 className="score num">{t("learn.dialogue.score", { right, total })}</h2>
          <p className="muted">{attempt === 1 ? t("learn.dialogue.again") : t("learn.dialogue.over")}</p>
        </div>
        <Primary label={t("learn.session.continue")} onClick={() => onFinish({ turns: firsts })} />
      </>
    );
  }

  return (
    <>
      <div className="screen-body dialogue" data-card={id}>
        <p className="kicker num">
          {view.title} · {t("learn.dialogue.turn", { n: turn + 1, total })}
        </p>
        {turn === 0 ? <p className="situation">{view.situation}</p> : null}
        <div className="line other">
          {sound ? <MiniPlay id={`${id}:l${turn}`} speak={current.line.speak} /> : null}
          <div>
            {current.speaker ? <span className="speaker lat">{current.speaker}</span> : null}
            <Latin text={current.line.text} lang={lang} className="tl" />
            {attempt === 1 ? (
              showFa || answered ? (
                <p className="fa">{current.line.translation}</p>
              ) : (
                <button type="button" className="link" onClick={() => setShowFa(true)}>
                  {t("learn.dialogue.translate")}
                </button>
              )
            ) : null}
          </div>
        </div>
        <p className="ask">{t("learn.dialogue.ask")}</p>
        <div className="options" role="group">
          {current.choices.map((choice: SentenceView, index) => (
            <button
              key={choice.id}
              type="button"
              className={cn("opt", answered && index === current.correct && "ok", answered && index === chosen && index !== current.correct && "bad")}
              aria-pressed={chosen === index}
              disabled={answered}
              onClick={() => choose(index)}
            >
              <Latin text={choice.text} lang={lang} />
              {answered ? <span className="fa small">{choice.translation}</span> : null}
            </button>
          ))}
        </div>
        {answered ? (
          <div className={cn("why", chosen === current.correct ? "ok" : "bad")}>
            <b>{chosen === current.correct ? t("learn.dialogue.right") : t("learn.dialogue.wrong")}</b>
            <p>{current.whyFa}</p>
            {sound ? (
              <>
                <p className="muted small">{t("learn.dialogue.sayIt")}</p>
                <RecordButtons recorder={recorder} />
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {answered ? (
        <Primary
          label={turn + 1 < total ? t("learn.dialogue.next") : t("learn.dialogue.finish")}
          onClick={() => {
            hush();
            recorder.stop();
            setShowFa(false);
            setTurn(turn + 1);
          }}
        />
      ) : null}
    </>
  );
}

// ───────────────────────────── S4 ─────────────────────────────

/**
 * Find the mistake (PRD §8b.5): tap a word, type its right form, take it back any time, then «تمام».
 * The corrected text follows with each mistake and why, and the translation.
 */
export function ErrorfixStage({ id, view, language, onFinish }: { id: string; view: ErrorfixView; language: Lang; onFinish: Finish }) {
  const [fixes, setFixes] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [done, setDone] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing !== null) input.current?.focus();
  }, [editing]);

  const open = (index: number) => {
    if (done) return;
    setEditing(index);
    setDraft(fixes[String(index)] ?? view.pieces[index].text);
  };
  const keep = () => {
    if (editing === null) return;
    const next = { ...fixes };
    const value = draft.trim();
    if (value === "" || value === view.pieces[editing].text) delete next[String(editing)];
    else next[String(editing)] = value;
    setFixes(next);
    setEditing(null);
  };
  const undo = (index: number) => {
    const next = { ...fixes };
    delete next[String(index)];
    setFixes(next);
    setEditing(null);
  };

  if (done) {
    const graded = gradeErrorfix(view, fixes, language);
    return (
      <>
        <div className="screen-body errorfix" data-card={id}>
          <p className={cn("verdict", graded.result.ok ? "ok" : "bad")}>
            {graded.result.ok ? t("learn.errorfix.allRight") : t("learn.errorfix.result", { fixed: graded.result.fixed, of: graded.result.of })}
          </p>
          {graded.result.wrongTaps > 0 ? <p className="muted">{t("learn.errorfix.wrongTaps", { n: graded.result.wrongTaps })}</p> : null}
          <div className="line">
            <MiniPlay id={`${id}:all`} speak={view.speak} />
            <Latin text={view.corrected} lang={language} className="tl" />
          </div>
          <p className="fa">{view.translation}</p>
          <ol className="marks">
            {view.marks.map((mark, k) => (
              <li key={k} className={graded.marks[k] === "fixed" || graded.marks[k] === "near" ? "ok" : "bad"}>
                <span>
                  <s className="lat" dir="ltr">
                    {mark.wrong}
                  </s>{" "}
                  ←{" "}
                  <b className="lat" dir="ltr">
                    {mark.right}
                  </b>
                </span>
                <p>{mark.whyFa}</p>
              </li>
            ))}
          </ol>
        </div>
        <Primary label={t("learn.session.continue")} onClick={() => onFinish({ fixes })} />
      </>
    );
  }

  return (
    <>
      <div className="screen-body errorfix" data-card={id}>
        <p className="ask">{t("learn.errorfix.ask", { n: view.marks.length })}</p>
        <p className="tl lat errorfix-text" lang={language} dir="ltr">
          {view.pieces.map((piece, index) =>
            piece.word ? (
              <button
                key={index}
                type="button"
                className={cn("piece", fixes[String(index)] !== undefined && "changed", editing === index && "editing")}
                onClick={() => open(index)}
              >
                {fixes[String(index)] ?? piece.text}
              </button>
            ) : (
              <span key={index}>{piece.text}</span>
            ),
          )}
        </p>
        {editing !== null ? (
          <div className="fix-edit">
            <label>
              <span className="muted small">{t("learn.errorfix.typeRight", { word: view.pieces[editing].text })}</span>
              <input
                ref={input}
                className="lat"
                lang={language}
                dir="ltr"
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") keep();
                }}
              />
            </label>
            <div className="actions">
              <button type="button" className="act" onClick={keep}>
                {t("learn.errorfix.keep")}
              </button>
              {fixes[String(editing)] !== undefined ? (
                <button type="button" className="act" onClick={() => undo(editing)}>
                  {t("learn.errorfix.undo")}
                </button>
              ) : (
                <button type="button" className="act" onClick={() => setEditing(null)}>
                  {t("learn.errorfix.cancel")}
                </button>
              )}
            </div>
          </div>
        ) : null}
      </div>
      <Primary label={t("learn.errorfix.done")} disabled={editing !== null} onClick={() => setDone(true)} />
    </>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Pause, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { playFile, stopPlaying, usePlaying } from "./player";

/** One nudge of «کمی زودتر» or «کمی دیرتر». */
const NUDGE_MS = 100;
/** The least room a sentence keeps between its start and the next one. */
const MIN_GAP_MS = 100;

/** 0:03.4, in Persian digits. */
function clock(ms: number) {
  const tenths = Math.round(ms / 100);
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${formatNumber(minutes)}:${seconds < 10 ? formatNumber(0) : ""}${formatNumber(seconds)}٫${formatNumber(tenths % 10)}`;
}

/**
 * «هم‌زمان‌سازی» (PRD §13.8): the file plays and the teacher taps «جمله بعد» as each sentence starts;
 * then each sentence can be heard alone and its start moved a little. Gives the start of every
 * sentence in milliseconds, the first at 0.
 */
export function TextSync({
  url,
  durationMs,
  sentences,
  language,
  initial,
  saving,
  onSave,
  onCancel,
}: {
  url: string;
  durationMs: number;
  sentences: string[];
  language: string;
  initial?: number[];
  saving: boolean;
  onSave: (offsetsMs: number[]) => void;
  onCancel: () => void;
}) {
  const ready = initial && initial.length === sentences.length ? initial : null;
  const [marks, setMarks] = useState<number[]>(ready ?? [0]);
  const [phase, setPhase] = useState<"mark" | "check">(ready ? "check" : "mark");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [ended, setEnded] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const element = new Audio(url);
    element.preload = "auto";
    audio.current = element;
    const tick = () => {
      setPosition(element.currentTime * 1000);
      frame.current = requestAnimationFrame(tick);
    };
    element.onplay = () => {
      setPlaying(true);
      frame.current = requestAnimationFrame(tick);
    };
    element.onpause = () => {
      setPlaying(false);
      cancelAnimationFrame(frame.current);
    };
    element.onended = () => setEnded(true);
    return () => {
      element.pause();
      cancelAnimationFrame(frame.current);
      audio.current = null;
    };
  }, [url]);

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) {
      stopPlaying();
      setEnded(false);
      void element.play();
    } else element.pause();
  };

  const restart = () => {
    const element = audio.current;
    stopPlaying();
    setMarks([0]);
    setPhase("mark");
    setEnded(false);
    if (element) {
      element.pause();
      element.currentTime = 0;
      setPosition(0);
    }
  };

  const next = useCallback(() => {
    const element = audio.current;
    if (!element || element.paused || phase !== "mark") return;
    const at = Math.round(element.currentTime * 1000);
    setMarks((current) => {
      if (current.length >= sentences.length || at <= current[current.length - 1] + MIN_GAP_MS) return current;
      const marked = [...current, at];
      if (marked.length === sentences.length) {
        element.pause();
        setPhase("check");
      }
      return marked;
    });
  }, [phase, sentences.length]);

  useEffect(() => {
    if (phase !== "mark") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;
      event.preventDefault();
      next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, next]);

  const nudge = (index: number, by: number) =>
    setMarks((current) => {
      const low = current[index - 1] + MIN_GAP_MS;
      const high = (index + 1 < current.length ? current[index + 1] : durationMs) - MIN_GAP_MS;
      const value = Math.min(high, Math.max(low, current[index] + by));
      return current.map((mark, k) => (k === index ? value : mark));
    });

  const box = "bg-surface flex flex-col gap-5 rounded-[22px] px-5 py-6 shadow-[var(--shadow-1)] sm:px-7";

  if (phase === "mark") {
    const done = marks.length;
    const now = sentences[done - 1];
    const upcoming = sentences[done];
    return (
      <section className={box} aria-label={t("admin.audio.sync.title")}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-ink text-[17px] font-extrabold">{t("admin.audio.sync.title")}</h2>
          <span className="text-ink-3 text-[13.5px] font-bold">{t("admin.audio.sync.progress", { done, total: sentences.length })}</span>
        </div>
        <p className="text-ink-3 -mt-2 text-[13.5px] leading-6">{t("admin.audio.sync.lead")}</p>
        <div className="flex items-center gap-3">
          <div className="bg-tint h-1.5 flex-1 overflow-hidden rounded-full" aria-hidden>
            <div className="bg-brand h-full origin-left rounded-full rtl:origin-right" style={{ transform: `scaleX(${Math.min(1, position / Math.max(durationMs, 1))})` }} />
          </div>
          <span dir="ltr" className="text-ink-3 text-[12.5px] font-bold tabular-nums">
            {clock(position)}
          </span>
        </div>
        <div className="flex min-h-36 flex-col justify-center gap-3" aria-live="polite">
          <p dir="ltr" lang={language} className="lat text-ink-3 text-[16px] leading-snug">
            {now}
          </p>
          {upcoming ? (
            <div className="flex flex-col gap-1.5">
              <span className="text-brand-text text-[12.5px] font-bold">{t("admin.audio.sync.upNext")}</span>
              <p dir="ltr" lang={language} className="lat text-ink text-[26px] leading-tight sm:text-[30px]">
                {upcoming}
              </p>
            </div>
          ) : null}
        </div>
        {ended && done < sentences.length ? <p className="text-bad text-[13.5px] font-bold">{t("admin.audio.sync.incomplete", { count: sentences.length - done })}</p> : null}
        <Button type="button" size="lg" className="h-16 w-full text-[18px]" disabled={!playing || !upcoming} onClick={next}>
          {t("admin.audio.sync.next")}
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={toggle}>
            {playing ? <Pause fill="currentColor" strokeWidth={0} aria-hidden /> : <Play className="rtl:-scale-x-100" fill="currentColor" strokeWidth={0} aria-hidden />}
            {t(playing ? "admin.audio.sync.pause" : position > 0 ? "admin.audio.sync.resume" : "admin.audio.sync.start")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={restart} disabled={position === 0 && done === 1}>
            <RotateCcw strokeWidth={2} aria-hidden />
            {t("admin.audio.sync.restart")}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            {t("admin.audio.sync.cancel")}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className={box} aria-label={t("admin.audio.sync.title")}>
      <div className="flex flex-col gap-1">
        <h2 className="text-ink text-[17px] font-extrabold">{t("admin.audio.sync.title")}</h2>
        <p className="text-ink-3 text-[13.5px] leading-6">{t("admin.audio.sync.check")}</p>
      </div>
      <ol className="divide-line flex flex-col divide-y">
        {sentences.map((sentence, index) => (
          <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
            <SentencePlay url={url} from={marks[index]} until={marks[index + 1]} index={index} />
            <span dir="ltr" className="text-ink-3 w-16 shrink-0 text-[12.5px] font-bold tabular-nums">
              {clock(marks[index])}
            </span>
            <p dir="ltr" lang={language} className="lat text-ink min-w-0 flex-[1_1_14rem] text-[16px] leading-snug">
              {sentence}
            </p>
            {index > 0 ? (
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="xs" onClick={() => nudge(index, -NUDGE_MS)}>
                  {t("admin.audio.sync.earlier")}
                </Button>
                <Button type="button" variant="ghost" size="xs" onClick={() => nudge(index, NUDGE_MS)}>
                  {t("admin.audio.sync.later")}
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={saving} onClick={() => onSave(marks)}>
          {saving ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
          {t("admin.audio.sync.save")}
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={restart}>
          <RotateCcw strokeWidth={2} aria-hidden />
          {t("admin.audio.sync.restart")}
        </Button>
        <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>
          {t("admin.audio.sync.cancel")}
        </Button>
      </div>
    </section>
  );
}

function SentencePlay({ url, from, until, index }: { url: string; from: number; until?: number; index: number }) {
  const id = `sync:${index}`;
  const playing = usePlaying(id);
  return (
    <button
      type="button"
      onClick={() => (playing ? stopPlaying() : playFile(id, url, from, until))}
      aria-label={t(playing ? "admin.audio.stop" : "admin.audio.play")}
      className={cn(
        "focus-visible:ring-ring/45 grid size-9 shrink-0 place-items-center rounded-full transition-colors outline-none focus-visible:ring-[3px]",
        playing ? "bg-brand text-on-brand" : "bg-tint text-brand-text hover:bg-tint-2",
      )}
    >
      {playing ? (
        <Pause className="size-3.5" fill="currentColor" strokeWidth={0} aria-hidden />
      ) : (
        <Play className="size-4 rtl:-scale-x-100" fill="currentColor" strokeWidth={0} aria-hidden />
      )}
    </button>
  );
}

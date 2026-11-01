"use client";

import { useEffect, useRef, useState } from "react";
import { fileAtMs, hush, playFile, RATE, say, usePlaying } from "@/components/learn/speak";
import type { TextView } from "@/engine/session";
import { TEXT_RULE } from "@/engine/texts";

/**
 * The sound of a whole text (PRD §7.4): the teacher's recording, or the phone's voice reading the
 * sentences one after another. A play starts from the beginning and counts once; a pause keeps its
 * place and goes on from there. A sentence alone (with help, and on the review page) never counts.
 */

export type TextSound = {
  playing: boolean;
  /** Plays started, the one going on included. */
  plays: number;
  /** A play stopped half-way: the button goes on from its place. */
  paused: boolean;
  /** Plays left, or null without a limit. */
  left: number | null;
  /** The sentence being read now, or the one a pause stopped in. */
  sentenceAt: number | null;
  toggle: () => void;
  sentence: (index: number) => void;
  /** Where the play stands, for «تلاش نیمه‌تمام». */
  positionMs: () => number;
};

const wordsOf = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Where each sentence starts: the recording's own marks, or the phone voice's pace (DECISIONS.md). */
export function sentenceStarts(view: TextView): number[] {
  if (view.audio && view.audio.offsetsMs.length === view.sentences.length) return view.audio.offsetsMs;
  let at = 0;
  return view.sentences.map((sentence) => {
    const start = at;
    at += (wordsOf(sentence.text) / TEXT_RULE.deviceWordsPerSec) * 1000;
    return start;
  });
}

const sentenceOf = (starts: number[], ms: number) => {
  let index = 0;
  starts.forEach((start, i) => {
    if (start <= ms + 1) index = i;
  });
  return index;
};

export function useTextSound(
  view: TextView,
  opts: { id: string; limit: number | null; plays: number; positionMs: number; slow: boolean; onChange?: () => void; /** A play reached the end. */ onEnd?: () => void },
): TextSound {
  const { id, limit, slow } = opts;
  const playing = usePlaying(id);
  const [plays, setPlays] = useState(opts.plays);
  const [inPlay, setInPlay] = useState(opts.positionMs > 0);
  const [sentenceAt, setSentenceAt] = useState<number | null>(null);
  const starts = useRef(sentenceStarts(view));
  const pos = useRef(opts.positionMs);
  const onChange = useRef(opts.onChange);
  const onEnd = useRef(opts.onEnd);
  useEffect(() => {
    onChange.current = opts.onChange;
    onEnd.current = opts.onEnd;
  });
  const file = view.audio?.url ?? null;

  // While the recording plays, its place is kept, so a stop from elsewhere (closing, the mute button) keeps it too.
  useEffect(() => {
    if (!playing || !file) return;
    const timer = window.setInterval(() => {
      pos.current = fileAtMs();
      setSentenceAt(sentenceOf(starts.current, pos.current));
    }, 400);
    return () => window.clearInterval(timer);
  }, [playing, file]);
  useEffect(() => hush, []);

  const ended = () => {
    pos.current = 0;
    setInPlay(false);
    setSentenceAt(null);
    onChange.current?.();
    onEnd.current?.();
  };

  const readFrom = (index: number) => {
    const sentence = view.sentences[index];
    if (!sentence) return ended();
    pos.current = starts.current[index];
    setSentenceAt(index);
    say(id, sentence.speak, slow, () => readFrom(index + 1));
  };

  const goOn = (fromMs: number) => {
    if (file) {
      playFile(id, file, fromMs, undefined, slow ? RATE.fileSlow : RATE.file, ended);
      return;
    }
    // The phone's voice cannot start inside a sentence: it goes on from the sentence's start.
    readFrom(sentenceOf(starts.current, fromMs));
  };

  // «آهسته» pressed while it plays: the play goes on from the same place at the new speed.
  const slowBefore = useRef(slow);
  useEffect(() => {
    if (slowBefore.current === slow) return;
    slowBefore.current = slow;
    if (playing) goOn(file ? fileAtMs() : pos.current);
  }, [slow]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = () => {
    if (playing) {
      if (file) pos.current = fileAtMs();
      hush();
      onChange.current?.();
      return;
    }
    if (inPlay) {
      goOn(pos.current);
      return;
    }
    if (limit !== null && plays >= limit) return;
    setPlays(plays + 1);
    setInPlay(true);
    pos.current = 0;
    goOn(0);
    onChange.current?.();
  };

  const sentence = (index: number) => {
    const line = view.sentences[index];
    if (!line) return;
    if (playing && file) pos.current = fileAtMs();
    const key = `${id}:s${index}`;
    if (file && view.audio && view.audio.offsetsMs.length === view.sentences.length) {
      playFile(key, file, view.audio.offsetsMs[index], view.audio.offsetsMs[index + 1], slow ? RATE.fileSlow : RATE.file);
    } else say(key, line.speak, slow);
  };

  return {
    playing,
    plays,
    paused: inPlay && !playing,
    left: limit === null ? null : Math.max(0, limit - plays),
    sentenceAt: inPlay ? sentenceAt : null,
    toggle,
    sentence,
    positionMs: () => (playing && file ? fileAtMs() : inPlay ? pos.current : 0),
  };
}

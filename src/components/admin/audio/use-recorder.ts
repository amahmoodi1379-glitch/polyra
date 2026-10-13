"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { stopPlaying } from "./player";

export type RecorderPhase = "idle" | "asking" | "recording" | "denied" | "unsupported" | "error";

type Live = {
  stream: MediaStream;
  recorder: MediaRecorder;
  context: AudioContext;
  chunks: Blob[];
  started: number;
  frame: number;
};

/**
 * Recording from the microphone (PRD §13.8 «ضبط در خود پنل»). The browser's echo cancelling and
 * automatic gain are off, so the voice is not pumped or cut; noise suppression stays on for a quiet
 * hum. While recording it reports the peak level (0 to 1) for the meter and the time so far.
 */
export function useRecorder() {
  const [phase, setPhase] = useState<RecorderPhase>("idle");
  const [level, setLevel] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [loud, setLoud] = useState(false);
  const live = useRef<Live | null>(null);

  const release = useCallback(() => {
    const current = live.current;
    if (!current) return;
    cancelAnimationFrame(current.frame);
    current.stream.getTracks().forEach((track) => track.stop());
    void current.context.close();
    live.current = null;
  }, []);

  useEffect(() => release, [release]);

  const start = useCallback(async () => {
    if (live.current) return;
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setPhase("unsupported");
      return;
    }
    stopPlaying();
    setPhase("asking");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, autoGainControl: false, noiseSuppression: true, channelCount: 1 } });
    } catch (error) {
      setPhase(error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError") ? "denied" : "error");
      return;
    }
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const recorder = new MediaRecorder(stream);
    const current: Live = { stream, recorder, context, chunks: [], started: performance.now(), frame: 0 };
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) current.chunks.push(event.data);
    };
    live.current = current;
    recorder.start();
    setLevel(0);
    setElapsedMs(0);
    setLoud(false);
    setPhase("recording");

    let shown = 0;
    const tick = (now: number) => {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      if (peak > 0.98) setLoud(true);
      // About twenty updates a second is enough for a meter.
      if (now - shown > 50) {
        shown = now;
        setLevel(peak);
        setElapsedMs(now - current.started);
      }
      current.frame = requestAnimationFrame(tick);
    };
    current.frame = requestAnimationFrame(tick);
  }, []);

  /** Ends the recording and gives it back. */
  const stop = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        const current = live.current;
        if (!current) return resolve(null);
        current.recorder.onstop = () => {
          const blob = new Blob(current.chunks, { type: current.recorder.mimeType || "audio/webm" });
          release();
          setPhase("idle");
          resolve(blob.size > 0 ? blob : null);
        };
        current.recorder.stop();
      }),
    [release],
  );

  const cancel = useCallback(() => {
    const current = live.current;
    if (current) {
      current.recorder.onstop = null;
      if (current.recorder.state !== "inactive") current.recorder.stop();
    }
    release();
    setPhase("idle");
  }, [release]);

  return { phase, level, elapsedMs, loud, start, stop, cancel };
}

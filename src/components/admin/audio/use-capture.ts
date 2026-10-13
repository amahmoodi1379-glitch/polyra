"use client";

import { useCallback, useEffect, useId, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { formatNumber, t } from "@/i18n";
import { MAX_MS } from "@/lib/audio/standard";
import type { SlotView } from "@/server/content/audio/view";
import { prepareAudio, uploadAudio, type Prepared, type UploadReply } from "./browser-audio";
import { stopPlaying } from "./player";
import { useRecorder } from "./use-recorder";

export type Notice = { ok: boolean; message: string };
export type CaptureState = { step: "idle" } | { step: "preparing" } | { step: "review" | "saving"; prepared: Prepared; source: "record" | "file"; heard: boolean };

/** Seconds with one decimal, or minutes and seconds past a minute, in Persian digits. */
export function formatDuration(ms: number) {
  if (ms < 60_000) return t("admin.audio.seconds", { value: Math.round(ms / 100) / 10 });
  const seconds = Math.round(ms / 1000);
  return `${formatNumber(Math.floor(seconds / 60))}:${seconds % 60 < 10 ? formatNumber(0) : ""}${formatNumber(seconds % 60)}`;
}

/** A line saying what happened; a good one goes away by itself after a few seconds. */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  useEffect(() => {
    if (!notice?.ok) return;
    const timer = window.setTimeout(() => setNotice(null), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice] as const;
}

const seconds = (ms: number) => Math.round(ms / 1000);

function uploadMessage(reply: UploadReply) {
  if (reply.state === "missing") return t("admin.audio.gone");
  if (reply.state === "invalid" && reply.reason === "offsets") return t("admin.audio.errors.offsets");
  return t("admin.audio.errors.upload");
}

/**
 * A new file for one place: recorded or picked, prepared in the browser, listened to, then kept or
 * done again (PRD §13.8). By default «نگه دار» sends it; a text hands it to the sync tool instead.
 */
export function useCapture(slot: Pick<SlotView, "key" | "kind">, onReady?: (prepared: Prepared, heard: boolean) => void) {
  const router = useRouter();
  const recorder = useRecorder();
  const [state, setState] = useState<CaptureState>({ step: "idle" });
  const [notice, setNotice] = useNotice();
  const fileInputId = useId();

  const drop = useCallback(() => {
    setState((current) => {
      if ("prepared" in current) URL.revokeObjectURL(current.prepared.url);
      return { step: "idle" };
    });
  }, []);

  const prepare = async (blob: Blob, source: "record" | "file") => {
    setNotice(null);
    setState({ step: "preparing" });
    const result = await prepareAudio(blob);
    if (!result.ok) {
      setNotice({ ok: false, message: t(`admin.audio.errors.${result.error}`) });
      setState({ step: "idle" });
      return;
    }
    const max = MAX_MS[slot.kind];
    if (result.prepared.durationMs > max) {
      URL.revokeObjectURL(result.prepared.url);
      setNotice({
        ok: false,
        message: t("admin.audio.errors.tooLong", { seconds: seconds(result.prepared.durationMs), kind: t(`admin.audio.kinds.${slot.kind}`), max: seconds(max) }),
      });
      setState({ step: "idle" });
      return;
    }
    setState({ step: "review", prepared: result.prepared, source, heard: false });
  };

  const record = async () => {
    setNotice(null);
    drop();
    await recorder.start();
  };

  const finish = async () => {
    const blob = await recorder.stop();
    if (blob) await prepare(blob, "record");
  };

  const pick = () => {
    stopPlaying();
    (document.getElementById(fileInputId) as HTMLInputElement | null)?.click();
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      drop();
      void prepare(file, "file");
    }
  };

  const again = () => {
    const source = state.step === "review" ? state.source : "record";
    drop();
    if (source === "record") void record();
    else pick();
  };

  const keep = async () => {
    if (state.step !== "review") return;
    stopPlaying();
    if (onReady) {
      // The caller owns the file from here (and frees its address).
      onReady(state.prepared, state.heard);
      setState({ step: "idle" });
      return;
    }
    setState({ ...state, step: "saving" });
    const reply = await uploadAudio(slot.key, state.prepared.mp3, { heard: state.heard });
    if (reply.state === "saved") {
      URL.revokeObjectURL(state.prepared.url);
      setState({ step: "idle" });
      setNotice({ ok: true, message: t("admin.audio.review.saved") });
      router.refresh();
    } else {
      setState({ ...state, step: "review" });
      setNotice({ ok: false, message: uploadMessage(reply) });
    }
  };

  const setHeard = (heard: boolean) => setState((current) => (current.step === "review" ? { ...current, heard } : current));

  return {
    state,
    recorder,
    notice,
    setNotice,
    record,
    finish,
    pick,
    keep,
    again,
    setHeard,
    cancel: () => {
      stopPlaying();
      recorder.cancel();
      drop();
    },
    fileInput: { id: fileInputId, onChange: onFile },
  };
}

export type Capture = ReturnType<typeof useCapture>;

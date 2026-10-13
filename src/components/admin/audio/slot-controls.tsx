"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, Ellipsis, LoaderCircle, Mic, Play, Smartphone, Square, Trash2, Upload } from "lucide-react";
import { heardAction, removeHumanAction } from "@/app/admin/audio/actions";
import { Voiced } from "@/components/admin/voiced";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { AssetView, SlotView } from "@/server/content/audio/view";
import type { Prepared } from "./browser-audio";
import { playFile, speakText, stopPlaying, useDeviceVoice, usePlaying } from "./player";
import { formatDuration, useCapture, type Capture, type Notice } from "./use-capture";

/** The file that plays, if any: the human one first, never a stale one. */
export const playingAsset = (slot: SlotView): AssetView | null => (slot.playing === "human" ? slot.human : slot.playing === "machine" ? slot.machine : null);
/** A stale file still kept, so the teacher can hear what the old one said. */
const staleAsset = (slot: SlotView) => (slot.human?.stale ? slot.human : slot.machine?.stale ? slot.machine : null);

/** Plays a file, or reads the text with the device's voice when there is none. */
export function PlayButton({
  id,
  url,
  speak,
  language,
  size = "md",
  label,
  className,
}: {
  id: string;
  url?: string | null;
  speak?: string;
  language: string;
  size?: "sm" | "md";
  label?: string;
  className?: string;
}) {
  const playing = usePlaying(id);
  const toggle = () => {
    if (playing) stopPlaying();
    else if (url) playFile(id, url);
    else if (speak) speakText(id, speak, language);
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label ?? t(playing ? "admin.audio.stop" : "admin.audio.play")}
      aria-pressed={playing}
      className={cn(
        "focus-visible:ring-ring/45 grid shrink-0 place-items-center rounded-full transition-[background-color,color,transform] duration-150 ease-out outline-none focus-visible:ring-[3px] active:scale-[0.96]",
        size === "md" ? "size-12" : "size-10",
        playing ? "bg-brand text-on-brand" : "bg-tint text-brand-text hover:bg-tint-2",
        className,
      )}
    >
      {playing ? (
        <Square className={size === "md" ? "size-[15px]" : "size-3.5"} fill="currentColor" strokeWidth={0} aria-hidden />
      ) : (
        <Play className={cn("translate-x-[1px] rtl:-scale-x-100", size === "md" ? "size-5" : "size-[17px]")} fill="currentColor" strokeWidth={0} aria-hidden />
      )}
    </button>
  );
}

/** Where the sound comes from and how long the file is. */
function sourceLine(slot: SlotView) {
  const asset = playingAsset(slot);
  if (!asset) return t("admin.audio.plays.device");
  const source = t(slot.playing === "human" ? "admin.audio.plays.human" : "admin.audio.plays.machine");
  return asset.durationMs ? `${source} · ${formatDuration(asset.durationMs)}` : source;
}

const chip = "flex h-7 items-center gap-1 rounded-[9px] px-2.5 text-[12.5px] font-bold whitespace-nowrap";

/** Heard, not heard yet, stale, or no file. A place that needs a file (phonics) says so when it has none. */
export function AudioStateChip({ slot, needsFile }: { slot: SlotView; needsFile?: boolean }) {
  const asset = playingAsset(slot);
  if (asset?.heard)
    return (
      <span className={cn(chip, "bg-ok-soft text-ok")}>
        <Check className="size-3.5" strokeWidth={2.75} aria-hidden />
        {t("admin.audio.heard")}
      </span>
    );
  if (asset) return <span className={cn(chip, "bg-idk-soft text-idk")}>{t("admin.audio.notHeard")}</span>;
  if (staleAsset(slot)) return <span className={cn(chip, "bg-idk-soft text-idk")}>{t("admin.audio.stale")}</span>;
  if (needsFile) return <span className={cn(chip, "bg-bad-soft text-bad")}>{t("admin.audio.noFile")}</span>;
  return (
    <span className={cn(chip, "text-ink-3 px-1.5")}>
      <Smartphone className="size-3.5" strokeWidth={2} aria-hidden />
      {t("admin.audio.plays.device")}
    </span>
  );
}

export function NoticeLine({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <p role="status" className={cn("flex items-start gap-1.5 text-[13px] leading-6 font-bold", notice.ok ? "text-ink" : "text-bad")}>
      {notice.ok ? <Check className="mt-1 size-4 shrink-0" strokeWidth={2.5} aria-hidden /> : <CircleAlert className="mt-1 size-4 shrink-0" strokeWidth={2} aria-hidden />}
      {notice.message}
    </p>
  );
}

/** «شنیدم، درست است» on the file that plays (PRD §13.4). */
function HeardButton({ asset, onDone, size = "sm" }: { asset: AssetView; onDone: (notice: Notice) => void; size?: "sm" | "xs" }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="secondary"
      size={size}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const outcome = await heardAction(asset.id, true);
          onDone(outcome);
          router.refresh();
        })
      }
    >
      {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : <Check strokeWidth={2.5} aria-hidden />}
      {t("admin.audio.markHeard")}
    </Button>
  );
}

/** «برداشتن صدای انسانی» with a question first: the file only comes back by recording again. */
function RemoveDialog({ slotKey, open, onOpenChange, onDone }: { slotKey: string; open: boolean; onOpenChange: (open: boolean) => void; onDone: (notice: Notice) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("admin.audio.remove.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("admin.audio.remove.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("admin.audio.remove.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              startTransition(async () => {
                const outcome = await removeHumanAction(slotKey);
                onDone(outcome);
                onOpenChange(false);
                router.refresh();
              });
            }}
          >
            {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
            {t("admin.audio.remove.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const meterOf = (peak: number) => Math.max(0, Math.min(1, (20 * Math.log10(Math.max(peak, 1e-6)) + 60) / 60));

/** While recording, preparing, or listening to a new file before keeping it. */
export function CapturePanel({ capture, slotKey, keepLabel }: { capture: Capture; slotKey: string; keepLabel?: string }) {
  const { state, recorder } = capture;
  const box = "bg-tint flex flex-col gap-3 rounded-[16px] px-4 py-3.5";

  if (recorder.phase === "asking" || recorder.phase === "recording") {
    const recording = recorder.phase === "recording";
    return (
      <div className={box} role="group" aria-label={t("admin.audio.recorder.recording")}>
        <div className="flex items-center gap-2.5">
          <span className={cn("bg-brand size-2.5 shrink-0 rounded-full", recording && "motion-safe:animate-pulse")} aria-hidden />
          <span className="text-ink text-[14px] font-bold">{t(recording ? "admin.audio.recorder.recording" : "admin.audio.recorder.asking")}</span>
          {recording ? (
            <span dir="ltr" className="text-ink-2 ms-auto text-[14px] font-bold tabular-nums">
              {formatDuration(recorder.elapsedMs)}
            </span>
          ) : null}
        </div>
        {recording ? (
          <div className="bg-surface h-2 overflow-hidden rounded-full" aria-hidden>
            <div
              className={cn(
                "h-full origin-left rounded-full transition-transform duration-75 ease-linear motion-reduce:transition-none rtl:origin-right",
                recorder.loud ? "bg-bad" : "bg-brand",
              )}
              style={{ transform: `scaleX(${meterOf(recorder.level)})` }}
            />
          </div>
        ) : null}
        {recorder.loud ? <p className="text-bad text-[13px] leading-6 font-bold">{t("admin.audio.recorder.loud")}</p> : null}
        <div className="flex flex-wrap gap-2">
          {recording ? (
            <Button type="button" size="sm" onClick={() => void capture.finish()}>
              <Square className="size-3.5" fill="currentColor" strokeWidth={0} aria-hidden />
              {t("admin.audio.recorder.finish")}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={capture.cancel}>
            {t("admin.audio.recorder.cancel")}
          </Button>
        </div>
      </div>
    );
  }

  if (state.step === "preparing")
    return (
      <div className={cn(box, "flex-row items-center")} role="status">
        <LoaderCircle className="text-brand-text size-[18px] animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden />
        <span className="text-ink-2 text-[14px] font-bold">{t("admin.audio.preparing")}</span>
      </div>
    );

  if (state.step === "review" || state.step === "saving") {
    const saving = state.step === "saving";
    return (
      <div className={box}>
        <div className="flex items-center gap-3">
          <PlayButton id={`fresh:${slotKey}`} url={state.prepared.url} language="" size="sm" className="bg-surface" />
          <div className="flex min-w-0 flex-col">
            <span className="text-ink text-[14px] font-bold">{t("admin.audio.review.fresh")}</span>
            <span className="text-ink-3 text-[13px]">{formatDuration(state.prepared.durationMs)}</span>
          </div>
        </div>
        <label className="text-ink flex w-fit cursor-pointer items-center gap-2.5 text-[14px] font-bold">
          <Checkbox checked={state.heard} disabled={saving} onCheckedChange={(value) => capture.setHeard(value === true)} className="bg-surface size-5" />
          {t("admin.audio.markHeard")}
        </label>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={saving} onClick={() => void capture.keep()}>
            {saving ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
            {saving ? t("admin.audio.review.saving") : (keepLabel ?? t("admin.audio.review.keep"))}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={saving} onClick={capture.again}>
            {t(state.source === "record" ? "admin.audio.review.again" : "admin.audio.review.otherFile")}
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={capture.cancel}>
            {t("admin.audio.review.cancel")}
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

/** The recorder's own problems (no permission, no microphone), as a notice. */
function recorderNotice(capture: Capture): Notice | null {
  const phase = capture.recorder.phase;
  return phase === "denied" || phase === "unsupported" || phase === "error" ? { ok: false, message: t(`admin.audio.recorder.${phase}`) } : null;
}

const accept = "audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.webm,.flac";

function FileInput({ capture }: { capture: Capture }) {
  return <input type="file" accept={accept} className="hidden" tabIndex={-1} aria-hidden id={capture.fileInput.id} onChange={capture.fileInput.onChange} />;
}

const busy = (capture: Capture) => capture.state.step !== "idle" || capture.recorder.phase === "asking" || capture.recorder.phase === "recording";

/** «ضبط» and «آپلود صدا». */
function CaptureButtons({ capture, compact }: { capture: Capture; compact?: boolean }) {
  if (compact)
    return (
      <>
        <Button type="button" variant="ghost" size="icon-sm" onClick={() => void capture.record()} aria-label={t("admin.audio.record")} title={t("admin.audio.record")}>
          <Mic strokeWidth={2} aria-hidden />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" onClick={capture.pick} aria-label={t("admin.audio.upload")} title={t("admin.audio.upload")}>
          <Upload strokeWidth={2} aria-hidden />
        </Button>
      </>
    );
  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" size="sm" onClick={() => void capture.record()}>
        <Mic strokeWidth={2} aria-hidden />
        {t("admin.audio.record")}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={capture.pick}>
        <Upload strokeWidth={2} aria-hidden />
        {t("admin.audio.upload")}
      </Button>
    </div>
  );
}

function DeviceNote({ language }: { language: string }) {
  const has = useDeviceVoice(language);
  if (has !== false) return null;
  return <p className="text-ink-3 text-[12.5px] leading-5">{t("admin.audio.deviceMissing", { language: t(`common.languages.${language as "fr" | "de"}`) })}</p>;
}

/**
 * The audio of a word or a sentence, in the side column of its edit page: what plays and whether it
 * was heard, with record, upload and remove (PRD §13.8).
 */
export function AudioCard({
  slot,
  language,
  title,
  onReady,
  keepLabel,
  children,
}: {
  slot: SlotView;
  language: string;
  title?: string;
  onReady?: (prepared: Prepared, heard: boolean) => void;
  keepLabel?: string;
  children?: ReactNode;
}) {
  const capture = useCapture(slot, onReady);
  const [removing, setRemoving] = useState(false);
  const asset = playingAsset(slot);
  const stale = staleAsset(slot);
  const notice = capture.notice ?? recorderNotice(capture);

  return (
    <section className="bg-surface flex flex-col gap-4 rounded-[22px] px-5 py-5 shadow-[var(--shadow-1)]" data-audio-slot={slot.key}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-ink text-[15px] font-extrabold">{title ?? t("admin.audio.title")}</h2>
        <AudioStateChip slot={slot} />
      </div>
      <div className="flex items-center gap-3.5">
        <PlayButton id={`slot:${slot.key}`} url={asset?.url} speak={slot.speak} language={language} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <Voiced text={slot.spoken} voice="target" language={language} className="text-ink truncate text-[18px] leading-snug" />
          <span className="text-ink-3 text-[13px]">{sourceLine(slot)}</span>
        </div>
      </div>
      {!asset ? (
        <div className="flex flex-col gap-1">
          <p className="text-ink-3 text-[13px] leading-6">{t("admin.audio.deviceHint")}</p>
          <DeviceNote language={language} />
        </div>
      ) : null}
      {stale ? (
        <div className="bg-idk-soft text-ink flex flex-col gap-2 rounded-[14px] px-3.5 py-3 text-[13px] leading-6">
          <p>{t("admin.audio.staleNote")}</p>
          <OldFile asset={stale} slotKey={slot.key} />
        </div>
      ) : null}
      {asset && !asset.heard && !busy(capture) ? <HeardButton asset={asset} onDone={capture.setNotice} /> : null}
      {children}
      {busy(capture) ? <CapturePanel capture={capture} slotKey={slot.key} keepLabel={keepLabel} /> : <CaptureButtons capture={capture} />}
      <NoticeLine notice={notice} />
      {slot.human && !busy(capture) ? (
        <Button type="button" variant="ghost" size="sm" className="text-ink-3 hover:text-bad -ms-2 w-fit" onClick={() => setRemoving(true)}>
          <Trash2 strokeWidth={2} aria-hidden />
          {t("admin.audio.remove.button")}
        </Button>
      ) : null}
      <RemoveDialog slotKey={slot.key} open={removing} onOpenChange={setRemoving} onDone={capture.setNotice} />
      <FileInput capture={capture} />
    </section>
  );
}

function OldFile({ asset, slotKey }: { asset: AssetView; slotKey: string }) {
  const id = `old:${slotKey}`;
  const playing = usePlaying(id);
  return (
    <button
      type="button"
      onClick={() => (playing ? stopPlaying() : playFile(id, asset.url))}
      className="text-idk flex w-fit items-center gap-1.5 font-bold underline-offset-4 hover:underline"
    >
      {playing ? (
        <Square className="size-3" fill="currentColor" strokeWidth={0} aria-hidden />
      ) : (
        <Play className="size-3.5 rtl:-scale-x-100" fill="currentColor" strokeWidth={0} aria-hidden />
      )}
      {t(playing ? "admin.audio.stop" : "admin.audio.playOld")}
    </button>
  );
}

/**
 * One place in a list (a phonics item, a sentence of a text, a row of the «صدا» page): play, state,
 * and record or upload; the recorder opens under the row.
 */
export function AudioRow({ slot, language, label, needsFile, href }: { slot: SlotView; language: string; label?: string; needsFile?: boolean; href?: string }) {
  const capture = useCapture(slot);
  const [removing, setRemoving] = useState(false);
  const asset = playingAsset(slot);
  const notice = capture.notice ?? recorderNotice(capture);
  const text = <Voiced text={slot.spoken} voice="target" language={language} className="text-ink text-[16px] leading-snug" />;

  return (
    <li className="flex flex-col gap-2.5 py-3" data-audio-slot={slot.key}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <PlayButton id={`slot:${slot.key}`} url={asset?.url} speak={slot.speak} language={language} size="sm" />
        <div className="flex min-w-0 flex-[1_1_12rem] flex-col items-start">
          {label ? <span className="text-ink-3 text-[12px] font-bold">{label}</span> : null}
          {href ? (
            <Link href={href} className="hover:text-brand-text min-w-0 transition-colors">
              {text}
            </Link>
          ) : (
            text
          )}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <AudioStateChip slot={slot} needsFile={needsFile} />
            {asset && !asset.heard && !busy(capture) ? <HeardButton asset={asset} onDone={capture.setNotice} size="xs" /> : null}
          </div>
          <div className="flex items-center gap-1">
            {busy(capture) ? null : <CaptureButtons capture={capture} compact />}
            {slot.human && !busy(capture) ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("admin.audio.more")} title={t("admin.audio.more")}>
                    <Ellipsis strokeWidth={2} aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem variant="destructive" onSelect={() => setRemoving(true)}>
                    <Trash2 strokeWidth={2} aria-hidden />
                    {t("admin.audio.remove.button")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      </div>
      {busy(capture) ? <CapturePanel capture={capture} slotKey={slot.key} /> : null}
      <NoticeLine notice={notice} />
      <RemoveDialog slotKey={slot.key} open={removing} onOpenChange={setRemoving} onDone={capture.setNotice} />
      <FileInput capture={capture} />
    </li>
  );
}

"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, FileAudio, LoaderCircle, Upload, X } from "lucide-react";
import { prepareAudio, uploadAudio } from "@/components/admin/audio/browser-audio";
import { PlayButton } from "@/components/admin/audio/slot-controls";
import { Voiced } from "@/components/admin/voiced";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { MAX_MS } from "@/lib/audio/standard";
import { cn } from "@/lib/utils";
import type { MatchTarget } from "@/server/content/audio/match";
import { itemHref } from "../content/links";
import { matchFilesAction } from "./actions";

type RowState = "idle" | "preparing" | "sending" | "saved" | "failed";
type Row = { id: string; file: File; url: string; match: MatchTarget | null; candidates: MatchTarget[]; choice: string | null; state: RowState; error?: string };

const audioFile = /\.(mp3|m4a|aac|wav|ogg|oga|opus|webm|flac)$/i;
const slugOf = { word: "words", sentence: "sentences", text: "texts", phonics: "phonics" } as const;

function targetLabel(target: MatchTarget) {
  if (target.kind === "phonics" && target.part && target.index !== null)
    return `${t("admin.audio.kinds.phonics")} · ${t(`admin.audio.parts.${target.part}`, { number: target.index + 1 })}`;
  return t(`admin.audio.kinds.${target.kind}`);
}

/**
 * «آپلود دسته‌ای» (PRD §13.8): many files at once; each name is matched to its place on the server,
 * unsure ones offer the nearest places, and every file is prepared in the browser before it is sent.
 */
export function BulkUpload({ language }: { language: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [matching, setMatching] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);

  useEffect(() => () => urls.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const update = (id: string, patch: Partial<Row>) => setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

  const add = async (list: FileList | File[]) => {
    const files = [...list].filter((file) => file.type.startsWith("audio/") || audioFile.test(file.name));
    if (files.length === 0) return;
    setProblem(null);
    setMatching(true);
    const matches = await matchFilesAction(
      language,
      files.map((file) => file.name),
    );
    setMatching(false);
    if (!matches) {
      setProblem(t("admin.audio.bulk.matchFailed"));
      return;
    }
    const added = files.map((file, index): Row => {
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      const found = matches[index];
      return { id: `${Date.now()}-${index}-${file.name}`, file, url, match: found.match, candidates: found.candidates, choice: found.match?.key ?? null, state: "idle" };
    });
    setRows((current) => [...current, ...added]);
  };

  const target = (row: Row) => (row.choice ? [row.match, ...row.candidates].find((item) => item?.key === row.choice) : undefined) ?? null;
  // A whole text needs the start of each sentence, so it goes on the text's own page.
  const ready = rows.filter((row) => row.choice && row.state !== "saved" && target(row)?.kind !== "text");
  const saved = rows.filter((row) => row.state === "saved").length;
  const failed = rows.filter((row) => row.state === "failed").length;
  const done = rows.filter((row) => row.state === "saved" || row.state === "failed").length;

  const send = async () => {
    setSending(true);
    for (const row of ready) {
      const place = target(row);
      if (!place) continue;
      update(row.id, { state: "preparing", error: undefined });
      const prepared = await prepareAudio(row.file);
      if (!prepared.ok) {
        update(row.id, { state: "failed", error: t(`admin.audio.errors.${prepared.error}`) });
        continue;
      }
      URL.revokeObjectURL(prepared.prepared.url);
      const max = MAX_MS[place.kind];
      if (prepared.prepared.durationMs > max) {
        update(row.id, {
          state: "failed",
          error: t("admin.audio.errors.tooLong", {
            seconds: Math.round(prepared.prepared.durationMs / 1000),
            kind: t(`admin.audio.kinds.${place.kind}`),
            max: Math.round(max / 1000),
          }),
        });
        continue;
      }
      update(row.id, { state: "sending" });
      const reply = await uploadAudio(place.key, prepared.prepared.mp3, { heard: false });
      update(row.id, reply.state === "saved" ? { state: "saved" } : { state: "failed", error: t(reply.state === "missing" ? "admin.audio.gone" : "admin.audio.errors.upload") });
    }
    setSending(false);
    router.refresh();
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    if (event.dataTransfer.files.length) void add(event.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "bg-surface flex flex-col items-center gap-3 rounded-[22px] border-2 border-dashed px-6 py-10 text-center shadow-[var(--shadow-1)] transition-colors",
          over ? "border-brand bg-tint" : "border-line-2",
        )}
      >
        <FileAudio className="text-brand-text size-8" strokeWidth={1.75} aria-hidden />
        <p className="text-ink text-[16px] font-extrabold">{t("admin.audio.bulk.drop")}</p>
        <p className="text-ink-3 max-w-[60ch] text-[13.5px] leading-6">{t("admin.audio.bulk.lead")}</p>
        <Button type="button" variant="secondary" disabled={matching || sending} onClick={() => input.current?.click()}>
          {matching ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : <Upload strokeWidth={2} aria-hidden />}
          {matching ? t("admin.audio.bulk.matching") : t("admin.audio.bulk.pick")}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          accept="audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.webm,.flac"
          className="hidden"
          onChange={(event) => {
            if (event.target.files) void add(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {problem ? <p className="text-bad text-[13.5px] font-bold">{problem}</p> : null}

      {rows.length > 0 ? (
        <section className="bg-surface flex flex-col rounded-[22px] shadow-[var(--shadow-1)]">
          <ol className="divide-line flex flex-col divide-y px-5 sm:px-6">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 py-4" data-bulk-file={row.file.name}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <PlayButton id={`bulk:${row.id}`} url={row.url} language={language} size="sm" />
                  <bdi dir="ltr" className="lat text-ink-2 min-w-0 flex-[1_1_12rem] truncate text-start text-[14px]">
                    {row.file.name}
                  </bdi>
                  <RowStatus row={row} />
                  {row.state === "idle" || row.state === "failed" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      disabled={sending}
                      aria-label={t("admin.audio.bulk.remove")}
                      title={t("admin.audio.bulk.remove")}
                      onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}
                    >
                      <X strokeWidth={2} aria-hidden />
                    </Button>
                  ) : null}
                </div>
                <Target row={row} language={language} disabled={sending || row.state === "saved"} onChoose={(choice) => update(row.id, { choice })} />
                {row.error ? (
                  <p className="text-bad flex items-start gap-1.5 text-[13px] leading-6 font-bold">
                    <CircleAlert className="mt-1 size-4 shrink-0" strokeWidth={2} aria-hidden />
                    {row.error}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
          <div className="border-line flex flex-wrap items-center gap-3 border-t px-5 py-4 sm:px-6">
            <Button type="button" disabled={sending || ready.length === 0} onClick={() => void send()}>
              {sending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : <Upload strokeWidth={2} aria-hidden />}
              {sending ? t("admin.audio.bulk.sending", { done, total: rows.length }) : t("admin.audio.bulk.send", { count: ready.length })}
            </Button>
            <Button type="button" variant="ghost" disabled={sending} onClick={() => setRows([])}>
              {t("admin.audio.bulk.clear")}
            </Button>
            <div className="flex flex-col text-[13.5px] leading-6 font-bold" role="status">
              {saved > 0 && !sending ? <span className="text-ink">{t("admin.audio.bulk.done", { count: saved })}</span> : null}
              {failed > 0 && !sending ? <span className="text-bad">{t("admin.audio.bulk.someFailed", { count: failed })}</span> : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RowStatus({ row }: { row: Row }) {
  if (row.state === "preparing" || row.state === "sending")
    return (
      <span className="text-ink-3 flex items-center gap-1.5 text-[12.5px] font-bold">
        <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden />
        {t(`admin.audio.bulk.states.${row.state}`)}
      </span>
    );
  if (row.state === "saved")
    return (
      <span className="bg-ok-soft text-ok flex h-7 items-center gap-1 rounded-[9px] px-2.5 text-[12.5px] font-bold">
        <Check className="size-3.5" strokeWidth={2.75} aria-hidden />
        {t("admin.audio.bulk.states.saved")}
      </span>
    );
  return null;
}

/** Where the file goes: the place found, the nearest places to choose from, or nothing. */
function Target({ row, language, disabled, onChoose }: { row: Row; language: string; disabled: boolean; onChoose: (choice: string | null) => void }) {
  const place = (target: MatchTarget) => (
    <span className="flex min-w-0 flex-col items-start">
      <span className="text-ink-3 text-[12px] font-bold">{targetLabel(target)}</span>
      <Voiced text={target.spoken} voice="target" language={language} className="text-ink text-[16px] leading-snug" />
    </span>
  );
  if (row.match)
    return (
      <div className="flex flex-col gap-1">
        <Link href={itemHref(slugOf[row.match.kind], row.match.id)} className="hover:bg-tint -mx-2 w-fit rounded-[12px] px-2 py-1 transition-colors">
          {place(row.match)}
        </Link>
        {row.match.kind === "text" ? <p className="text-idk text-[13px] leading-6 font-bold">{t("admin.audio.bulk.textOnPage")}</p> : null}
      </div>
    );
  if (row.candidates.length === 0) return <p className="text-idk text-[13.5px] font-bold">{t("admin.audio.bulk.notFound")}</p>;
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="text-idk mb-1 text-[13.5px] font-bold">{t("admin.audio.bulk.choose")}</legend>
      {row.candidates.map((candidate) => (
        <label
          key={candidate.key}
          className={cn(
            "flex cursor-pointer items-center gap-3 rounded-[14px] border px-3 py-2 transition-colors",
            row.choice === candidate.key ? "border-brand bg-tint" : "border-line hover:bg-tint/60",
          )}
        >
          <input type="radio" name={`choice-${row.id}`} className="accent-brand size-4" checked={row.choice === candidate.key} onChange={() => onChoose(candidate.key)} />
          {place(candidate)}
        </label>
      ))}
      <label
        className={cn(
          "flex cursor-pointer items-center gap-3 rounded-[14px] border px-3 py-2 transition-colors",
          row.choice === null ? "border-line-2" : "border-line hover:bg-tint/60",
        )}
      >
        <input type="radio" name={`choice-${row.id}`} className="accent-brand size-4" checked={row.choice === null} onChange={() => onChoose(null)} />
        <span className={cn("text-[14px] font-bold", row.choice === null ? "text-ink" : "text-ink-2")}>{t("admin.audio.bulk.skip")}</span>
      </label>
    </fieldset>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, CircleAlert, CircleCheck, DatabaseBackup, Download, LoaderCircle, Upload } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatNumber, t, type MessageKey } from "@/i18n";
import { formatDateTimeFa } from "@/lib/format";
import { cn } from "@/lib/utils";

type Summary = { created_at: string; tables: Record<string, number>; files: number; bytes: number };
type Job = { state: "saving" | "restoring" | "done" | "failed"; rows: number; totalRows: number; saved: string | null; code: string | null; keptSession: boolean };
type State =
  | { step: "idle" }
  | { step: "uploading"; name: string; sent: number; size: number }
  | { step: "checking"; name: string }
  | { step: "checked"; name: string; id: string; summary: Summary }
  | { step: "running"; token: string; job: Job | null };

const ENDPOINT = "/admin/transfer/restore";
const problems = new Set(["notBackup", "incomplete", "broken", "newerBackup", "olderBackup", "gone", "partial", "busy", "size", "network", "failed"]);
const problemText = (reason: string, line?: number) =>
  t(`admin.transfer.backup.problems.${problems.has(reason) ? reason : "failed"}` as MessageKey, { line: line ?? 0 });

async function post<T>(body: unknown): Promise<T> {
  const response = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return (await response.json()) as T;
}

/** Sends one piece, trying again a few times when the connection drops. */
async function sendChunk(id: string, index: number, blob: Blob): Promise<string> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(`${ENDPOINT}?${new URLSearchParams({ id, index: String(index) })}`, { method: "PUT", body: blob });
      const reply = (await response.json().catch(() => ({}))) as { result?: string; error?: string };
      return reply.result ?? reply.error ?? "failed";
    } catch {
      if (attempt >= 4) return "network";
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
}

const SHOWN: { table: string; key: MessageKey }[] = [
  { table: "word", key: "admin.transfer.backup.counts.words" },
  { table: "sentence", key: "admin.transfer.backup.counts.sentences" },
  { table: "grammar_unit", key: "admin.transfer.backup.counts.units" },
  { table: "text", key: "admin.transfer.backup.counts.texts" },
  { table: "user", key: "admin.transfer.backup.counts.accounts" },
];

/**
 * «پشتیبان کامل» (DECISIONS.md, moving servers): download everything as one file, or put such a file back on
 * this server. Nothing changes until the admin confirms; this server's data is saved first.
 */
export function FullBackup({ saved }: { saved: { name: string; bytes: number; at: string }[] }) {
  const [state, setState] = useState<State>({ step: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const token = state.step === "running" ? state.token : null;
  const finished = state.step === "running" && (state.job?.state === "done" || state.job?.state === "failed");
  useEffect(() => {
    if (!token || finished) return;
    const timer = setInterval(async () => {
      const response = await fetch(`${ENDPOINT}?job=${encodeURIComponent(token)}`, { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const job = (await response.json()) as Job;
      setState((current) => (current.step === "running" && current.token === token ? { ...current, job } : current));
    }, 1200);
    return () => clearInterval(timer);
  }, [token, finished]);

  const upload = async (file: File) => {
    setProblem(null);
    setState({ step: "uploading", name: file.name, sent: 0, size: file.size });
    const begun = await post<{ id?: string; chunk?: number; error?: string }>({ action: "begin", size: file.size }).catch(() => ({ error: "network" }) as { id?: string; chunk?: number; error?: string });
    if (!begun.id || !begun.chunk) {
      setState({ step: "idle" });
      setProblem(problemText(begun.error ?? "failed"));
      return;
    }
    for (let index = 0, start = 0; start < file.size; index++, start += begun.chunk) {
      const result = await sendChunk(begun.id, index, file.slice(start, start + begun.chunk));
      if (result !== "ok") {
        setState({ step: "idle" });
        setProblem(problemText(result === "network" ? "network" : "gone"));
        return;
      }
      setState({ step: "uploading", name: file.name, sent: Math.min(file.size, start + begun.chunk), size: file.size });
    }
    setState({ step: "checking", name: file.name });
    const checked = await post<{ ok: boolean; reason?: string; line?: number; summary?: Summary }>({ action: "check", id: begun.id }).catch(() => ({ ok: false, reason: "network" }) as { ok: boolean; reason?: string; line?: number; summary?: Summary });
    if (checked.ok && checked.summary) setState({ step: "checked", name: file.name, id: begun.id, summary: checked.summary });
    else {
      setState({ step: "idle" });
      setProblem(problemText(checked.reason ?? "failed", checked.line));
    }
  };

  const start = async () => {
    if (state.step !== "checked") return;
    setConfirm(false);
    const reply = await post<{ token?: string; error?: string }>({ action: "start", id: state.id, confirm: true }).catch(() => ({ error: "network" }) as { token?: string; error?: string });
    if (reply.token) setState({ step: "running", token: reply.token, job: null });
    else {
      setState({ step: "idle" });
      setProblem(problemText(reply.error ?? "failed"));
    }
  };

  const job = state.step === "running" ? state.job : null;

  return (
    <div className="flex flex-col gap-3">
      <a
        href="/admin/transfer/backup"
        download
        className="bg-surface hover:bg-tint/60 group flex items-center gap-4 rounded-[22px] px-5 py-4 shadow-[var(--shadow-1)] transition-colors sm:px-6"
      >
        <span className="bg-tint text-brand-text grid size-11 shrink-0 place-items-center rounded-[14px]">
          <DatabaseBackup className="size-5" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-ink text-[15.5px] font-extrabold">{t("admin.transfer.backup.download")}</span>
          <span className="text-ink-3 text-[13px] text-balance">{t("admin.transfer.backup.downloadHint")}</span>
        </span>
        <Download className="text-brand-text ms-auto size-5 shrink-0 transition-transform duration-150 group-hover:translate-y-0.5" strokeWidth={2} aria-hidden />
      </a>

      <section aria-labelledby="restore-title" className="bg-surface flex flex-col gap-4 rounded-[22px] px-5 py-5 shadow-[var(--shadow-1)] sm:px-6">
        <div className="flex items-start gap-4">
          <span className="bg-tint text-brand-text grid size-11 shrink-0 place-items-center rounded-[14px]">
            <ArchiveRestore className="size-5" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h3 id="restore-title" className="text-ink text-[15.5px] font-extrabold">
              {t("admin.transfer.backup.restore")}
            </h3>
            <p className="text-ink-2 max-w-[64ch] text-[13.5px] leading-6">{t("admin.transfer.backup.restoreHint")}</p>
          </div>
        </div>

        {state.step === "idle" ? (
          <div>
            <Button type="button" variant="secondary" onClick={() => input.current?.click()}>
              <Upload strokeWidth={2} aria-hidden />
              {t("admin.transfer.backup.pick")}
            </Button>
            <input
              ref={input}
              type="file"
              accept=".polyra,application/gzip"
              className="hidden"
              aria-label={t("admin.transfer.backup.pick")}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void upload(file);
              }}
            />
          </div>
        ) : null}

        {state.step === "uploading" ? (
          <Progress label={t("admin.transfer.backup.uploading", { percent: Math.floor((state.sent / Math.max(1, state.size)) * 100) })} value={state.sent / Math.max(1, state.size)} />
        ) : null}
        {state.step === "checking" ? <Waiting text={t("admin.transfer.backup.checking")} /> : null}

        {state.step === "checked" ? (
          <div className="flex flex-col gap-3">
            <p className="text-ink text-[15px] leading-7 font-bold">
              {t("admin.transfer.backup.found", { date: formatDateTimeFa(new Date(state.summary.created_at)) })}
            </p>
            <ul className="text-ink-2 flex flex-wrap gap-x-5 gap-y-1 text-[14px]">
              {SHOWN.map(({ table, key }) => (
                <li key={table}>{t(key, { count: state.summary.tables[table] ?? 0 })}</li>
              ))}
              <li>{t("admin.transfer.backup.counts.files", { count: state.summary.files })}</li>
            </ul>
            <p className="bg-bad-soft text-bad rounded-[14px] px-4 py-3 text-[14px] leading-7 font-bold">{t("admin.transfer.backup.warning")}</p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="destructive" onClick={() => setConfirm(true)}>
                {t("admin.transfer.backup.restoreButton")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setState({ step: "idle" })}>
                {t("admin.transfer.backup.cancel")}
              </Button>
            </div>
          </div>
        ) : null}

        {state.step === "running" && (!job || job.state === "saving") ? <Waiting text={t("admin.transfer.backup.saving")} /> : null}
        {job?.state === "restoring" ? (
          <Progress
            label={t("admin.transfer.backup.restoring", { done: job.rows, total: job.totalRows })}
            value={job.rows / Math.max(1, job.totalRows)}
          />
        ) : null}
        {job?.state === "done" ? (
          <div role="status" className="flex flex-col items-start gap-3">
            <p className="text-ink flex items-center gap-2 text-[16px] font-extrabold">
              <CircleCheck className="text-ok size-5" strokeWidth={2.25} aria-hidden />
              {t("admin.transfer.backup.done")}
            </p>
            <p className="text-ink-2 text-[14px] leading-7">{job.keptSession ? t("admin.transfer.backup.doneSignedIn") : t("admin.transfer.backup.doneSignIn")}</p>
            <Button asChild>
              <a href={job.keptSession ? "/admin" : "/login?next=/admin"}>{job.keptSession ? t("admin.transfer.backup.toPanel") : t("admin.transfer.backup.toLogin")}</a>
            </Button>
          </div>
        ) : null}
        {job?.state === "failed" ? (
          <p role="alert" className="text-bad flex items-start gap-1.5 text-[14px] leading-7 font-bold">
            <CircleAlert className="mt-1.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
            {t("admin.transfer.backup.failed", { code: job.code ?? "—" })}
          </p>
        ) : null}

        {problem ? (
          <p role="alert" className="text-bad flex items-start gap-1.5 text-[14px] leading-7 font-bold">
            <CircleAlert className="mt-1.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
            {problem}
          </p>
        ) : null}
      </section>

      {saved.length > 0 ? (
        <details className="bg-surface group rounded-[22px] shadow-[var(--shadow-1)]">
          <summary className="text-ink hover:bg-tint/50 flex cursor-pointer list-none items-center gap-2 rounded-[22px] px-5 py-4 text-[14.5px] font-bold sm:px-6 [&::-webkit-details-marker]:hidden">
            {t("admin.transfer.backup.saved", { count: saved.length })}
          </summary>
          <p className="text-ink-3 px-5 text-[13px] leading-6 sm:px-6">{t("admin.transfer.backup.savedHint")}</p>
          <ul className="divide-line flex flex-col divide-y px-5 pb-2 sm:px-6">
            {saved.map((item) => (
              <li key={item.name} className="flex items-center gap-3 py-3">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-ink-2 text-[14px]">{formatDateTimeFa(new Date(item.at))}</span>
                  <span className="text-ink-3 text-[12.5px] tabular-nums">{t("admin.transfer.backup.size", { size: formatNumber(Math.max(1, Math.round(item.bytes / 1024))) })}</span>
                </span>
                <a
                  href={`/admin/transfer/backup?saved=${encodeURIComponent(item.name)}`}
                  download
                  className="border-line-2 text-ink hover:bg-tint hover:text-brand-text flex h-8 items-center gap-1.5 rounded-[10px] border px-2.5 text-[12.5px] font-bold transition-colors"
                >
                  <Download className="size-3.5" strokeWidth={2.25} aria-hidden />
                  {t("admin.transfer.backup.savedDownload")}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.transfer.backup.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.transfer.backup.confirmText")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.transfer.backup.cancel")}</AlertDialogCancel>
            <Button type="button" variant="destructive" onClick={() => void start()}>
              {t("admin.transfer.backup.confirmYes")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <p role="status" className="text-ink-2 flex items-center gap-2 text-[14px] font-bold">
      <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden />
      {text}
    </p>
  );
}

function Progress({ label, value }: { label: string; value: number }) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div role="status" className="flex flex-col gap-2">
      <p className="text-ink-2 text-[14px] font-bold tabular-nums">{label}</p>
      <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="bg-tint h-2 overflow-hidden rounded-full">
        <div className={cn("bg-brand h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none")} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

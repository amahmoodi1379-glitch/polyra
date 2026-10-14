"use client";

import Link from "next/link";
import { useRef, useState, type DragEvent } from "react";
import { CircleAlert, CircleCheck, FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { cn } from "@/lib/utils";
import { wordsCsv, type CsvReply } from "./actions";

type Report = Extract<CsvReply, { state: "checked" | "imported" }>;
type State =
  | { step: "idle" }
  | { step: "checking" | "importing"; name: string; text: string; report?: Report }
  | { step: "checked"; name: string; text: string; report: Report }
  | { step: "done"; name: string; report: Report };

const REJECTED_SHOWN = 30;

function problemOf(reply: CsvReply): string {
  if (reply.state === "error") return t("admin.transfer.import.failed", { code: reply.code });
  if (reply.state === "invalid") {
    return reply.reason === "columns"
      ? t("admin.transfer.import.invalid.columns", { columns: (reply.missing ?? []).join("، ") })
      : t(`admin.transfer.import.invalid.${reply.reason}`);
  }
  return "";
}

/**
 * The word file (PRD §14.7): pick or drop a CSV, see what it would change, then import it. Nothing is
 * saved until «وارد کن».
 */
export function WordImport({ language, languageName }: { language: string; languageName: string }) {
  const [state, setState] = useState<State>({ step: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy = state.step === "checking" || state.step === "importing";

  const check = async (file: File) => {
    if (!/\.(csv|txt)$/i.test(file.name) && !/csv|text\/plain/.test(file.type)) {
      setProblem(t("admin.transfer.import.notCsv"));
      return;
    }
    const text = await file.text();
    setState({ step: "checking", name: file.name, text });
    const reply = await wordsCsv(language, text, false);
    if (reply.state === "checked") setState({ step: "checked", name: file.name, text, report: reply });
    else {
      setState({ step: "idle" });
      setProblem(problemOf(reply));
    }
  };

  const save = async () => {
    if (state.step !== "checked") return;
    setState({ ...state, step: "importing" });
    const reply = await wordsCsv(language, state.text, true);
    if (reply.state === "imported") setState({ step: "done", name: state.name, report: reply });
    else {
      setState(state);
      setProblem(problemOf(reply));
    }
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    const file = event.dataTransfer.files[0];
    if (file && !busy) {
      setProblem(null);
      void check(file);
    }
  };

  const report = "report" in state ? state.report : undefined;
  const changes = report ? report.added + report.updated + report.reordered.length : 0;

  return (
    <div className="flex flex-col gap-4">
      {state.step === "idle" || state.step === "checking" ? (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          className={cn(
            "bg-surface flex flex-col items-center gap-3 rounded-[22px] border-2 border-dashed px-6 py-9 text-center shadow-[var(--shadow-1)] transition-colors",
            over ? "border-brand bg-tint" : "border-line-2",
          )}
        >
          <FileSpreadsheet className="text-brand-text size-8" strokeWidth={1.75} aria-hidden />
          <p className="text-ink text-[16px] font-extrabold">{t("admin.transfer.import.drop")}</p>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : <Upload strokeWidth={2} aria-hidden />}
            {busy ? t("admin.transfer.import.checking") : t("admin.transfer.import.pick")}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) {
                setProblem(null);
                void check(file);
              }
            }}
          />
        </div>
      ) : null}

      {problem ? (
        <p role="alert" className="text-bad flex items-start gap-1.5 text-[14px] leading-7 font-bold">
          <CircleAlert className="mt-1.5 size-4 shrink-0" strokeWidth={2} aria-hidden />
          {isolateLatin(problem)}
        </p>
      ) : null}

      {report && state.step !== "idle" && state.step !== "checking" ? (
        <section aria-live="polite" className="bg-surface flex flex-col rounded-[22px] shadow-[var(--shadow-1)]">
          <div className="flex flex-col gap-3 px-5 pt-5 pb-4 sm:px-6">
            <p className="text-ink-3 flex items-center gap-1.5 text-[13px] font-bold">
              <FileSpreadsheet className="size-4" strokeWidth={2} aria-hidden />
              <bdi dir="ltr" className="min-w-0 truncate">
                {state.name}
              </bdi>
              <span className="bg-line-2 mx-0.5 size-1 shrink-0 rounded-full" aria-hidden />
              {languageName}
            </p>
            {state.step === "done" ? (
              <p className="text-ink flex items-center gap-2 text-[17px] font-extrabold">
                <CircleCheck className="text-ok size-5" strokeWidth={2.25} aria-hidden />
                {t("admin.transfer.import.done")}
              </p>
            ) : (
              <p className="text-ink text-[17px] font-extrabold">{changes > 0 ? t("admin.transfer.import.checkedTitle") : t("admin.transfer.import.nothing")}</p>
            )}
            <Counts report={report} done={state.step === "done"} />
            <Notes report={report} done={state.step === "done"} />
          </div>

          {report.rejected.length > 0 ? (
            <details className="border-line group border-t" open={report.rejected.length <= 5}>
              <summary className="text-ink hover:bg-tint/50 flex cursor-pointer list-none items-center gap-2 px-5 py-3 text-[14px] font-bold sm:px-6 [&::-webkit-details-marker]:hidden">
                <CircleAlert className="text-bad size-4" strokeWidth={2} aria-hidden />
                {t("admin.transfer.import.rejectedTitle")}
                <span className="text-ink-3 text-[13px] tabular-nums">{formatNumber(report.rejected.length)}</span>
              </summary>
              <ol className="divide-line flex flex-col divide-y px-5 pb-2 sm:px-6">
                {report.rejected.slice(0, REJECTED_SHOWN).map((item) => (
                  <li key={item.row} className="flex flex-col gap-1 py-3">
                    <p className="flex items-baseline gap-2 text-[14px] font-bold">
                      <span className="text-ink-3 text-[12.5px] tabular-nums">{t("admin.transfer.import.row", { row: item.row })}</span>
                      {item.label ? (
                        <bdi dir="ltr" className="lat text-ink text-[15px] font-semibold">
                          {item.label}
                        </bdi>
                      ) : null}
                    </p>
                    {item.problems.map((line) => (
                      <p key={line} className="text-ink-2 text-[13.5px] leading-6">
                        {isolateLatin(line)}
                      </p>
                    ))}
                  </li>
                ))}
                {report.rejected.length > REJECTED_SHOWN ? (
                  <li className="text-ink-3 py-3 text-[13px]">{t("admin.transfer.import.more", { count: report.rejected.length - REJECTED_SHOWN })}</li>
                ) : null}
              </ol>
            </details>
          ) : null}

          <div className="border-line flex flex-wrap items-center gap-2 border-t px-5 py-4 sm:px-6">
            {state.step === "done" ? (
              <>
                <Button asChild>
                  <Link href={`/admin/content?lang=${language}&type=words`}>{t("admin.transfer.import.toLibrary")}</Link>
                </Button>
                <Button type="button" variant="ghost" onClick={() => setState({ step: "idle" })}>
                  {t("admin.transfer.import.another")}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" disabled={busy || changes === 0} onClick={() => void save()} className="min-w-28">
                  {state.step === "importing" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
                  {state.step === "importing" ? t("admin.transfer.import.importing") : t("admin.transfer.import.confirm")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setProblem(null);
                    setState({ step: "idle" });
                  }}
                >
                  {t("admin.transfer.import.another")}
                </Button>
              </>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Counts({ report, done }: { report: Report; done: boolean }) {
  const base = done ? "admin.transfer.import.doneCounts" : "admin.transfer.import.counts";
  const items = [
    { key: "added", count: report.added, tone: "bg-tint text-brand-text" },
    { key: "updated", count: report.updated, tone: "bg-tint-2 text-ink" },
    { key: "unchanged", count: report.unchanged, tone: "border border-line-2 text-ink-3" },
    { key: "rejected", count: report.rejected.length, tone: "bg-bad-soft text-bad" },
  ] as const;
  return (
    <ul className="flex flex-wrap gap-2">
      {items
        .filter((item) => item.count > 0)
        .map((item) => (
          <li key={item.key} className={cn("flex h-8 items-center rounded-[10px] px-3 text-[13.5px] font-bold", item.tone)}>
            {t(`${base}.${item.key}`, { count: item.count })}
          </li>
        ))}
    </ul>
  );
}

function Notes({ report, done }: { report: Report; done: boolean }) {
  const lines = [
    report.duplicates > 0 ? t("admin.transfer.import.duplicates", { count: report.duplicates }) : null,
    report.reordered.length > 0 ? t(done ? "admin.transfer.import.reorderedDone" : "admin.transfer.import.reordered", { levels: isolateLatin(report.reordered.join("، ")) }) : null,
    report.ignored.length > 0 ? t("admin.transfer.import.ignored", { columns: isolateLatin(report.ignored.join("، ")) }) : null,
  ].filter((line): line is string => line !== null);
  if (lines.length === 0) return null;
  return (
    <ul className="text-ink-2 flex flex-col gap-1 text-[13.5px] leading-6">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CircleCheck, FastForward, LoaderCircle, Play, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/i18n";
import type { ScenarioId } from "@/lib/rehearse";
import { cn } from "@/lib/utils";
import { moveTime, playScenario } from "./actions";


type ScenarioRow = { id: ScenarioId; days: number; sessions: number };
type JobView = { scenario: ScenarioId; day: number; days: number; state: "running" | "done" | "failed"; code: string | null; sessions: number | null } | null;

const LENGTHS = [10, 15, 20, 30];
/** How often a running scenario's page asks again, in milliseconds. */
const POLL_MS = 2000;

/** Step 1: the made-up learner, the session length and «بساز»; while it plays, the day it is on. */
export function ScenarioPicker({ language, scenarios, minutes, job }: { language: string; scenarios: ScenarioRow[]; minutes: number; job: JobView }) {
  const router = useRouter();
  const [chosen, setChosen] = useState<ScenarioId>(job?.scenario ?? "week");
  const [length, setLength] = useState(LENGTHS.includes(minutes) ? minutes : 15);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const running = job?.state === "running";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, router]);

  return (
    <section aria-labelledby="pick" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="pick" className="text-ink text-[19px] font-extrabold">
          {t("admin.rehearse.pickTitle")}
        </h2>
        <p className="text-ink-2 max-w-[68ch] text-[14.5px] leading-7">{t("admin.rehearse.pickLead")}</p>
      </div>

      <div role="radiogroup" aria-labelledby="pick" className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {scenarios.map((scenario) => {
          const selected = scenario.id === chosen;
          return (
            <button
              key={scenario.id}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={running}
              onClick={() => setChosen(scenario.id)}
              className={cn(
                "flex flex-col items-start gap-1.5 rounded-[18px] px-4 py-3.5 text-start transition-[background-color,box-shadow] duration-150 disabled:opacity-60",
                selected ? "bg-tint ring-brand-text ring-2" : "bg-surface hover:bg-tint/60 shadow-[var(--shadow-1)]",
              )}
            >
              <span className="text-ink text-[15.5px] font-extrabold">{t(`admin.rehearse.scenarios.${scenario.id}.name`)}</span>
              <span className="text-ink-3 text-[12.5px] tabular-nums">
                {scenario.days === 0 ? t("admin.rehearse.noDays") : t("admin.rehearse.days", { days: scenario.days, sessions: scenario.sessions })}
              </span>
              <span className="text-ink-2 text-[13.5px] leading-6">{t(`admin.rehearse.scenarios.${scenario.id}.about`)}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="text-ink-2 flex items-center gap-2.5 text-[14px] font-bold">
          {t("admin.rehearse.length")}
          <select
            value={length}
            disabled={running}
            onChange={(event) => setLength(Number(event.target.value))}
            className="bg-surface border-line-2 text-ink h-10 rounded-[12px] border px-3 text-[14px]"
          >
            {LENGTHS.map((value) => (
              <option key={value} value={value}>
                {t("admin.rehearse.minutes", { n: value })}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          disabled={running || pending}
          onClick={() =>
            startTransition(async () => {
              const result = await playScenario(language, chosen, length);
              setBusy(result === "busy");
              router.refresh();
            })
          }
        >
          {running || pending ? <LoaderCircle className="motion-safe:animate-spin" strokeWidth={2} aria-hidden /> : <Play strokeWidth={1.75} aria-hidden />}
          {t("admin.rehearse.play")}
        </Button>
      </div>

      <div aria-live="polite">
        {running ? (
          <div className="bg-tint/70 flex flex-col gap-2 rounded-[18px] px-5 py-4">
            <p className="text-ink text-[15px] font-bold tabular-nums">{t("admin.rehearse.playing", { day: Math.min(job.day + 1, job.days), days: job.days })}</p>
            <div className="bg-surface h-2 overflow-hidden rounded-full" aria-hidden>
              <div className="bg-brand h-full rounded-full transition-[width] duration-500" style={{ width: `${job.days ? Math.round((job.day / job.days) * 100) : 0}%` }} />
            </div>
            <p className="text-ink-2 text-[13.5px] leading-6">{t("admin.rehearse.playingHint")}</p>
          </div>
        ) : busy ? (
          <p className="text-ink-2 text-[14px]">{t("admin.rehearse.busy")}</p>
        ) : job?.state === "done" ? (
          <p className="text-ok flex items-center gap-2 text-[14.5px] font-bold">
            <CircleCheck className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
            {t("admin.rehearse.done", { days: job.days, sessions: job.sessions ?? 0 })}
          </p>
        ) : job?.state === "failed" ? (
          <p role="alert" className="bg-bad-soft text-bad flex items-center gap-2 rounded-[16px] px-5 py-3.5 text-[14.5px] font-medium">
            <TriangleAlert className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
            {t("admin.rehearse.failed", { code: job.code ?? "" })}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** Step 4: «زمان را جلو ببر», the same as the app's test setting. */
export function TravelButtons({ language, days }: { language: string; days: number[] }) {
  const router = useRouter();
  const [moved, setMoved] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <section aria-labelledby="travel" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="travel" className="text-ink text-[19px] font-extrabold">
          {t("admin.rehearse.travelTitle")}
        </h2>
        <p className="text-ink-2 max-w-[68ch] text-[14.5px] leading-7">{t("admin.rehearse.travelLead")}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {days.map((n) => (
          <Button
            key={n}
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                await moveTime(language, n);
                setMoved(n);
                router.refresh();
              })
            }
          >
            <FastForward strokeWidth={1.75} aria-hidden />
            {t("admin.rehearse.travelDays", { n })}
          </Button>
        ))}
        <span aria-live="polite" className="text-ok text-[14px] font-bold">
          {moved !== null && !pending ? t("admin.rehearse.travelDone", { n: formatNumber(moved) }) : null}
        </span>
      </div>
    </section>
  );
}

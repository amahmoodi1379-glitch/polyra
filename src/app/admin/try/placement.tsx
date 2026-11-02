"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CircleCheck, ExternalLink, LoaderCircle, Play, TriangleAlert, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PlacementReadiness } from "@/engine/placement";
import type { PlacementOverview } from "@/server/learn/rehearse";
import { placeMadeUp, placeMyself } from "./actions";

const TRACKS = ["listening", "reading"] as const;
const share = (value: number) => `${formatNumber(Math.round(value * 100))}٪`;

/** What a teacher should fix before the test is fair, one plain sentence each (PRD §11.2, §11.4). */
function problems(rows: PlacementReadiness[]): string[] {
  const asked = rows.filter((row) => row.open && row.words > 0);
  const out: string[] = [];
  if (asked.length === 0) return [t("admin.rehearse.placement.noLevels")];
  for (const [index, row] of asked.entries()) {
    const { level } = row;
    if (row.words < row.blockSize) out.push(t("admin.rehearse.placement.wordsShort", { level, n: formatNumber(row.words), size: formatNumber(row.blockSize) }));
    if (row.grammar === 0) out.push(t("admin.rehearse.placement.grammarNone", { level }));
    else if (row.grammar < row.blockSize) out.push(t("admin.rehearse.placement.grammarShort", { level, n: formatNumber(row.grammar), size: formatNumber(row.blockSize) }));
    // The sample is of the level below F_g, so the last level's sentences are never asked.
    if (index < asked.length - 1 && row.sample < row.sampleSize) out.push(t("admin.rehearse.placement.sampleShort", { level, n: formatNumber(row.sample), size: formatNumber(row.sampleSize) }));
    // Texts come from the level below L: every level but the last can be asked.
    if (index < asked.length - 1) {
      for (const track of TRACKS) {
        if (row.texts[track] === 0) out.push(t("admin.rehearse.placement.textsNone", { level, track: t(`admin.rehearse.tracks.${track}`) }));
      }
    }
  }
  for (const row of rows) if (!row.open && row.words > 0) out.push(t("admin.rehearse.placement.closed", { level: row.level }));
  return out;
}

/**
 * «تعیین سطح» on «آزمایش مثل زبان‌آموز» (PRD §11): whether each level has enough to ask, the test taken
 * by the teacher or by a made-up learner of a chosen level, and the last result with its sample.
 */
export function PlacementCard({ language, overview }: { language: string; overview: PlacementOverview }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [known, setKnown] = useState<string>("none");
  const [failed, setFailed] = useState(false);
  const asked = overview.readiness.filter((row) => row.open && row.words > 0);
  const list = problems(overview.readiness);
  const last = overview.last;

  return (
    <section aria-labelledby="placement" className="flex flex-col gap-3" data-placement-card>
      <div className="flex flex-col gap-1">
        <h2 id="placement" className="text-ink text-[19px] font-extrabold">
          {t("admin.rehearse.placement.title")}
        </h2>
        <p className="text-ink-2 max-w-[68ch] text-[14.5px] leading-7">{t("admin.rehearse.placement.lead")}</p>
      </div>

      <div className="bg-surface flex flex-col gap-3 rounded-[22px] px-5 py-4 shadow-[var(--shadow-1)]">
        <h3 className="text-ink text-[16px] font-extrabold">{t("admin.rehearse.placement.readyTitle")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-[14px]">
            <thead>
              <tr className="text-ink-3 text-start text-[12.5px]">
                <th className="py-1.5 text-start font-bold">{t("admin.rehearse.placement.colLevel")}</th>
                <th className="py-1.5 text-start font-bold">{t("admin.rehearse.placement.colWords")}</th>
                <th className="py-1.5 text-start font-bold">{t("admin.rehearse.placement.colGrammar")}</th>
                <th className="py-1.5 text-start font-bold">{t("admin.rehearse.placement.colSample")}</th>
                <th className="py-1.5 text-start font-bold">{t("admin.rehearse.placement.colListening")}</th>
                <th className="py-1.5 text-start font-bold">{t("admin.rehearse.placement.colReading")}</th>
              </tr>
            </thead>
            <tbody>
              {overview.readiness.map((row) => (
                <tr key={row.level} className={cn("border-line border-t", row.open ? "text-ink" : "text-ink-3")} data-level={row.level}>
                  <td className="py-2 font-bold">
                    <bdi className="lat">{row.level}</bdi> {row.open ? null : <span className="text-[12.5px] font-normal">({t("admin.rehearse.placement.closedShort")})</span>}
                  </td>
                  <td className="py-2 tabular-nums">{formatNumber(row.words)}</td>
                  <td className="py-2 tabular-nums">{t("admin.rehearse.placement.of", { n: formatNumber(row.grammar), size: formatNumber(row.blockSize) })}</td>
                  <td className="py-2 tabular-nums">{t("admin.rehearse.placement.of", { n: formatNumber(row.sample), size: formatNumber(row.sampleSize) })}</td>
                  <td className="py-2 tabular-nums">{formatNumber(row.texts.listening)}</td>
                  <td className="py-2 tabular-nums">{formatNumber(row.texts.reading)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length === 0 ? (
          <p className="text-ok flex items-center gap-2 text-[14px] font-bold">
            <CircleCheck className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
            {t("admin.rehearse.placement.allGood")}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5" data-placement-problems>
            {list.map((line) => (
              <li key={line} className="text-ink-2 flex items-start gap-2 text-[14px] leading-6">
                <TriangleAlert className="text-brand-text mt-0.5 size-4.5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-ink-3 text-[13px] leading-6">{t("admin.rehearse.placement.readyHint")}</p>
      </div>

      <div className="bg-surface flex flex-col gap-3 rounded-[22px] px-5 py-4 shadow-[var(--shadow-1)]">
        <h3 className="text-ink text-[16px] font-extrabold">{t("admin.rehearse.placement.tryTitle")}</h3>
        <p className="text-ink-2 text-[14px] leading-6">{t("admin.rehearse.placement.tryLead")}</p>
        {overview.running ? (
          <p className="bg-tint/70 text-ink flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[16px] px-4 py-3 text-[14px]">
            {t("admin.rehearse.placement.running")}
            <Link href={`/learn/${language}/placement`} target="_blank" className="text-brand-text font-bold underline-offset-4 hover:underline">
              {t("admin.rehearse.placement.resume")}
            </Link>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <Button
            type="button"
            disabled={pending || asked.length === 0}
            onClick={() =>
              start(async () => {
                const ok = await placeMyself(language);
                setFailed(!ok);
                if (ok) window.open(`/learn/${language}/placement`, "_blank");
                router.refresh();
              })
            }
          >
            <ExternalLink strokeWidth={1.75} aria-hidden />
            {t("admin.rehearse.placement.myself")}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <label className="text-ink-2 flex items-center gap-2.5 text-[14px] font-bold">
            <UserRound className="size-4.5" strokeWidth={1.75} aria-hidden />
            {t("admin.rehearse.placement.knows")}
            <select
              value={known}
              disabled={pending}
              onChange={(event) => setKnown(event.target.value)}
              className="bg-surface border-line-2 text-ink h-10 rounded-[12px] border px-3 text-[14px]"
              data-placement-known
            >
              <option value="none">{t("admin.rehearse.placement.knowsNone")}</option>
              {asked.map((row) => (
                <option key={row.level} value={row.level}>
                  {t("admin.rehearse.placement.knowsUpTo", { level: row.level })}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            variant="outline"
            disabled={pending || asked.length === 0}
            onClick={() =>
              start(async () => {
                const ok = await placeMadeUp(language, known === "none" ? null : known);
                setFailed(!ok);
                router.refresh();
              })
            }
          >
            {pending ? <LoaderCircle className="motion-safe:animate-spin" strokeWidth={2} aria-hidden /> : <Play strokeWidth={1.75} aria-hidden />}
            {t("admin.rehearse.placement.madeUp")}
          </Button>
        </div>
        <p className="text-ink-3 text-[13px] leading-6">{t("admin.rehearse.placement.tryHint")}</p>
        {failed ? (
          <p role="alert" className="text-bad text-[14px] font-bold">
            {t("admin.rehearse.placement.tryFailed")}
          </p>
        ) : null}
      </div>

      {last?.result ? <LastRun overview={overview} /> : null}
    </section>
  );
}

function LastRun({ overview }: { overview: PlacementOverview }) {
  const last = overview.last!;
  const result = last.result!;
  const sample = last.sample;
  const levels = { vocab: result.fv, grammar: result.fg, listening: result.listening, reading: result.reading };
  return (
    <div className="bg-surface flex flex-col gap-2.5 rounded-[22px] px-5 py-4 shadow-[var(--shadow-1)]" data-placement-last>
      <h3 className="text-ink text-[16px] font-extrabold">{t("admin.rehearse.placement.lastTitle")}</h3>
      <p className="text-ink-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
        {(["vocab", "grammar", "listening", "reading"] as const).map((skill) => (
          <span key={skill} data-skill={skill}>
            {t(`admin.rehearse.skills.${skill}`)} <bdi className="lat font-bold">{levels[skill]}</bdi>
          </span>
        ))}
      </p>
      {result.stopped ? <p className="text-ink-2 text-[14px]">{t("admin.rehearse.placement.stopped")}</p> : null}
      {result.above ? <p className="text-ink-2 text-[14px]">{t(result.above === "path" ? "admin.rehearse.placement.abovePath" : "admin.rehearse.placement.aboveContent")}</p> : null}
      {result.phonicsAuto ? <p className="text-ink-2 text-[14px]">{t("admin.rehearse.placement.phonics")}</p> : null}
      <ul className="flex flex-col gap-1 text-[14px]">
        {result.blocks.map((block, index) => (
          <li key={index} className="text-ink-2">
            {t("admin.rehearse.placement.block", {
              part: t(block.part === "vocab" ? "admin.rehearse.placement.partVocab" : "admin.rehearse.placement.partGrammar"),
              level: block.level,
              right: formatNumber(block.right),
              asked: formatNumber(block.asked),
              size: formatNumber(block.size),
            })}{" "}
            <b className={block.passed ? "text-ok" : "text-bad"}>{t(block.passed ? "admin.rehearse.placement.passed" : "admin.rehearse.placement.notPassed")}</b>
          </li>
        ))}
        {last.texts.map((text) => (
          <li key={`${text.track}:${text.textId}`} className="text-ink-2">
            {t("admin.rehearse.placement.text", { track: t(`admin.rehearse.tracks.${text.track}`), level: text.level })}{" "}
            <bdi dir="ltr" className="lat">
              {overview.titles[text.textId]}
            </bdi>
            {": "}
            {text.score === null ? t("admin.rehearse.placement.textNotAnswered") : share(text.score)}
          </li>
        ))}
      </ul>
      <h4 className="text-ink mt-1 text-[15px] font-extrabold">{t("admin.rehearse.placement.sampleTitle")}</h4>
      {!sample?.vocab && !sample?.grammar ? <p className="text-ink-2 text-[14px]">{t("admin.rehearse.placement.sampleNone")}</p> : null}
      {sample?.vocab && overview.marks.vocab ? (
        <p className="text-ink-2 text-[14px] leading-6" data-sample="vocab">
          {t("admin.rehearse.placement.sampleVocab", {
            n: formatNumber(sample.vocab.wordIds.length),
            level: sample.vocab.level,
            ok: formatNumber(sample.vocab.ok),
            wrong: formatNumber(sample.vocab.wrong),
            need: formatNumber(overview.marks.vocab.need),
            fail: formatNumber(overview.marks.vocab.failAt),
          })}{" "}
          <b>{t(`admin.rehearse.placement.sample.${sample.vocab.result}`, { level: sample.vocab.level })}</b>
        </p>
      ) : null}
      {sample?.grammar && overview.marks.grammar ? (
        <p className="text-ink-2 text-[14px] leading-6" data-sample="grammar">
          {t("admin.rehearse.placement.sampleGrammar", {
            n: formatNumber(sample.grammar.targetIds.length),
            level: sample.grammar.level,
            ok: formatNumber(sample.grammar.ok),
            wrong: formatNumber(sample.grammar.wrong),
            need: formatNumber(overview.marks.grammar.need),
            fail: formatNumber(overview.marks.grammar.failAt),
          })}{" "}
          <b>{t(`admin.rehearse.placement.sample.${sample.grammar.result}`, { level: sample.grammar.level })}</b>
        </p>
      ) : null}
      <p className="text-ink-3 text-[13px] leading-6">{t("admin.rehearse.placement.sampleHint")}</p>
    </div>
  );
}

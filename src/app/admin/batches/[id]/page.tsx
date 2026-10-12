import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { t, type MessageKey } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { requireAdmin } from "@/server/auth/session";
import {
  batchFindings,
  batchParams,
  batchReport,
  batchStep,
  fixPrompt,
  hasQa,
  kindOf,
  lastChatbot,
  qaPrompt,
} from "@/server/content/batches";
import { isLanguage } from "@/server/content/languages";
import { describeProblem } from "@/server/content/problems";
import { openCounts } from "@/server/content/resolve";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { BatchFlow, type BatchView, type CountKey } from "./batch-flow";

export const metadata: Metadata = { title: t("admin.create.title") };

const countKeys: CountKey[] = ["added", "updated", "skipped", "dropped", "rejected"];

/** Practice sentences a grammar unit has, against the number its prompt asks for. */
async function unitTargets(unitId: unknown) {
  if (typeof unitId !== "number") return null;
  const [have, counts] = await Promise.all([
    db.sentenceTarget.count({ where: { target_type: "grammar", target_id: unitId, status: { not: "retired" } } }),
    appSetting<{ targets: number }>("prompt.grammar_counts"),
  ]);
  return { have, want: counts.targets };
}
const isLevel = (value: string) => /^[ABC][12]$/.test(value);

export default async function BatchPage({ params }: PageProps<"/admin/batches/[id]">) {
  const { id } = await params;
  const admin = await requireAdmin(`/admin/batches/${id}`);
  const batch = Number.isSafeInteger(Number(id)) ? await db.importBatch.findUnique({ where: { id: Number(id) } }) : null;
  const found = batch ? kindOf(batch.prompt_kind) : null;

  if (!batch || !found) {
    return (
      <div className="flex flex-col items-start gap-4">
        <p className="text-ink-2">{t("admin.batch.notFound")}</p>
        <BackLink />
      </div>
    );
  }

  const [chatbots, last] = await Promise.all([appSetting<string[]>("chatbot_names"), lastChatbot(admin.id)]);
  const info = batchParams(batch);
  const report = batchReport(batch);
  const kindName = t(`admin.batch.kind.${batch.prompt_kind}` as MessageKey);
  const language = isLanguage(batch.language) ? t(`common.languages.${batch.language}`) : batch.language;

  const view: BatchView = {
    id: batch.id,
    language: batch.language,
    slug: found.slug,
    step: batchStep(batch),
    hasQa: hasQa(batch.prompt_kind),
    chatbots,
    chatbot: batch.model_name,
    defaultChatbot: batch.model_name ?? (last && chatbots.includes(last) ? last : chatbots[0]),
    prompt: batch.prompt_text,
    cutLength: batch.state === "pasted" ? (batch.raw_output?.length ?? 0) : null,
    report: report && {
      rounds: report.rounds,
      counts: countKeys
        .map((key) => ({ key, value: key === "rejected" ? report.rejected.length : report[key] }))
        .filter((count, _, all) => count.value > 0 || (count.key === "added" && all.every((other) => !other.value))),
      rejected: report.rejected.map((item) => ({
        label: item.label,
        problems: item.problems.map((problem) => describeProblem(problem)),
      })),
      dismissed: report.dismissed ?? 0,
      warnings: report.warnings.map((flag) => ({ label: flag.label, text: describeProblem(flag.problem) })),
      issues: report.issues,
      accepted: report.accepted.map((item) => item.label),
    },
    open: await openCounts(batch.language, batch.id),
    targets: batch.prompt_kind === "P_G" ? await unitTargets(info.unit_id) : null,
    fixPrompt: fixPrompt(batch),
    qaPrompt: qaPrompt(batch),
    qaDone: batch.state === "qa_done" || batch.state === "reviewed",
    findings: batchFindings(batch).map(({ severity, problem, suggestion, label }) => ({ severity, problem, suggestion, label })),
  };

  return (
    <>
      <header className="flex flex-col gap-3">
        <BackLink />
        <div className="flex flex-col gap-1.5">
          <h1 className="text-ink flex flex-wrap items-center gap-x-3 gap-y-1 text-2xl leading-tight font-extrabold">
            {kindName}
            {isLevel(info.level) ? (
              <span className="lat bg-tint text-brand-text inline-flex h-8 items-center rounded-[10px] px-2.5 text-[17px] font-semibold">
                {info.level}
              </span>
            ) : null}
            <span className="text-ink-3 text-[15px] font-bold">{language}</span>
          </h1>
          {info.summary[0] ? <p className="text-ink-2 max-w-[62ch]">{isolateLatin(info.summary[0])}</p> : null}
          {info.summary[1] ? (
            <p className="text-ink-3 max-w-[70ch] text-[14.5px]">
              <bdi dir="ltr" className="lat">
                {info.summary[1]}
              </bdi>
            </p>
          ) : null}
        </div>
      </header>
      <BatchFlow view={view} />
    </>
  );
}

function BackLink() {
  return (
    <Link
      href="/admin/create"
      className="text-ink-3 hover:text-ink -ms-1 inline-flex w-fit items-center gap-1.5 rounded-[10px] px-1 py-1 text-[14px] font-bold transition-colors"
    >
      <ArrowRight className="size-4 ltr:-scale-x-100" strokeWidth={2} aria-hidden />
      {t("admin.batch.back")}
    </Link>
  );
}

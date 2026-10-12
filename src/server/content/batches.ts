import type { ImportBatch, Prisma, PromptKind } from "@/generated/prisma/client";
import { qaAnswer, qaFinding } from "@/schemas/qa";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { sentences } from "./kinds/sentences";
import type { ContentKind, PlanOptions } from "./kinds/types";
import { unitList } from "./kinds/unit-list";
import { wordList } from "./kinds/word-list";
import { words } from "./kinds/words";
import { languageInfo, type LanguageCode } from "./languages";
import { cleanPaste, joinPaste, type PasteResult } from "./paste";
import { describeProblem } from "./problems";
import { mergeRound, type EntityRef, type ImportReport } from "./report";
import { fillTemplate, PROMPT_VERSION, readTemplate } from "./template";

/**
 * The four-step path (PRD §13.9) for one batch: make the prompt, take the pasted answer (joining a
 * cut one), import it with a report and a fix prompt for rejected records, then the QA round.
 */

/** URL slug of each kind on the create pages. */
export const contentKinds = {
  "word-list": wordList,
  units: unitList,
  words,
  sentences,
} satisfies Record<string, ContentKind>;

export type KindSlug = keyof typeof contentKinds;

export function isKindSlug(value: string): value is KindSlug {
  return value in contentKinds;
}

export function kindOf(promptKind: PromptKind): { slug: KindSlug; kind: ContentKind } | null {
  for (const [slug, kind] of Object.entries(contentKinds)) {
    if (kind.kind === promptKind) return { slug: slug as KindSlug, kind };
  }
  return null;
}

/** Lists are checked by the teacher directly; the QA round is for content (PRD §14.8). */
export function hasQa(promptKind: PromptKind) {
  return promptKind !== "P_C" && promptKind !== "P_U";
}

type BatchParams = { level: string; summary: string[] } & Record<string, unknown>;

export function batchParams(batch: ImportBatch): BatchParams {
  return (batch.params ?? { level: "", summary: [] }) as BatchParams;
}

export function batchReport(batch: ImportBatch): ImportReport | null {
  return (batch.report ?? null) as ImportReport | null;
}

export type QaFindingRow = {
  path: string;
  severity: "high" | "medium" | "low";
  problem: string;
  suggestion: string | null;
  label: string | null;
  entity: EntityRef | null;
};

export function batchFindings(batch: ImportBatch): QaFindingRow[] {
  return (batch.qa_findings ?? []) as QaFindingRow[];
}

/** Step 1: picks the next batch, builds the full prompt and saves it. */
export async function createBatch(input: {
  slug: KindSlug;
  language: LanguageCode;
  options?: PlanOptions;
  adminId: number;
}): Promise<{ id: number } | { nothing: string }> {
  const kind = contentKinds[input.slug];
  const plan = await kind.plan(input.language, input.options ?? {});
  if ("nothing" in plan) return plan;

  const prompt = [
    fillTemplate(readTemplate("common.md"), { language: plan.values.language, level: plan.level }),
    fillTemplate(readTemplate(kind.template), plan.values),
  ].join("\n\n");

  const batch = await db.$transaction(async (tx) => {
    const created = await tx.importBatch.create({
      data: {
        language: input.language,
        prompt_kind: kind.kind,
        prompt_version: PROMPT_VERSION,
        prompt_text: prompt,
        params: { ...plan.params, level: plan.level, summary: plan.summary } as Prisma.InputJsonValue,
        created_by: input.adminId,
      },
    });
    await kind.reserve?.(tx, created);
    return created;
  });
  return { id: batch.id };
}

/** The chatbot the admin used; stored on every record of the batch (PRD §13.9). */
export async function setChatbot(batchId: number, name: string) {
  const names = await appSetting<string[]>("chatbot_names");
  if (!names.includes(name)) return false;
  await db.importBatch.update({ where: { id: batchId }, data: { model_name: name } });
  return true;
}

/** Joins the pasted parts in order: the first answer and each «ادامه بده» continuation. */
export function joinParts(parts: string[], rootKey: string): PasteResult {
  const filled = parts.filter((part) => part.trim() !== "");
  if (filled.length === 0) return { state: "empty" };
  let result = cleanPaste(filled[0], rootKey);
  for (const part of filled.slice(1)) {
    if (result.state !== "cut") break;
    result = joinPaste(result.text, part, rootKey);
  }
  return result;
}

export type SubmitResult =
  | { state: "imported"; rejected: number }
  | { state: "cut" }
  | { state: "empty" }
  | { state: "broken" }
  | { state: "wrong_answer" };

/**
 * Steps 2 and 3: imports a pasted answer, or a fix answer for rejected records. A cut answer is
 * kept so the admin can come back and paste the continuation later.
 */
export async function submitAnswer(batchId: number, parts: string[], mode: "answer" | "fix"): Promise<SubmitResult> {
  const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  const found = kindOf(batch.prompt_kind);
  if (!found) throw new Error(`No importer for ${batch.prompt_kind}`);
  const { kind } = found;

  const pasted = joinParts(parts, kind.rootKey);
  if (pasted.state === "cut" && mode === "answer") {
    await db.importBatch.update({ where: { id: batchId }, data: { raw_output: pasted.text, state: "pasted" } });
  }
  if (pasted.state !== "ok") return { state: pasted.state };

  const answer = pasted.value as Record<string, unknown>;
  const records = answer[kind.rootKey];
  if (!Array.isArray(records)) return { state: "wrong_answer" };
  const issues = Array.isArray(answer.issues)
    ? answer.issues.map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    : [];

  const report = await db.$transaction(
    async (tx) => {
      const round = await kind.importRecords(tx, batch, records);
      const merged = mergeRound(batchReport(batch), round, issues);
      const rawOutput = mode === "answer" ? pasted.text : `${batch.raw_output ?? ""}\n\n${pasted.text}`;
      await tx.importBatch.update({
        where: { id: batchId },
        data: {
          raw_output: rawOutput,
          report: merged as unknown as Prisma.InputJsonValue,
          state: batch.state === "qa_done" || batch.state === "reviewed" ? batch.state : "imported",
        },
      });
      return merged;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
  return { state: "imported", rejected: report.rejected.length };
}

/** The fix prompt holds only the rejected records and why (PRD §13.9 step 3). */
export function fixPrompt(batch: ImportBatch): string | null {
  const report = batchReport(batch);
  const found = kindOf(batch.prompt_kind);
  if (!report || report.rejected.length === 0 || !found) return null;
  const rejected = report.rejected
    .map((item, index) =>
      [
        `رکورد ${index + 1}:`,
        JSON.stringify(item.record, null, 2),
        "دلیل:",
        ...item.problems.map((problem) => `- ${describeProblem(problem, "chatbot")}`),
      ].join("\n"),
    )
    .join("\n\n");
  return fillTemplate(readTemplate("fix.md", batch.prompt_version), { root: found.kind.rootKey, rejected });
}

/** The QA prompt holds every imported record, in the same structure as the answer (PRD §14.8). */
export function qaPrompt(batch: ImportBatch): string | null {
  const report = batchReport(batch);
  const found = kindOf(batch.prompt_kind);
  if (!report || report.accepted.length === 0 || !found || !hasQa(batch.prompt_kind)) return null;
  const content = JSON.stringify({ [found.kind.rootKey]: report.accepted.map((item) => item.record) }, null, 1);
  return fillTemplate(readTemplate("P-QA.md", batch.prompt_version), {
    language: languageInfo[batch.language as LanguageCode]?.name_fa ?? batch.language,
    level: batchParams(batch).level,
    content,
  });
}

/** Step 4: stores the QA findings next to the records they point at. */
export async function submitQa(batchId: number, parts: string[]): Promise<SubmitResult> {
  const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  const report = batchReport(batch);
  const found = kindOf(batch.prompt_kind);
  if (!report || !found) throw new Error("QA before import");

  const pasted = joinParts(parts, "findings");
  if (pasted.state !== "ok") return { state: pasted.state };
  const answer = qaAnswer.safeParse(pasted.value);
  if (!answer.success) return { state: "wrong_answer" };

  const pathPattern = new RegExp(`^${found.kind.rootKey}\\[(\\d+)\\]`);
  const findings: QaFindingRow[] = [];
  for (const raw of answer.data.findings) {
    const parsed = qaFinding.safeParse(raw);
    if (!parsed.success) continue;
    const index = Number(parsed.data.path.match(pathPattern)?.[1] ?? -1);
    const accepted = report.accepted[index];
    findings.push({ ...parsed.data, label: accepted?.label ?? null, entity: accepted?.entity ?? null });
  }
  await db.importBatch.update({
    where: { id: batchId },
    data: { qa_findings: findings as unknown as Prisma.InputJsonValue, state: "qa_done" },
  });
  return { state: "imported", rejected: 0 };
}

/** A batch nothing was imported from can be thrown away; its list rows become free again. */
export async function cancelBatch(batchId: number) {
  const batch = await db.importBatch.findUniqueOrThrow({ where: { id: batchId } });
  if (batch.report) return false;
  await db.$transaction([
    db.frequencyItem.updateMany({ where: { used_in_batch_id: batchId }, data: { used_in_batch_id: null } }),
    db.importBatch.delete({ where: { id: batchId } }),
  ]);
  return true;
}

/** Where the admin is on the four-step path; 5 means the batch is finished. */
export function batchStep(batch: ImportBatch): 1 | 2 | 3 | 4 | 5 {
  if (batch.state === "qa_done" || batch.state === "reviewed") return 5;
  if (batch.state === "imported") {
    if ((batchReport(batch)?.rejected.length ?? 0) > 0) return 3;
    return hasQa(batch.prompt_kind) ? 4 : 5;
  }
  return batch.model_name ? 2 : 1;
}

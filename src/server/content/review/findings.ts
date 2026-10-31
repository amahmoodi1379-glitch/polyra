import { db } from "@/server/db";
import type { QaFindingRow } from "../batches";
import { describeProblem } from "../problems";
import type { EntityRef, ImportReport } from "../report";

export type ItemFinding = Omit<QaFindingRow, "entity" | "label"> & { batchId: number; at: Date };

/**
 * The QA findings that point at these items (PRD §13.9: «مشکوک» next to the item), newest batch
 * first. Findings stay with their batch, so an item shows every finding any of its batches had.
 */
export async function findingsOf(type: EntityRef["type"], ids: number[]): Promise<Map<number, ItemFinding[]>> {
  const out = new Map<number, ItemFinding[]>();
  if (ids.length === 0) return out;
  const batches = await db.importBatch.findMany({
    where: { OR: ids.map((id) => ({ qa_findings: { array_contains: [{ entity: { type, id } }] } })) },
    select: { id: true, qa_findings: true, updated_at: true },
    orderBy: { id: "desc" },
  });
  const wanted = new Set(ids);
  for (const batch of batches) {
    for (const finding of (batch.qa_findings ?? []) as QaFindingRow[]) {
      if (finding.entity?.type !== type || !wanted.has(finding.entity.id)) continue;
      const list = out.get(finding.entity.id) ?? [];
      list.push({ path: finding.path, severity: finding.severity, problem: finding.problem, suggestion: finding.suggestion, batchId: batch.id, at: batch.updated_at });
      out.set(finding.entity.id, list);
    }
  }
  return out;
}

const rank = { high: 0, medium: 1, low: 2 } as const;

export type QaFlag = { count: number; severity: ItemFinding["severity"] };

/** The mark a list row shows: how many findings and the most serious one. */
export function findingMark(list: ItemFinding[] | undefined): QaFlag | null {
  if (!list || list.length === 0) return null;
  const severity = list.reduce<ItemFinding["severity"]>((top, finding) => (rank[finding.severity] < rank[top] ? finding.severity : top), "low");
  return { count: list.length, severity };
}

/** The import warnings about one item (PRD §13.3 «هشدار»), in plain Persian, newest batch first. */
export async function warningsOf(ref: EntityRef): Promise<string[]> {
  const batches = await db.importBatch.findMany({
    where: { report: { path: ["warnings"], array_contains: [{ entity: { type: ref.type, id: ref.id } }] } },
    select: { report: true },
    orderBy: { id: "desc" },
  });
  const out: string[] = [];
  for (const batch of batches) {
    for (const flag of (batch.report as ImportReport | null)?.warnings ?? []) {
      if (flag.entity?.type !== ref.type || flag.entity.id !== ref.id) continue;
      const text = describeProblem(flag.problem, "admin");
      if (!out.includes(text)) out.push(text);
    }
  }
  return out;
}

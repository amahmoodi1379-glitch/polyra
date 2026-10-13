import type { z } from "zod";
import { db } from "@/server/db";
import type { Tx } from "../../kinds/types";
import { describeProblem, zodProblems, type Problem } from "../../problems";
import { changes, logChange } from "../log";
import { entityOf, type LibrarySlug } from "../slugs";
import type { FieldError } from "./types";

export const errorsOf = (problems: Problem[]): FieldError[] =>
  problems.map((item) => ({ path: typeof item.vars?.field === "string" ? item.vars.field : "", message: describeProblem(item) }));

/** The form's values checked against their shape; a wrong shape is told in plain Persian. */
export function parseValues<S extends z.ZodType>(schema: S, raw: unknown): { ok: true; values: z.output<S> } | { ok: false; errors: FieldError[] } {
  const parsed = schema.safeParse(raw, { reportInput: true });
  return parsed.success ? { ok: true, values: parsed.data } : { ok: false, errors: errorsOf(zodProblems(parsed.error)) };
}

/**
 * Logs an edit with only the columns that changed (PRD §13.1 «قبل و بعد»). Returns false when
 * nothing changed, so the caller can skip the update.
 */
export async function logEdit(
  tx: Tx,
  adminId: number,
  slug: LibrarySlug,
  id: number,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  extra?: { before: Record<string, unknown>; after: Record<string, unknown> },
) {
  const diff = changes(before, after);
  if (!diff && !extra) return false;
  await logChange(tx, adminId, {
    action: "edit",
    entity: entityOf[slug],
    entityId: id,
    before: { ...diff?.before, ...extra?.before },
    after: { ...diff?.after, ...extra?.after },
  });
  return true;
}

/** Marks audio files stale when the text they speak changed (PRD §13.7, §13.8). */
export async function staleAudio(tx: Tx, ids: (number | null | undefined)[]) {
  const live = ids.filter((id): id is number => typeof id === "number");
  if (live.length > 0) await tx.audioAsset.updateMany({ where: { id: { in: live } }, data: { stale: true } });
}

export type WordInfo = { code: string; lemma: string; meaning_fa: string | null; level: string; pos: string };

/** Lemma, meaning and level of the words a form shows by code. */
export async function wordInfo(language: string, codes: (string | null | undefined)[]): Promise<Record<string, WordInfo>> {
  const wanted = [...new Set(codes.filter((code): code is string => Boolean(code)))];
  if (wanted.length === 0) return {};
  const rows = await db.word.findMany({
    where: { language, code: { in: wanted } },
    select: { code: true, lemma: true, meaning_fa: true, level: true, pos: true },
  });
  return Object.fromEntries(rows.map((row) => [row.code, row]));
}

/** Trimmed text, or null when empty. */
export const textOrNull = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

import type { ImportBatch, Prisma, PromptKind } from "@/generated/prisma/client";
import type { LanguageCode } from "../languages";
import type { RoundResult } from "../report";

export type Tx = Prisma.TransactionClient;

/** What step 1 shows and stores: the next batch the panel picked (PRD §13.9). */
export type BatchPlan = {
  /** Saved in import_batch.params; enough to import the answer and to resume later. */
  params: Record<string, unknown>;
  /** Values for the template's ⟦name⟧ places. */
  values: Record<string, string>;
  /** Short Persian lines for the admin: what this batch is about. */
  summary: string[];
  /** Level shown in the QA prompt. */
  level: string;
};

export type PlanOptions = { level?: string };

/** One content kind on the four-step path: picks the next batch and imports its answers. */
export type ContentKind = {
  kind: PromptKind;
  /** File name in prompts/<version>, e.g. "P-W.md". */
  template: string;
  /** Top-level key of the answer that holds the records, e.g. "words". */
  rootKey: string;
  /** Picks the next batch, or null when there is nothing left to make. */
  plan(language: LanguageCode, options: PlanOptions): Promise<BatchPlan | { nothing: string }>;
  /** Called inside the batch's transaction right after it is created (e.g. to reserve list rows). */
  reserve?(tx: Tx, batch: ImportBatch): Promise<void>;
  /** Imports the records of one pasted answer. */
  importRecords(tx: Tx, batch: ImportBatch, records: unknown[]): Promise<RoundResult>;
};

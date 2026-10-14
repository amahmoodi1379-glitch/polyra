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

export type PlanOptions = {
  level?: string;
  /** P-S only: make sentences for exactly these words (from «سلامت محتوا», PRD §13.11). */
  wordIds?: number[];
};

/** One part of an answer that is a single object with several lists, like a grammar unit (P-G). */
export type AnswerPart = { key: string; single?: boolean };

/** One content kind on the four-step path: picks the next batch and imports its answers. */
export type ContentKind = {
  kind: PromptKind;
  /** File name in prompts/<version>, e.g. "P-W.md". */
  template: string;
  /** Top-level key of the answer that holds the records, e.g. "words". */
  rootKey: string;
  /**
   * For an answer made of several parts: every part, in order. Records are taken from each part, and
   * `importRecords` gets the part of each record. Without it the answer is one list under rootKey.
   */
  parts?: AnswerPart[];
  /**
   * For a batch made for one item (a grammar unit): false when the pasted answer names another item,
   * so it is refused as a whole instead of being stored under the wrong one.
   */
  matches?(batch: ImportBatch, answer: Record<string, unknown>): boolean;
  /** Picks the next batch, or null when there is nothing left to make. */
  plan(language: LanguageCode, options: PlanOptions): Promise<BatchPlan | { nothing: string }>;
  /** Called inside the batch's transaction right after it is created (e.g. to reserve list rows). */
  reserve?(tx: Tx, batch: ImportBatch): Promise<void>;
  /** Imports the records of one pasted answer; `parts[i]` is the part record i came from. */
  importRecords(tx: Tx, batch: ImportBatch, records: unknown[], parts: string[]): Promise<RoundResult>;
};

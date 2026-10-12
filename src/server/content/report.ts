import type { Problem } from "./problems";

/** What a record became in the database, so QA findings and reports can point at it. */
export type EntityRef = {
  type: "word" | "sentence" | "grammar_unit" | "transform_item" | "translate_item";
  id: number;
};

/**
 * A record that was imported; `record` is what the chatbot sent, reused for the QA prompt. `part` is
 * the answer part it came from, for answers made of several parts (a grammar unit's targets).
 */
export type AcceptedRecord = { label: string; entity: EntityRef | null; record: unknown; part?: string };
/** A record that was not imported, with every reason (PRD §13.3 "مسدودکننده"). */
export type RejectedRecord = { label: string; record: unknown; problems: Problem[]; part?: string };
/** Imported, but worth a look (PRD §13.3 "هشدار"). */
export type Flag = { label: string; problem: Problem; entity?: EntityRef };

/** The outcome of importing one pasted answer (the first one or a fix). */
export type RoundResult = {
  added: number;
  updated: number;
  /** Already there and left as is (for example a word the list already had). */
  skipped: number;
  /** Left out on purpose by the chatbot (keep = false in a word list). */
  dropped: number;
  accepted: AcceptedRecord[];
  rejected: RejectedRecord[];
  warnings: Flag[];
  /** Word rows that need the admin: not in the list, or a name that equals a word (PRD §13.9). */
  candidates: number;
  /** Mappings the automatic check did not accept (PRD §14.1 rule 6). */
  suspects: number;
  /** Words imported with a lemma that already exists, waiting for "new sense or duplicate". */
  duplicates: number;
};

/**
 * Stored in import_batch.report. Counts add up over the rounds; `rejected` is the latest round's.
 * `dismissed` counts rejected records the admin chose not to fix.
 */
export type ImportReport = RoundResult & { rounds: number; issues: string[]; dismissed?: number };

export function emptyRound(): RoundResult {
  return {
    added: 0,
    updated: 0,
    skipped: 0,
    dropped: 0,
    accepted: [],
    rejected: [],
    warnings: [],
    candidates: 0,
    suspects: 0,
    duplicates: 0,
  };
}

/** Adds a fix round to the report so far. Records the fix resent replace their rejection. */
export function mergeRound(report: ImportReport | null, round: RoundResult, issues: string[]): ImportReport {
  if (!report) return { ...round, rounds: 1, issues };
  return {
    rounds: report.rounds + 1,
    added: report.added + round.added,
    updated: report.updated + round.updated,
    skipped: report.skipped + round.skipped,
    dropped: report.dropped + round.dropped,
    accepted: [...report.accepted, ...round.accepted],
    rejected: round.rejected,
    warnings: [...report.warnings, ...round.warnings],
    candidates: report.candidates + round.candidates,
    suspects: report.suspects + round.suspects,
    duplicates: report.duplicates + round.duplicates,
    issues: [...report.issues, ...issues],
    dismissed: report.dismissed,
  };
}

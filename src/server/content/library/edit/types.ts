import type { ContentStatus } from "@/generated/prisma/client";
import type { Voice } from "../list";

/**
 * The edit page of one item (PRD §13.2 «فرم ویرایش»): what the header shows, the form's values as
 * plain JSON, and whatever the form needs to show around them (word names, sentence texts, …).
 */
export type ItemView = {
  title: string;
  titleVoice: Voice;
  status: ContentStatus;
  suspended: boolean;
  level: string | null;
  importBatchId: number | null;
  modelName: string | null;
  promptVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Loaded<V, C = Record<string, never>> = { language: string; view: ItemView; values: V; context: C };

/** A problem placed on the form: `path` is like "tokens[3].surface", `message` plain Persian. */
export type FieldError = { path: string; message: string };

export type SaveResult<V> =
  | { state: "saved"; values: V; notes: string[] }
  | { state: "invalid"; errors: FieldError[] }
  | { state: "gone" };

export type Editor<V, C = Record<string, never>> = {
  load(id: number): Promise<Loaded<V, C> | null>;
  save(id: number, raw: unknown, adminId: number): Promise<SaveResult<V>>;
};

export type BaseRow = {
  status: ContentStatus;
  suspended: boolean;
  import_batch_id: number | null;
  model_name: string | null;
  prompt_version: string | null;
  created_at: Date;
  updated_at: Date;
};

export function viewOf(row: BaseRow, title: string, titleVoice: Voice, level: string | null): ItemView {
  return {
    title,
    titleVoice,
    status: row.status,
    suspended: row.suspended,
    level,
    importBatchId: row.import_batch_id,
    modelName: row.model_name,
    promptVersion: row.prompt_version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

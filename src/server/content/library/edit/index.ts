import type { LibrarySlug } from "../slugs";
import { dialogueEditor } from "./dialogues";
import { errorfixEditor } from "./errorfix";
import { transformEditor, translationEditor } from "./grammar-items";
import { phonicsEditor } from "./phonics";
import { sentenceEditor } from "./sentences";
import { tableEditor } from "./tables";
import { textEditor } from "./texts";
import { unitEditor } from "./units";
import { wordEditor } from "./words";
import { writingEditor } from "./writing";

/** The edit form of every library type (PRD §13.2), by its address in the panel. */
export const editors = {
  words: wordEditor,
  sentences: sentenceEditor,
  units: unitEditor,
  tables: tableEditor,
  transforms: transformEditor,
  translations: translationEditor,
  texts: textEditor,
  dialogues: dialogueEditor,
  errorfix: errorfixEditor,
  writing: writingEditor,
  phonics: phonicsEditor,
} satisfies Record<LibrarySlug, { load(id: number): Promise<unknown>; save(id: number, raw: unknown, adminId: number): Promise<unknown> }>;

export type Editors = typeof editors;
export type ValuesOf<S extends LibrarySlug> = Awaited<ReturnType<Editors[S]["load"]>> extends infer L ? (L extends { values: infer V } ? V : never) : never;
export type ContextOf<S extends LibrarySlug> = Awaited<ReturnType<Editors[S]["load"]>> extends infer L ? (L extends { context: infer C } ? C : never) : never;

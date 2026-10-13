"use client";

import type { LibrarySlug } from "@/server/content/library/slugs";
import { EditShell } from "./edit-shell";
import { DialogueForm } from "./forms/dialogue-form";
import { ErrorfixForm } from "./forms/errorfix-form";
import { TransformForm, TranslationForm } from "./forms/grammar-item-forms";
import { PhonicsForm } from "./forms/phonics-form";
import { SentenceForm } from "./forms/sentence-form";
import { TableForm } from "./forms/table-form";
import { TextForm } from "./forms/text-form";
import { UnitForm } from "./forms/unit-form";
import { WordForm } from "./forms/word-form";
import { WritingForm } from "./forms/writing-form";

/** The edit form of one item, chosen by its type. Values and context come from the server editor. */
export function ItemForm({
  slug,
  id,
  language,
  values,
  context,
  levels,
  readOnly,
}: {
  slug: LibrarySlug;
  id: number;
  language: string;
  values: unknown;
  context: unknown;
  levels: string[];
  readOnly: boolean;
}) {
  // Each form reads its own context shape; the editor on the server is the single source of both.
  const c = context as never;
  const form = (() => {
    switch (slug) {
      case "words":
        return <WordForm context={c} levels={levels} />;
      case "sentences":
        return <SentenceForm context={c} />;
      case "units":
        return <UnitForm levels={levels} />;
      case "tables":
        return <TableForm context={c} />;
      case "transforms":
        return <TransformForm />;
      case "translations":
        return <TranslationForm context={c} />;
      case "texts":
        return <TextForm context={c} />;
      case "dialogues":
        return <DialogueForm context={c} levels={levels} />;
      case "errorfix":
        return <ErrorfixForm context={c} levels={levels} />;
      case "writing":
        return <WritingForm context={c} levels={levels} />;
      case "phonics":
        return <PhonicsForm context={c} />;
    }
  })();
  return (
    <EditShell slug={slug} id={id} language={language} initial={values as Record<string, unknown>} readOnly={readOnly}>
      {form}
    </EditShell>
  );
}

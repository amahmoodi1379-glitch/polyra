"use client";

import type { TranslationContext } from "@/server/content/library/edit/grammar-items";
import { AreaField, ListField, Section, TextField, useForm } from "../form-kit";
import { TokenTable } from "./token-table";

/** A sentence transformation (PRD §6.4). */
export function TransformForm() {
  return (
    <Section columns={1}>
      <TextField name="instruction_fa" voice="fa" />
      <AreaField name="source_sentence" voice="target" rows={2} />
      <ListField name="accepted_outputs" voice="target" ordered />
    </Section>
  );
}

/** A short translation (PRD §8b.3): the word table belongs to the first accepted answer. */
export function TranslationForm({ context }: { context: TranslationContext }) {
  const { values } = useForm();
  const first = ((values.accepted_outputs as string[] | undefined) ?? [])[0] ?? "";
  return (
    <>
      <Section columns={1}>
        <AreaField name="prompt_fa" voice="fa" rows={2} />
        <ListField name="accepted_outputs" voice="target" ordered />
      </Section>
      <Section columns={1}>
        <TokenTable text={first} words={context.words} label="admin.library.grammarItems.firstOutput" />
      </Section>
    </>
  );
}

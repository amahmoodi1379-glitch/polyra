"use client";

import { formatNumber, t } from "@/i18n";
import type { WritingContext } from "@/server/content/library/edit/writing";
import { AreaField, countWords, ListField, NumberField, PairListField, Section, SegmentedField, levelOptions, useForm } from "../form-kit";

/** A guided writing task (PRD §8b.6). */
export function WritingForm({ context, levels }: { context: WritingContext; levels: string[] }) {
  const { values } = useForm();
  const level = values.level as string;
  const range = context.ranges[level];
  const allowed = levels.filter((item) => item in context.ranges);
  return (
    <>
      <Section>
        <AreaField name="prompt_fa" voice="fa" rows={2} />
        <SegmentedField
          name="level"
          options={levelOptions(allowed.length > 0 ? allowed : levels)}
          after={range ? t("admin.library.writing.range", { level, min: formatNumber(range[0]), max: formatNumber(range[1]) }) : null}
        />
        <div className="flex flex-wrap gap-x-6 gap-y-5">
          <NumberField name="min_words" min={1} />
          <NumberField name="max_words" min={1} />
        </div>
      </Section>
      <Section>
        <ListField name="checklist_fa" voice="fa" ordered />
        <PairListField name="useful_phrases" />
      </Section>
      <Section title={t("admin.library.writing.answer")}>
        <AreaField name="model_answer" voice="target" rows={6} after={t("admin.library.writing.count", { count: formatNumber(countWords(String(values.model_answer ?? ""))) })} />
        <AreaField name="model_answer_fa" voice="fa" rows={5} />
      </Section>
    </>
  );
}

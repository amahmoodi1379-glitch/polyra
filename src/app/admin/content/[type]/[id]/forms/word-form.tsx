"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { FindWord } from "@/components/admin/find-word";
import { t, type MessageKey } from "@/i18n";
import { posValues } from "@/schemas/common";
import type { WordInfo } from "@/server/content/library/edit/shared";
import type { WordContext } from "@/server/content/library/edit/words";
import {
  AddButton,
  AreaField,
  Field,
  ListField,
  PairListField,
  Section,
  SegmentedField,
  SelectField,
  TextField,
  ToggleField,
  levelOptions,
  useField,
  useForm,
  type Option,
} from "../form-kit";

const label = (key: string) => t(key as MessageKey);

/** A word or phrase (PRD §5.1): the card's facts first, then what only some words need. */
export function WordForm({ context, levels }: { context: WordContext; levels: string[] }) {
  const { values } = useForm();
  const pos = values.pos as string;
  const genders: Option[] = context.genders.map((gender) =>
    gender === "m" || gender === "f" || gender === "mf" ? { value: gender, label: label(`admin.library.options.gender.${gender}`) } : { value: gender, label: gender, latin: true },
  );
  const masteryNote = context.masteryManual
    ? t("admin.library.words.masteryManual")
    : context.masterySuggested
      ? t("admin.library.words.masterySuggested", { value: label(`admin.library.options.mastery.${context.masterySuggested}`) })
      : null;

  return (
    <>
      <Section title={t("admin.library.words.main")}>
        <TextField name="lemma" voice="target" />
        <SelectField name="pos" options={posValues.map((value) => ({ value, label: label(`content.pos.${value}`) }))} />
        <TextField name="meaning_fa" voice="fa" nullable />
        <TextField name="concept_fa" voice="fa" nullable />
        <SegmentedField name="level" options={levelOptions(levels)} after={t("admin.library.words.levelMove")} />
        <SegmentedField
          name="mastery"
          options={(["produce", "recognize"] as const).map((value) => ({ value, label: label(`admin.library.options.mastery.${value}`) }))}
          after={masteryNote}
        />
        <SelectField
          name="register"
          options={(["standard", "familier", "argot", "formal"] as const).map((value) => ({ value, label: label(`admin.library.options.register.${value}`) }))}
        />
        <ToggleField name="no_card" />
      </Section>

      {pos === "noun" ? (
        <Section title={t("admin.library.words.noun")}>
          <SegmentedField name="gender" options={genders} />
          <SegmentedField name="number" options={(["sg", "pl_only"] as const).map((value) => ({ value, label: label(`admin.library.options.number.${value}`) }))} />
          <TextField name="plural" voice="target" nullable />
        </Section>
      ) : null}

      <Section title={t("admin.library.words.more")}>
        {pos === "phrase" ? <PartsField initial={context.parts} /> : null}
        <PairListField name="collocations" max={3} />
        <ListField name="homophones" voice="target" />
        <TextField name="family" voice="target" nullable />
        <AreaField name="note_fa" voice="fa" rows={2} nullable />
      </Section>
    </>
  );
}

/** The list words a phrase is made of, chosen by search (PRD §5.1 `parts`). */
function PartsField({ initial }: { initial: Record<string, WordInfo> }) {
  const { language } = useForm();
  const [parts, setParts, errors] = useField<string[]>("parts");
  const [known, setKnown] = useState(initial);
  const [adding, setAdding] = useState(false);
  const list = parts ?? [];
  return (
    <Field name="parts" errors={errors} wide>
      {list.length > 0 ? (
        <ul className="flex flex-wrap gap-2">
          {list.map((code) => {
            const word = known[code];
            return (
              <li key={code} className="border-line-2 flex min-h-10 items-center gap-2 rounded-[12px] border ps-3 pe-1">
                <bdi dir="ltr" lang={language} className="lat text-ink text-[16px] font-semibold">
                  {word?.lemma ?? code}
                </bdi>
                <span className={word ? "text-ink-3 text-[12.5px]" : "text-bad text-[12.5px] font-bold"}>
                  {word ? (word.meaning_fa ?? "") : t("admin.library.words.unknownPart")}
                </span>
                <button
                  type="button"
                  onClick={() => setParts(list.filter((item) => item !== code))}
                  className="text-ink-3 hover:bg-tint hover:text-bad grid size-8 place-items-center rounded-[9px]"
                >
                  <X className="size-3.5" strokeWidth={2} aria-hidden />
                  <span className="sr-only">{t("admin.library.form.remove")}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {adding ? (
        <FindWord
          language={language}
          onPick={(word) => {
            setKnown((current) => ({ ...current, [word.code]: word }));
            if (!list.includes(word.code)) setParts([...list, word.code]);
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <AddButton onClick={() => setAdding(true)} />
      )}
    </Field>
  );
}

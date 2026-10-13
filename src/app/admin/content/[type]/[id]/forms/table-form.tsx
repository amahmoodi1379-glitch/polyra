"use client";

import { Plus } from "lucide-react";
import { t } from "@/i18n";
import type { TableContext } from "@/server/content/library/edit/tables";
import { RowTools, Section, SelectField, TextBox, ToggleField, rowErrors, useField, useForm } from "../form-kit";

/** A conjugation table (PRD §6.6): one form per person, other accepted forms under it. */
export function TableForm({ context }: { context: TableContext }) {
  const { errors, language } = useForm();
  const [forms, setForms] = useField<Record<string, string>>("forms");
  const [variants, setVariants] = useField<Record<string, string[]>>("accepted_variants");
  return (
    <>
      <Section title={t("admin.library.tables.forms")} lead={t("admin.library.tables.variantsLead")} columns={1}>
        <ol className="flex flex-col">
          {context.keys.map((key) => {
            const own = errors.filter((error) => error.path === `forms.${key}`);
            const list = variants[key] ?? [];
            const setList = (next: string[]) => setVariants({ ...variants, [key]: next });
            return (
              <li key={key} data-field="forms" className="border-line grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1.5 border-b py-3 last:border-b-0 sm:grid-cols-[7rem_minmax(0,1fr)]">
                <span dir="ltr" lang={language} className="lat text-ink-2 self-start pt-2.5 text-[16px] sm:text-end">
                  {key.replaceAll("_", " / ")}
                </span>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="flex items-center gap-1">
                    <TextBox value={forms[key] ?? ""} onChange={(next) => setForms({ ...forms, [key]: next })} voice="target" invalid={own.length > 0} />
                    <button
                      type="button"
                      onClick={() => setList([...list, ""])}
                      className="text-brand-text hover:bg-tint flex h-10 shrink-0 items-center gap-1 rounded-[12px] px-2.5 text-[13px] font-bold transition-colors"
                    >
                      <Plus className="size-4" strokeWidth={2} aria-hidden />
                      {t("admin.library.tables.addVariant")}
                    </button>
                  </span>
                  {own.length > 0 ? <span className="text-bad text-[13px] font-bold">{own[0].message}</span> : null}
                  {list.map((item, index) => (
                    <span key={index} className="flex items-center gap-1 ps-5">
                      <TextBox
                        value={item}
                        voice="target"
                        className="h-10 text-[15.5px]"
                        invalid={rowErrors(errors, `accepted_variants.${key}`, index).length > 0}
                        onChange={(next) => setList(list.map((old, k) => (k === index ? next : old)))}
                      />
                      <RowTools index={index} count={list.length} onRemove={(at) => setList(list.filter((_, k) => k !== at))} />
                    </span>
                  ))}
                </div>
              </li>
            );
          })}
        </ol>
      </Section>
      <Section>
        <SelectField name="unit_code" options={context.units.map((unit) => ({ value: unit.unit_code, label: `${unit.level} · ${unit.title_fa}` }))} nullable />
        <ToggleField name="review_card" />
      </Section>
    </>
  );
}

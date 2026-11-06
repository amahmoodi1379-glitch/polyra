"use client";

import { useState } from "react";
import Link from "@/components/admin/link";
import { PenLine, Plus, X } from "lucide-react";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { UnitContext, UnitValues } from "@/server/content/library/edit/units";
import { AddButton, AreaBox, AreaField, Field, RowTools, Section, SegmentedField, TextBox, TextField, levelOptions, move, rowErrors, useField, useForm } from "../form-kit";

const cellLook =
  "bg-surface border-line-2 text-ink h-10 w-full min-w-28 rounded-[10px] border px-2.5 text-[15px] outline-none transition-[border-color,box-shadow] focus-visible:border-brand-soft focus-visible:ring-[3px] focus-visible:ring-ring/30";

/** A grammar unit (PRD §6): titles, the lesson, its examples, build table and category sets. */
export function UnitForm({ context, levels }: { context: UnitContext; levels: string[] }) {
  return (
    <>
      <Section>
        <TextField name="title_fa" voice="fa" wide />
        <SegmentedField name="level" options={levelOptions(levels)} />
        <AreaField name="scope_fa" voice="fa" rows={2} nullable />
        <AreaField name="can_do_fa" voice="fa" rows={2} nullable />
      </Section>
      <Section title={t("admin.library.units.lesson")} lead={t("admin.library.units.lessonTogether")} columns={1}>
        <AreaField name="lesson_fa" voice="fa" rows={8} nullable />
        <TextField name="rule_line_fa" voice="fa" nullable />
        <AreaField name="common_mistake_fa" voice="fa" rows={2} nullable />
      </Section>
      <Section title={t("admin.library.units.examples")} lead={t("admin.library.units.examplesLead")} columns={1}>
        <Examples context={context} />
      </Section>
      <Section title={t("admin.library.units.table")} lead={t("admin.library.units.tableLead")} columns={1}>
        <BuildTable />
      </Section>
      <Section title={t("admin.library.units.sets")} lead={t("admin.library.units.setsLead")} columns={1}>
        <CategorySets />
      </Section>
    </>
  );
}

/** PRD §6: 3 to 4 examples, put in order, taken out or added from the unit's practice sentences. */
const MAX_EXAMPLES = 4;

function Examples({ context }: { context: UnitContext }) {
  const { language } = useForm();
  const [ids, setIds, errors] = useField<number[]>("example_sentence_ids");
  const [adding, setAdding] = useState(false);
  const list = ids ?? [];
  const lines = new Map(context.sentences.map((sentence) => [sentence.id, sentence]));
  const choices = context.practice.filter((id) => !list.includes(id));
  const line = (id: number) => {
    const sentence = lines.get(id);
    return (
      <span className="flex min-w-0 flex-1 flex-col">
        <span dir="ltr" lang={language} className="lat text-ink self-start text-[17px] leading-snug">
          {sentence?.text ?? formatNumber(id)}
        </span>
        {sentence ? <span className="text-ink-3 text-[13px] leading-6">{sentence.translation_fa}</span> : null}
      </span>
    );
  };
  return (
    <Field name="example_sentence_ids" label="admin.library.units.examples" help={null} hideLabel errors={errors} wide>
      {list.length > 0 ? (
        <ol className="flex flex-col">
          {list.map((id, index) => (
            <li key={id} className="border-line flex items-start gap-3 border-b py-3 last:border-b-0">
              <span className="text-ink-3 w-5 shrink-0 pt-1 text-center text-[12.5px] tabular-nums">{formatNumber(index + 1)}</span>
              {line(id)}
              <Link
                href={`/admin/content/sentences/${id}`}
                className="text-ink-3 hover:bg-tint hover:text-ink grid size-9 shrink-0 place-items-center rounded-[10px] transition-colors"
              >
                <PenLine className="size-4" strokeWidth={1.75} aria-hidden />
                <span className="sr-only">{t("admin.library.units.openExample")}</span>
              </Link>
              <RowTools index={index} count={list.length} onMove={(from, to) => setIds(move(list, from, to))} onRemove={(at) => setIds(list.filter((_, k) => k !== at))} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-ink-3 text-[14px]">{t("admin.library.units.noExamples")}</p>
      )}
      {list.length >= MAX_EXAMPLES ? null : choices.length === 0 ? (
        <p className="text-ink-3 text-[13px] leading-6">{t("admin.library.units.noPractice")}</p>
      ) : adding ? (
        <div className="border-line-2 flex flex-col rounded-[16px] border">
          <div className="flex items-center justify-between gap-3 ps-4 pe-1.5 pt-1.5">
            <span className="text-ink text-[13.5px] font-bold">{t("admin.library.units.pickExample")}</span>
            <button type="button" onClick={() => setAdding(false)} className="text-ink-3 hover:bg-tint hover:text-ink grid size-9 place-items-center rounded-[10px]">
              <X className="size-4" strokeWidth={2} aria-hidden />
              <span className="sr-only">{t("admin.library.cancel")}</span>
            </button>
          </div>
          <ul className="flex max-h-80 flex-col overflow-y-auto px-1.5 pb-1.5">
            {choices.map((id) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => {
                    setIds([...list, id]);
                    setAdding(false);
                  }}
                  className="hover:bg-tint flex w-full items-start gap-3 rounded-[12px] px-2.5 py-2.5 text-start transition-colors"
                >
                  <Plus className="text-brand-text mt-1 size-4 shrink-0" strokeWidth={2} aria-hidden />
                  {line(id)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <AddButton onClick={() => setAdding(true)} label={t("admin.library.units.addExample")} />
      )}
    </Field>
  );
}

function BuildTable() {
  const [table, setTable, errors] = useField<string[][] | null>("build_table");
  if (!table || table.length === 0) {
    return (
      <div data-field="build_table">
        <AddButton onClick={() => setTable([["", ""], ["", ""]])} label={t("admin.library.units.makeTable")} />
      </div>
    );
  }
  const columns = Math.max(...table.map((row) => row.length));
  const rows = table.map((row) => Array.from({ length: columns }, (_, k) => row[k] ?? ""));
  const setCell = (r: number, c: number, value: string) => setTable(rows.map((row, i) => (i === r ? row.map((cell, k) => (k === c ? value : cell)) : row)));
  const removeColumn = (c: number) => {
    const next = rows.map((row) => row.filter((_, k) => k !== c));
    setTable(next[0]?.length ? next : null);
  };
  return (
    <div data-field="build_table" className="flex flex-col gap-2">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <table className="border-separate border-spacing-1.5">
          <thead>
            <tr>
              {Array.from({ length: columns }, (_, c) => (
                <th key={c} className="p-0">
                  <button
                    type="button"
                    onClick={() => removeColumn(c)}
                    className="text-ink-3 hover:bg-tint hover:text-bad mx-auto grid size-7 place-items-center rounded-[8px]"
                  >
                    <X className="size-3.5" strokeWidth={2} aria-hidden />
                    <span className="sr-only">{t("admin.library.units.removeColumn", { n: c + 1 })}</span>
                  </button>
                </th>
              ))}
              <th className="p-0" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c} className="p-0">
                    <input
                      value={cell}
                      dir="auto"
                      aria-label={t("admin.library.units.cell", { row: r + 1, column: c + 1 })}
                      onChange={(event) => setCell(r, c, event.target.value)}
                      className={cn(cellLook, r === 0 && "bg-tint border-transparent font-bold")}
                    />
                  </td>
                ))}
                <td className="p-0">
                  <RowTools index={r} count={rows.length} onRemove={(at) => setTable(rows.length > 1 ? rows.filter((_, i) => i !== at) : null)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-1">
        <AddButton onClick={() => setTable([...rows, Array.from({ length: columns }, () => "")])} label={t("admin.library.units.addRow")} />
        <button
          type="button"
          onClick={() => setTable(rows.map((row) => [...row, ""]))}
          className="text-brand-text hover:bg-tint flex h-10 w-fit items-center gap-1.5 rounded-[12px] px-3 text-[13.5px] font-bold transition-colors"
        >
          <Plus className="size-4" strokeWidth={2} aria-hidden />
          {t("admin.library.units.addColumn")}
        </button>
      </div>
      {errors.length > 0 ? <p className="text-bad text-[13px] font-bold">{errors[0].message}</p> : null}
    </div>
  );
}

function CategorySets() {
  const [sets, setSets, errors] = useField<UnitValues["category_sets"]>("category_sets");
  const list = sets ?? [];
  const update = (index: number, patch: Partial<NonNullable<UnitValues["category_sets"]>[number]>) =>
    setSets(list.map((set, k) => (k === index ? { ...set, ...patch } : set)));
  return (
    <Field name="category_sets" label="admin.library.units.sets" help={null} hideLabel errors={errors.filter((error) => error.path === "category_sets")} wide>
      <ol className="flex flex-col gap-3">
        {list.map((set, index) => {
          const own = rowErrors(errors, "category_sets", index);
          return (
            <li key={index} className="border-line flex flex-col gap-2 rounded-[16px] border p-3">
              <span className="flex items-center gap-1.5">
                <TextBox
                  value={set.name}
                  onChange={(next) => update(index, { name: next })}
                  voice="fa"
                  placeholder={t("admin.library.units.setName")}
                  invalid={own.some((error) => error.path.endsWith(".name"))}
                />
                <RowTools index={index} count={list.length} onRemove={(at) => setSets(list.filter((_, k) => k !== at))} />
              </span>
              <AreaBox
                value={set.items.join("\n")}
                onChange={(next) => update(index, { items: next.split("\n") })}
                voice="target"
                rows={2}
                invalid={own.some((error) => error.path.endsWith(".items"))}
              />
              <span className="text-ink-3 text-[12.5px]">{t("admin.library.units.setItems")}</span>
              {own.length > 0 ? <span className="text-bad text-[13px] font-bold">{own[0].message}</span> : null}
            </li>
          );
        })}
      </ol>
      <AddButton onClick={() => setSets([...list, { name: "", items: [] }])} label={t("admin.library.units.addSet")} />
    </Field>
  );
}

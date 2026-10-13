"use client";

import { Plus, X } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { UnitValues } from "@/server/content/library/edit/units";
import { AddButton, AreaBox, AreaField, Field, RowTools, Section, SegmentedField, TextBox, TextField, levelOptions, rowErrors, useField } from "../form-kit";

const cellLook =
  "bg-surface border-line-2 text-ink h-10 w-full min-w-28 rounded-[10px] border px-2.5 text-[15px] outline-none transition-[border-color,box-shadow] focus-visible:border-brand-soft focus-visible:ring-[3px] focus-visible:ring-ring/30";

/** A grammar unit (PRD §6): titles, the lesson, its build table and category sets. */
export function UnitForm({ levels }: { levels: string[] }) {
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
      <Section title={t("admin.library.units.table")} lead={t("admin.library.units.tableLead")} columns={1}>
        <BuildTable />
      </Section>
      <Section title={t("admin.library.units.sets")} lead={t("admin.library.units.setsLead")} columns={1}>
        <CategorySets />
      </Section>
    </>
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

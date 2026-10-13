"use client";

import Link from "next/link";
import { Archive, Undo2 } from "lucide-react";
import { Voiced } from "@/components/admin/voiced";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { SentenceContext, TargetEdit } from "@/server/content/library/edit/sentences";
import { AddButton, AreaField, Field, RowTools, Section, TextBox, TextField, rowErrors, useField, useForm } from "../form-kit";
import { TokenTable } from "./token-table";

/** A sentence (PRD §13.7): text, spoken form, translation, its word table and its fill-in targets. */
export function SentenceForm({ context }: { context: SentenceContext }) {
  const { values } = useForm();
  const inTexts = context.uses.some((use) => use.type === "texts");
  return (
    <>
      <Section title={t("admin.library.sentences.main")} columns={1}>
        <AreaField name="text" voice="target" rows={2} after={inTexts ? t("admin.library.sentences.inText") : null} />
        <TextField name="tts_text" voice="target" nullable />
        <AreaField name="translation_fa" voice="fa" rows={2} />
      </Section>
      <Section columns={1}>
        <TokenTable text={String(values.text ?? "")} words={context.words} />
      </Section>
      <Section title={t("admin.library.targets.title")} lead={t("admin.library.targets.lead")} columns={1}>
        <Targets context={context} />
      </Section>
    </>
  );
}

function Targets({ context }: { context: SentenceContext }) {
  const { language } = useForm();
  const [targets, setTargets, errors] = useField<TargetEdit[]>("targets");
  const list = targets ?? [];
  if (list.length === 0) return <p className="text-ink-3 text-[13.5px]">{t("admin.library.targets.none")}</p>;
  const update = (index: number, patch: Partial<TargetEdit>) => setTargets(list.map((target, k) => (k === index ? { ...target, ...patch } : target)));

  return (
    <ol className="flex flex-col gap-4" data-field="targets">
      {list.map((target, index) => {
        const info = context.targets.find((item) => item.id === target.id);
        const own = rowErrors(errors, "targets", index);
        const at = (field: string) => own.filter((error) => error.path === `targets[${index}].${field}` || error.path.startsWith(`targets[${index}].${field}[`));
        const blanks = info?.blanks ?? target.accepted.length;
        return (
          <li key={target.id} className={cn("border-line flex flex-col gap-4 rounded-[18px] border p-4 transition-opacity", target.retire && "border-dashed")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="text-ink-3 text-[12.5px] font-bold">{t(`admin.library.targets.${info?.type ?? "word"}`)}</span>
                {info?.href ? (
                  <Link href={info.href} className="hover:text-brand-text min-w-0 transition-colors">
                    <Voiced text={info.name} voice={info.nameVoice} language={language} className={info.nameVoice === "target" ? "text-[17px]" : "text-[14px] font-bold"} />
                  </Link>
                ) : (
                  <span>{info?.name ?? "—"}</span>
                )}
              </span>
              <button
                type="button"
                onClick={() => update(index, { retire: !target.retire })}
                className={cn(
                  "flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-bold transition-colors",
                  target.retire ? "bg-tint text-ink" : "text-ink-3 hover:bg-tint hover:text-bad",
                )}
              >
                {target.retire ? <Undo2 className="size-4" strokeWidth={1.75} aria-hidden /> : <Archive className="size-4" strokeWidth={1.75} aria-hidden />}
                {target.retire ? t("admin.library.targets.keep") : t("admin.library.targets.retire")}
              </button>
            </div>

            {target.retire ? (
              <p className="text-ink-3 text-[13.5px]">{t("admin.library.targets.retiring")}</p>
            ) : (
              <>
                <Field name={`targets[${index}].marked_text`} label="content.fields.marked_text" help={null} errors={at("marked_text")} wide>
                  <TextBox value={target.marked_text} onChange={(next) => update(index, { marked_text: next })} voice="target" invalid={at("marked_text").length > 0} />
                </Field>
                {Array.from({ length: blanks }, (_, blank) => (
                  <div key={blank} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <StringList
                      title={blanks > 1 ? `${t("content.fields.accepted")} · ${t("admin.library.targets.blank", { n: blank + 1 })}` : t("content.fields.accepted")}
                      items={target.accepted[blank] ?? []}
                      onChange={(next) => update(index, { accepted: Array.from({ length: blanks }, (_, k) => (k === blank ? next : (target.accepted[k] ?? []))) })}
                      errors={at("accepted")}
                    />
                    <StringList
                      title={blanks > 1 ? `${t("content.fields.distractors")} · ${t("admin.library.targets.blank", { n: blank + 1 })}` : t("content.fields.distractors")}
                      items={target.distractors[blank] ?? []}
                      onChange={(next) => update(index, { distractors: Array.from({ length: blanks }, (_, k) => (k === blank ? next : (target.distractors[k] ?? []))) })}
                      errors={at("distractors")}
                      max={3}
                    />
                  </div>
                ))}
                <Field name={`targets[${index}].hint`} label="content.fields.hint" help={null} errors={at("hint")} wide>
                  <TextBox value={target.hint ?? ""} onChange={(next) => update(index, { hint: next || null })} voice="fa" />
                </Field>
                {target.accepted_full.length > 0 ? (
                  <StringList title={t("content.fields.accepted_full")} items={target.accepted_full} onChange={(next) => update(index, { accepted_full: next })} errors={at("accepted_full")} />
                ) : null}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StringList({
  title,
  items,
  onChange,
  errors,
  max,
}: {
  title: string;
  items: string[];
  onChange: (next: string[]) => void;
  errors: { message: string }[];
  max?: number;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-ink text-[13px] font-bold">{title}</span>
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-1">
          <TextBox value={item} onChange={(next) => onChange(items.map((old, k) => (k === index ? next : old)))} voice="target" className="h-10 text-[16px]" invalid={errors.length > 0} />
          <RowTools index={index} count={items.length} onRemove={(at) => onChange(items.filter((_, k) => k !== at))} />
        </span>
      ))}
      {max === undefined || items.length < max ? <AddButton onClick={() => onChange([...items, ""])} /> : null}
      {errors.length > 0 ? <span className="text-bad text-[13px] font-bold">{[...new Set(errors.map((error) => error.message))].join(" ")}</span> : null}
    </div>
  );
}

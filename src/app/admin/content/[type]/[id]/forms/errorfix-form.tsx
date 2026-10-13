"use client";

import { Fragment, useId } from "react";
import { ArrowLeft } from "lucide-react";
import { t } from "@/i18n";
import type { ErrorfixContext, ErrorfixValues } from "@/server/content/library/edit/errorfix";
import { AreaBox, AreaField, ChipToggles, Field, Section, SegmentedField, levelOptions, rowErrors, useField, useForm } from "../form-kit";
import { TokenTable } from "./token-table";

const markPattern = /\{\{([^{}|]*)\|([^{}|]*)\}\}/g;
type Part = { text: string; mark?: { wrong: string; right: string } };

function partsOf(marked: string): Part[] {
  const parts: Part[] = [];
  let at = 0;
  for (const match of marked.matchAll(markPattern)) {
    if (match.index > at) parts.push({ text: marked.slice(at, match.index) });
    parts.push({ text: match[0], mark: { wrong: match[1].trim(), right: match[2].trim() } });
    at = match.index + match[0].length;
  }
  if (at < marked.length) parts.push({ text: marked.slice(at) });
  return parts;
}

/** A find-the-mistake text (PRD §8b.5): marks, one reason per mark, and the corrected text's words. */
export function ErrorfixForm({ context, levels }: { context: ErrorfixContext; levels: string[] }) {
  const { values } = useForm();
  const marked = String(values.marked_text ?? "");
  const parts = partsOf(marked);
  const corrected = parts.map((part) => (part.mark ? part.mark.right : part.text)).join("");
  const level = values.level as string;
  const chosen = (values.unit_codes as string[]) ?? [];
  const units = context.units.filter((unit) => unit.level === level || chosen.includes(unit.unit_code));
  const [, setCodes, codeErrors] = useField<string[]>("unit_codes");

  return (
    <>
      <Section columns={1}>
        <MarkedText parts={parts} />
        <Marks parts={parts} />
      </Section>
      <Section>
        <AreaField name="translation_fa" voice="fa" rows={2} />
        <SegmentedField name="level" options={levelOptions(levels.filter((item) => item === "B1" || item === "B2"))} />
        <Field name="unit_codes" errors={codeErrors} wide>
          <ChipToggles
            options={units.map((unit) => ({ value: unit.unit_code, label: unit.title_fa, sub: unit.level === level ? undefined : unit.level }))}
            selected={chosen}
            onChange={setCodes}
            label={t("content.fields.unit_codes")}
          />
        </Field>
      </Section>
      <Section columns={1}>
        <TokenTable text={corrected} words={context.words} />
      </Section>
    </>
  );
}

function MarkedText({ parts }: { parts: Part[] }) {
  const { language } = useForm();
  const [value, setValue, errors] = useField<string>("marked_text");
  const [why, setWhy] = useField<ErrorfixValues["errors"]>("errors");
  const id = useId();
  const change = (next: string) => {
    setValue(next);
    // One reason per mark: the list follows the marks, keeping what was written for each place.
    const count = [...next.matchAll(markPattern)].length;
    const list = why ?? [];
    if (count !== list.length) setWhy(Array.from({ length: count }, (_, k) => list[k] ?? { why_fa: "" }));
  };
  const marks = parts.filter((part) => part.mark).length;
  return (
    <Field name="marked_text" label="admin.library.errorfix.markedText" errors={errors} wide htmlFor={id}>
      <AreaBox id={id} value={value ?? ""} onChange={change} voice="target" rows={3} invalid={errors.length > 0} />
      {marks > 0 ? (
        <div className="bg-tint/60 flex flex-col gap-3 rounded-[16px] px-4 py-3.5">
          <div className="flex flex-col gap-1">
            <span className="text-ink-3 text-[12.5px] font-bold">{t("admin.library.errorfix.preview")}</span>
            <p dir="ltr" lang={language} className="lat text-ink text-[18px] leading-8">
              {parts.map((part, index) =>
                part.mark ? (
                  <span key={index} className="decoration-bad/70 underline decoration-dotted decoration-2 underline-offset-[6px]">
                    {part.mark.wrong}
                  </span>
                ) : (
                  <Fragment key={index}>{part.text}</Fragment>
                ),
              )}
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-ink-3 text-[12.5px] font-bold">{t("admin.library.errorfix.corrected")}</span>
            <p dir="ltr" lang={language} className="lat text-ink-2 text-[16px] leading-7">
              {parts.map((part, index) =>
                part.mark ? (
                  <span key={index} className="text-ok font-semibold">
                    {part.mark.right}
                  </span>
                ) : (
                  <Fragment key={index}>{part.text}</Fragment>
                ),
              )}
            </p>
          </div>
        </div>
      ) : null}
    </Field>
  );
}

function Marks({ parts }: { parts: Part[] }) {
  const { language } = useForm();
  const [why, setWhy, errors] = useField<ErrorfixValues["errors"]>("errors");
  const marks = parts.flatMap((part) => (part.mark ? [part.mark] : []));
  const list = why ?? [];
  return (
    <Field name="errors" label="admin.library.errorfix.marks" help={t("admin.library.errorfix.marksLead")} errors={errors.filter((error) => error.path === "errors")} wide>
      {marks.length === 0 ? (
        <p className="text-ink-3 text-[13.5px]">{t("admin.library.errorfix.noMarks")}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {marks.map((mark, index) => {
            const own = rowErrors(errors, "errors", index);
            return (
              <li key={index} className="flex flex-col gap-1.5">
                <span dir="ltr" lang={language} className="lat flex w-fit items-center gap-2 text-[16px]">
                  <span className="text-bad decoration-bad/50 line-through">{mark.wrong || "—"}</span>
                  <ArrowLeft className="text-ink-3 size-4 rotate-180" strokeWidth={2} aria-hidden />
                  <span className="text-ok font-semibold">{mark.right || "—"}</span>
                </span>
                <AreaBox
                  value={list[index]?.why_fa ?? ""}
                  onChange={(next) => setWhy(Array.from({ length: marks.length }, (_, k) => (k === index ? { why_fa: next } : (list[k] ?? { why_fa: "" }))))}
                  voice="fa"
                  rows={2}
                 
                  invalid={own.length > 0}
                />
                {own.length > 0 ? <span className="text-bad text-[13px] font-bold">{own[0].message}</span> : null}
              </li>
            );
          })}
        </ol>
      )}
    </Field>
  );
}

"use client";

import Link from "next/link";
import { Check, PenLine } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { DialogueContext, DialogueSentence, DialogueValues } from "@/server/content/library/edit/dialogues";
import { AreaBox, Field, Section, SegmentedField, TextBox, TextField, levelOptions, rowErrors, useField, useForm } from "../form-kit";

/** A situational dialogue (PRD §8b.4): per turn the speaker, the right choice and why. */
export function DialogueForm({ context, levels }: { context: DialogueContext; levels: string[] }) {
  return (
    <>
      <Section>
        <TextField name="title_fa" voice="fa" />
        <SegmentedField name="level" options={levelOptions(levels)} />
        <TextField name="situation_fa" voice="fa" wide />
      </Section>
      <Section title={t("content.fields.turns")} lead={t("admin.library.dialogues.turnsLead")} columns={1}>
        <Turns context={context} />
      </Section>
    </>
  );
}

function SentenceLine({ sentence, className }: { sentence: DialogueSentence | null; className?: string }) {
  const { language } = useForm();
  if (!sentence) return <span className="text-bad text-[13px] font-bold">{t("admin.library.dialogues.missingSentence")}</span>;
  return (
    <span className={cn("flex min-w-0 flex-col", className)}>
      <span dir="ltr" lang={language} className="lat text-ink self-start text-[17px] leading-snug">
        {sentence.text}
      </span>
      <span className="text-ink-3 text-[13px] leading-6">{sentence.translation_fa}</span>
    </span>
  );
}

function EditLink({ sentence }: { sentence: DialogueSentence | null }) {
  if (!sentence) return null;
  return (
    <Link
      href={`/admin/content/sentences/${sentence.id}`}
      className="text-ink-3 hover:bg-tint hover:text-ink grid size-9 shrink-0 place-items-center rounded-[10px] transition-colors"
    >
      <PenLine className="size-4" strokeWidth={1.75} aria-hidden />
      <span className="sr-only">{t("admin.library.tokens.change")}</span>
    </Link>
  );
}

function Turns({ context }: { context: DialogueContext }) {
  const [turns, setTurns, errors] = useField<DialogueValues["turns"]>("turns");
  const list = turns ?? [];
  const update = (index: number, patch: Partial<DialogueValues["turns"][number]>) => setTurns(list.map((turn, k) => (k === index ? { ...turn, ...patch } : turn)));
  return (
    <Field name="turns" label="content.fields.turns" help={null} hideLabel errors={errors.filter((error) => error.path === "turns")} wide>
      <ol className="flex flex-col gap-4">
        {list.map((turn, index) => {
          const shown = context.turns[index];
          const own = rowErrors(errors, "turns", index);
          return (
            <li key={index} className="border-line flex flex-col gap-4 rounded-[18px] border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="text-ink text-[14px] font-extrabold">{t("content.turnItem", { n: index + 1 })}</h3>
                <label className="flex items-center gap-2">
                  <span className="text-ink-3 text-[13px] font-bold">{t("content.fields.speaker")}</span>
                  <TextBox value={turn.speaker ?? ""} onChange={(next) => update(index, { speaker: next || null })} voice="target" className="h-9 w-40 text-[15px]" />
                </label>
              </div>

              <div className="flex items-start gap-2">
                <span className="text-ink-3 w-24 shrink-0 pt-1 text-[12.5px] font-bold">{t("admin.library.dialogues.line")}</span>
                <SentenceLine sentence={shown?.line ?? null} className="flex-1" />
                <EditLink sentence={shown?.line ?? null} />
              </div>

              <div role="radiogroup" aria-label={t("admin.library.dialogues.correct")} className="flex flex-col gap-1.5">
                <span className="text-ink-3 text-[12.5px] font-bold">{t("admin.library.dialogues.choices")}</span>
                {(shown?.choices ?? []).map((choice, k) => {
                  const right = turn.correct === k;
                  return (
                    <div key={k} className="flex items-center gap-1">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={right}
                        onClick={() => update(index, { correct: k })}
                        className={cn(
                          "flex min-w-0 flex-1 items-center gap-3 rounded-[14px] border px-3 py-2.5 text-start transition-[border-color,background-color] duration-150",
                          right ? "border-ok bg-ok-soft" : "border-line-2 hover:border-ink-3",
                        )}
                      >
                        <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border-2", right ? "border-ok bg-ok text-surface" : "border-line-2")}>
                          {right ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : null}
                        </span>
                        <SentenceLine sentence={choice} />
                      </button>
                      <EditLink sentence={choice} />
                    </div>
                  );
                })}
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-ink-3 text-[12.5px] font-bold">{t("content.fields.why_fa")}</span>
                <AreaBox value={turn.why_fa} onChange={(next) => update(index, { why_fa: next })} voice="fa" rows={2} invalid={own.length > 0} />
              </label>
              {own.length > 0 ? <span className="text-bad text-[13px] font-bold">{own[0].message}</span> : null}
            </li>
          );
        })}
      </ol>
    </Field>
  );
}

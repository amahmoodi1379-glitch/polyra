"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { Check, CircleDashed, PenLine } from "lucide-react";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { QuestionRecord } from "@/schemas/texts";
import type { QuestionEdit, QuestionSets, TextContext } from "@/server/content/library/edit/texts";
import type { FieldError } from "@/server/content/library/edit/types";
import {
  AddButton,
  AreaBox,
  ChipToggles,
  Field,
  RowTools,
  Section,
  Segmented,
  SelectBox,
  TextBox,
  TextField,
  ToggleField,
  move,
  useField,
  useForm,
  type Voice,
} from "../form-kit";

type Track = "reading" | "listening";
type SetName = "A" | "B";
type QuestionType = QuestionRecord["type"];

/** A text (PRD §7): its sentences and speakers, key words, and the four question sets. */
export function TextForm({ context }: { context: TextContext }) {
  return (
    <>
      <Section>
        <TextField name="title" voice="target" wide />
        <ToggleField name="placement_ok" wide />
      </Section>
      <Section title={t("admin.library.texts.sentences")} lead={t("admin.library.texts.sentencesLead")} columns={1}>
        <Sentences context={context} />
      </Section>
      <Section title={t("admin.library.texts.keyWords")} lead={t("admin.library.texts.keyWordsLead")} columns={1}>
        <KeyWords context={context} />
      </Section>
      <Section title={t("admin.library.texts.questions")} columns={1}>
        <Questions context={context} />
      </Section>
    </>
  );
}

function Sentences({ context }: { context: TextContext }) {
  const { language } = useForm();
  const [speakers, setSpeakers, errors] = useField<(string | null)[] | null>("speakers");
  return (
    <ol className="flex flex-col" data-field="speakers">
      {context.sentences.map((sentence, index) => {
        const own = errors.filter((error) => error.path === `speakers[${index}]`);
        return (
          <li key={sentence.id} className="border-line flex items-start gap-3 border-b py-3 last:border-b-0">
            <span className="text-ink-3 w-5 shrink-0 pt-1 text-center text-[12.5px] tabular-nums">{formatNumber(index + 1)}</span>
            {context.hasSpeakers ? (
              <TextBox
                value={speakers?.[index] ?? ""}
                onChange={(next) => setSpeakers((speakers ?? context.sentences.map(() => null)).map((old, k) => (k === index ? next || null : old)))}
                voice="target"
                placeholder={t("content.fields.speaker")}
                invalid={own.length > 0}
                className="h-9 w-28 shrink-0 text-[15px]"
              />
            ) : null}
            <span className="flex min-w-0 flex-1 flex-col">
              <span dir="ltr" lang={language} className="lat text-ink self-start text-[17px] leading-snug">
                {sentence.text}
              </span>
              <span className="text-ink-3 text-[13px] leading-6">{sentence.translation_fa}</span>
              {sentence.open > 0 ? (
                <span className="text-brand-text mt-0.5 flex items-center gap-1 text-[12.5px] font-bold">
                  <CircleDashed className="size-3.5" strokeWidth={2} aria-hidden />
                  {t("admin.library.texts.openItems", { count: formatNumber(sentence.open) })}
                </span>
              ) : null}
            </span>
            <Link
              href={`/admin/content/sentences/${sentence.id}`}
              className="text-ink-3 hover:bg-tint hover:text-ink grid size-9 shrink-0 place-items-center rounded-[10px] transition-colors"
            >
              <PenLine className="size-4" strokeWidth={1.75} aria-hidden />
              <span className="sr-only">{t("admin.library.tokens.change")}</span>
            </Link>
          </li>
        );
      })}
      {errors.filter((error) => error.path === "speakers").map((error) => (
        <li key={error.message} className="text-bad pt-2 text-[13px] font-bold">
          {error.message}
        </li>
      ))}
    </ol>
  );
}

function KeyWords({ context }: { context: TextContext }) {
  const [codes, setCodes, errors] = useField<string[]>("key_words");
  const list = codes ?? [];
  return (
    <Field name="key_words" errors={errors} help={null} hideLabel wide after={t("admin.library.texts.keyWordsCount", { count: formatNumber(list.length) })}>
      <ChipToggles
        options={context.textWords.map((word) => ({ value: word.code, label: word.lemma, latin: true, sub: word.meaning_fa ?? undefined }))}
        selected={list}
        onChange={setCodes}
        max={5}
        label={t("admin.library.texts.keyWords")}
      />
    </Field>
  );
}

/** A blank question of a type, keeping what carries over (prompt, Persian prompt, explanation). */
function blank(type: QuestionType, from?: Partial<QuestionEdit>): QuestionEdit {
  const keep = { id: from?.id ?? null, explanation_fa: from?.explanation_fa ?? null, prompt_fa: from?.prompt_fa ?? null };
  const prompt = (from && "prompt" in from ? from.prompt : "") ?? "";
  switch (type) {
    case "mcq":
      return { ...keep, type, prompt, options: ["", "", "", ""], correct: 0 };
    case "ctx":
      return { ...keep, type, word: "", prompt, options: ["", "", "", ""], correct: 0 };
    case "tf":
      return { ...keep, type, prompt, correct: true };
    case "order":
      return { ...keep, type, prompt, items: ["", "", "", ""], correct_order: [0, 1, 2, 3] };
    case "match":
      return { ...keep, type, prompt, left: ["", ""], right: ["", ""], pairs: [[0, 0], [1, 1]] };
    case "cloze":
      return { ...keep, type, prompt, text_with_gaps: "", bank: [""], answers: [""] };
    case "find":
      return { ...keep, type, prompt, correct_sentence: 0 };
    case "num":
      return { ...keep, type, prompt, answer: "", accepted: [""] };
    case "dict":
      return { ...keep, type, sentence: 0 };
  }
}

function Questions({ context }: { context: TextContext }) {
  const [sets, setSets, errors] = useField<QuestionSets>("question_sets");
  const [track, setTrack] = useState<Track>("reading");
  const counts = (name: Track) => errors.filter((error) => error.path.startsWith(`question_sets.${name}`)).length;
  return (
    <div className="flex flex-col gap-5" data-field="question_sets">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={track}
          onChange={(next) => setTrack(next as Track)}
          label={t("admin.library.texts.questions")}
          options={(["reading", "listening"] as const).map((name) => ({
            value: name,
            label: counts(name) > 0 ? `${t(`content.tracks.${name}`)} (${formatNumber(counts(name))})` : t(`content.tracks.${name}`),
          }))}
        />
      </div>
      {(["A", "B"] as const).map((set) => (
        <QuestionSet
          key={`${track}-${set}`}
          track={track}
          set={set}
          list={sets[track][set]}
          onChange={(next) => setSets({ ...sets, [track]: { ...sets[track], [set]: next } })}
          errors={errors}
          context={context}
        />
      ))}
    </div>
  );
}

function QuestionSet({
  track,
  set,
  list,
  onChange,
  errors,
  context,
}: {
  track: Track;
  set: SetName;
  list: QuestionEdit[];
  onChange: (next: QuestionEdit[]) => void;
  errors: FieldError[];
  context: TextContext;
}) {
  const base = `question_sets.${track}.${set}`;
  const [min, max] = context.ranges[track][set];
  const own = errors.filter((error) => error.path === base);
  const allowed = context.allowed[track];
  const outOfRange = list.length < min || list.length > max;
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-ink text-[15px] font-extrabold">{t("content.questionSet", { set, track: t(`content.tracks.${track}`) })}</h3>
        <span className={cn("text-[13px] tabular-nums", outOfRange ? "text-bad font-bold" : "text-ink-3")}>
          {t("admin.library.texts.setRange", { count: formatNumber(list.length), min: formatNumber(min), max: formatNumber(max) })}
        </span>
      </header>
      {own.map((error) => (
        <p key={error.message} className="text-bad text-[13px] font-bold">
          {error.message}
        </p>
      ))}
      <ol className="flex flex-col gap-3">
        {list.map((question, index) => (
          <QuestionCard
            key={`${question.id ?? "new"}-${index}`}
            question={question}
            index={index}
            count={list.length}
            allowed={allowed}
            band={context.band}
            sentences={context.sentences.map((sentence) => sentence.text)}
            errors={errors.filter((error) => error.path === `${base}[${index}]` || error.path.startsWith(`${base}[${index}].`))}
            path={`${base}[${index}]`}
            onChange={(next) => onChange(list.map((item, k) => (k === index ? next : item)))}
            onMove={(from, to) => onChange(move(list, from, to))}
            onRemove={(at) => onChange(list.filter((_, k) => k !== at))}
          />
        ))}
      </ol>
      {list.length < max ? <AddButton onClick={() => onChange([...list, blank(allowed[0])])} label={t("admin.library.texts.addQuestion")} /> : null}
    </section>
  );
}

type CardProps = {
  question: QuestionEdit;
  index: number;
  count: number;
  allowed: QuestionType[];
  band: number;
  sentences: string[];
  errors: FieldError[];
  path: string;
  onChange: (next: QuestionEdit) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (at: number) => void;
};

function QuestionCard({ question, index, count, allowed, band, sentences, errors, path, onChange, onMove, onRemove }: CardProps) {
  // Bands 1 and 2 ask in Persian; from band 3 the question is in the language and has a Persian prompt (§7.3).
  const voice: Voice = band >= 3 ? "target" : "fa";
  const set = (patch: Record<string, unknown>) => onChange({ ...question, ...patch } as QuestionEdit);
  const at = (field: string) => errors.filter((error) => error.path === `${path}.${field}` || error.path.startsWith(`${path}.${field}[`));
  const general = errors.filter((error) => error.path === path);
  const types = allowed.includes(question.type) ? allowed : [question.type, ...allowed];

  return (
    <li className={cn("border-line flex flex-col gap-4 rounded-[18px] border p-4", errors.length > 0 && "border-bad/50")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ink text-[14px] font-extrabold tabular-nums">{t("admin.library.texts.question", { n: formatNumber(index + 1) })}</span>
        <SelectBox
          value={question.type}
          onChange={(next) => onChange(blank(next as QuestionType, question))}
          options={types.map((type) => ({ value: type, label: t(`admin.library.options.questionType.${type}`) }))}
          label={t("admin.library.texts.type")}
          className="w-44 [&_select]:h-10"
        />
        <span className="ms-auto">
          <RowTools index={index} count={count} onMove={onMove} onRemove={onRemove} />
        </span>
      </div>
      {general.map((error) => (
        <p key={error.message} className="text-bad text-[13px] font-bold">
          {error.message}
        </p>
      ))}

      {question.type === "ctx" ? (
        <Line label={t("content.fields.word")} errors={at("word")}>
          <TextBox value={question.word} onChange={(next) => set({ word: next })} voice="target" />
        </Line>
      ) : null}
      {question.type !== "dict" ? (
        <Line label={t("content.fields.prompt")} errors={at("prompt")}>
          <TextBox value={question.prompt} onChange={(next) => set({ prompt: next })} voice={voice} />
        </Line>
      ) : null}
      {band >= 3 && question.type !== "dict" ? (
        <Line label={t("content.fields.prompt_fa")} errors={at("prompt_fa")}>
          <TextBox value={question.prompt_fa ?? ""} onChange={(next) => set({ prompt_fa: next || null })} voice="fa" />
        </Line>
      ) : null}

      <QuestionBody question={question} voice={voice} sentences={sentences} set={set} at={at} />

      <Line label={t("content.fields.explanation_fa")} errors={at("explanation_fa")}>
        <AreaBox value={question.explanation_fa ?? ""} onChange={(next) => set({ explanation_fa: next || null })} voice="fa" rows={1} />
      </Line>
    </li>
  );
}

function Line({ label, errors, children }: { label: string; errors?: FieldError[]; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1.5" id={id}>
      <span className="text-ink-3 text-[12.5px] font-bold">{label}</span>
      {children}
      {errors && errors.length > 0 ? <span className="text-bad text-[13px] font-bold">{[...new Set(errors.map((error) => error.message))].join(" ")}</span> : null}
    </div>
  );
}

/** A choice that is the right answer: a round mark that turns teal (DESIGN.md: teal is for right answers). */
function RightMark({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={cn("grid size-7 shrink-0 place-items-center rounded-full border-2 transition-colors", on ? "border-ok bg-ok text-surface" : "border-line-2 hover:border-ink-3")}
    >
      {on ? <Check className="size-3.5" strokeWidth={3} aria-hidden /> : null}
    </button>
  );
}

function Strings({ items, onChange, voice, min = 1 }: { items: string[]; onChange: (next: string[]) => void; voice: Voice; min?: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-1">
          <TextBox value={item} onChange={(next) => onChange(items.map((old, k) => (k === index ? next : old)))} voice={voice} className="h-10" />
          <RowTools index={index} count={items.length} onRemove={(at) => onChange(items.filter((_, k) => k !== at))} canRemove={items.length > min} />
        </span>
      ))}
      <AddButton onClick={() => onChange([...items, ""])} />
    </div>
  );
}

function QuestionBody({
  question,
  voice,
  sentences,
  set,
  at,
}: {
  question: QuestionEdit;
  voice: Voice;
  sentences: string[];
  set: (patch: Record<string, unknown>) => void;
  at: (field: string) => FieldError[];
}) {
  const sentenceOptions = sentences.map((text, index) => ({ value: String(index), label: `${formatNumber(index + 1)}. ${text}` }));
  switch (question.type) {
    case "mcq":
    case "ctx":
      return (
        <Line label={t("content.fields.options")} errors={[...at("options"), ...at("correct")]}>
          <div role="radiogroup" className="flex flex-col gap-1.5">
            {question.options.map((option, index) => (
              <span key={index} className="flex items-center gap-2">
                <RightMark on={question.correct === index} onClick={() => set({ correct: index })} label={t("content.fields.correct")} />
                <TextBox value={option} onChange={(next) => set({ options: question.options.map((old, k) => (k === index ? next : old)) })} voice={voice} className="h-10" />
              </span>
            ))}
          </div>
        </Line>
      );
    case "tf":
      return (
        <Line label={t("content.fields.correct")}>
          <Segmented
            value={question.correct ? "true" : "false"}
            onChange={(next) => set({ correct: next === "true" })}
            options={[
              { value: "true", label: t("admin.library.options.true") },
              { value: "false", label: t("admin.library.options.false") },
            ]}
            label={t("content.fields.correct")}
          />
        </Line>
      );
    case "order": {
      const items = question.items;
      const place = (item: number) => question.correct_order.indexOf(item);
      const setPlace = (item: number, to: number) => {
        const order = [...question.correct_order];
        const from = order.indexOf(item);
        if (from < 0) return;
        [order[from], order[to]] = [order[to], order[from]];
        set({ correct_order: order });
      };
      return (
        <Line label={t("content.fields.items")} errors={[...at("items"), ...at("correct_order")]}>
          <div className="flex flex-col gap-1.5">
            {items.map((item, index) => (
              <span key={index} className="flex items-center gap-2">
                <SelectBox
                  value={String(place(index))}
                  onChange={(next) => setPlace(index, Number(next))}
                  options={items.map((_, k) => ({ value: String(k), label: formatNumber(k + 1) }))}
                  label={t("content.fields.correct_order")}
                  className="w-20 shrink-0 [&_select]:h-10"
                />
                <TextBox value={item} onChange={(next) => set({ items: items.map((old, k) => (k === index ? next : old)) })} voice={voice} className="h-10" />
                <RowTools
                  index={index}
                  count={items.length}
                  canRemove={items.length > 4}
                  onRemove={(gone) =>
                    set({
                      items: items.filter((_, k) => k !== gone),
                      correct_order: question.correct_order.filter((k) => k !== gone).map((k) => (k > gone ? k - 1 : k)),
                    })
                  }
                />
              </span>
            ))}
            {items.length < 5 ? <AddButton onClick={() => set({ items: [...items, ""], correct_order: [...question.correct_order, items.length] })} /> : null}
          </div>
        </Line>
      );
    }
    case "match": {
      const rightFor = (left: number) => question.pairs.find(([l]) => l === left)?.[1] ?? 0;
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Line label={t("content.fields.right")} errors={at("right")}>
            <Strings items={question.right} onChange={(next) => set({ right: next, pairs: question.pairs.map(([l, r]) => [l, Math.min(r, Math.max(0, next.length - 1))]) })} voice={voice} min={2} />
          </Line>
          <Line label={t("content.fields.left")} errors={[...at("left"), ...at("pairs")]}>
            <div className="flex flex-col gap-1.5">
              {question.left.map((left, index) => (
                <span key={index} className="flex flex-col gap-1 sm:flex-row sm:items-center">
                  <TextBox value={left} onChange={(next) => set({ left: question.left.map((old, k) => (k === index ? next : old)) })} voice={voice} className="h-10" />
                  <SelectBox
                    value={String(rightFor(index))}
                    onChange={(next) => set({ pairs: question.left.map((_, k) => [k, k === index ? Number(next) : rightFor(k)]) })}
                    options={question.right.map((right, k) => ({ value: String(k), label: right || `${formatNumber(k + 1)}` }))}
                    label={t("admin.library.texts.pairWith", { left })}
                    className="sm:w-40 [&_select]:h-10"
                  />
                </span>
              ))}
              <span className="flex gap-1">
                <AddButton onClick={() => set({ left: [...question.left, ""], pairs: [...question.pairs, [question.left.length, 0]] })} />
                {question.left.length > 2 ? (
                  <RowTools
                    index={question.left.length - 1}
                    count={question.left.length}
                    onRemove={(gone) => set({ left: question.left.filter((_, k) => k !== gone), pairs: question.pairs.filter(([l]) => l !== gone) })}
                  />
                ) : null}
              </span>
            </div>
          </Line>
        </div>
      );
    }
    case "cloze":
      return (
        <>
          <Line label={t("content.fields.text_with_gaps")} errors={at("text_with_gaps")}>
            <AreaBox value={question.text_with_gaps} onChange={(next) => set({ text_with_gaps: next })} voice="target" rows={2} />
            <span className="text-ink-3 text-[12.5px]">{t("admin.library.texts.gapHelp")}</span>
          </Line>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Line label={t("content.fields.answers")} errors={at("answers")}>
              <Strings items={question.answers} onChange={(next) => set({ answers: next })} voice="target" />
            </Line>
            <Line label={t("content.fields.bank")} errors={at("bank")}>
              <Strings items={question.bank} onChange={(next) => set({ bank: next })} voice="target" />
            </Line>
          </div>
        </>
      );
    case "find":
      return (
        <Line label={t("content.fields.correct_sentence")} errors={at("correct_sentence")}>
          <SelectBox value={String(question.correct_sentence)} onChange={(next) => set({ correct_sentence: Number(next) })} options={sentenceOptions} label={t("content.fields.correct_sentence")} />
        </Line>
      );
    case "num":
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Line label={t("content.fields.answer")} errors={at("answer")}>
            <TextBox value={question.answer} onChange={(next) => set({ answer: next })} voice="target" className="h-10" />
          </Line>
          <Line label={t("content.fields.accepted")} errors={at("accepted")}>
            <Strings items={question.accepted} onChange={(next) => set({ accepted: next })} voice="target" />
          </Line>
        </div>
      );
    case "dict":
      return (
        <Line label={t("content.fields.sentence")} errors={at("sentence")}>
          <SelectBox value={String(question.sentence)} onChange={(next) => set({ sentence: Number(next) })} options={sentenceOptions} label={t("content.fields.sentence")} />
        </Line>
      );
  }
}

"use client";

import { createContext, useContext, useId, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronDown, Plus, Trash2 } from "lucide-react";
import { t, type MessageKey } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { cn } from "@/lib/utils";
import type { FieldError } from "@/server/content/library/edit/types";

/**
 * Building blocks of the edit forms (PRD §13.2: «هر فیلد یک راهنمای کوتاه فارسی با مثال دارد»).
 * Values live in one object in the edit shell; each field reads and writes its own key. French and
 * German are typed in the Latin serif, left to right; Persian stays right to left.
 */

type FormState = {
  values: Record<string, unknown>;
  set: (name: string, value: unknown) => void;
  errors: FieldError[];
  language: string;
  slug: string;
};

export const FormContext = createContext<FormState | null>(null);

export function useForm() {
  const form = useContext(FormContext);
  if (!form) throw new Error("Field outside the edit form");
  return form;
}

/** The value of one field, its setter and the messages that belong to it or its rows. */
export function useField<T>(name: string): [T, (value: T) => void, FieldError[]] {
  const form = useForm();
  const errors = form.errors.filter((error) => error.path === name || error.path.startsWith(`${name}[`) || error.path.startsWith(`${name}.`));
  return [form.values[name] as T, (value: T) => form.set(name, value), errors];
}

/** Errors of one row of a list field, such as "tokens[3]". */
export const rowErrors = (errors: FieldError[], name: string, index: number) =>
  errors.filter((error) => error.path === `${name}[${index}]` || error.path.startsWith(`${name}[${index}].`) || error.path.startsWith(`${name}[${index}][`));

/** Label key and help key of a field: content.fields has the shared names, admin.library.help the help. */
export function useTexts(name: string, label?: MessageKey) {
  const { slug } = useForm();
  return {
    label: t(label ?? (`content.fields.${name}` as MessageKey)),
    help: t(`admin.library.help.${slug}.${name}` as MessageKey),
    hasHelp: t(`admin.library.help.${slug}.${name}` as MessageKey) !== `admin.library.help.${slug}.${name}`,
  };
}

export function Field({
  name,
  label,
  help,
  errors,
  children,
  wide,
  htmlFor,
  after,
  hideLabel,
}: {
  name: string;
  label?: MessageKey;
  help?: string | null;
  errors?: FieldError[];
  children: ReactNode;
  wide?: boolean;
  htmlFor?: string;
  after?: ReactNode;
  /** The section title already names it; the label stays for screen readers. */
  hideLabel?: boolean;
}) {
  const texts = useTexts(name, label);
  const helpText = help === undefined ? (texts.hasHelp ? texts.help : null) : help;
  const own = errors ?? [];
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", wide && "sm:col-span-2")} data-field={name}>
      <div className={cn("flex flex-col gap-0.5", hideLabel && !helpText && "sr-only")}>
        <label htmlFor={htmlFor} className={cn("text-ink text-[13.5px] font-bold", hideLabel && "sr-only")}>
          {texts.label}
        </label>
        {helpText ? <p className="text-ink-3 max-w-[70ch] text-[13px] leading-6">{isolateLatin(helpText)}</p> : null}
      </div>
      {children}
      {after ? <div className="text-ink-3 text-[13px] leading-6">{after}</div> : null}
      {own.length > 0 ? (
        <ul className="text-bad flex flex-col gap-0.5 text-[13px] font-bold" role="alert">
          {[...new Set(own.map((error) => error.message))].map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const inputLook =
  "bg-surface border-line-2 text-ink placeholder:text-ink-3 w-full min-w-0 rounded-[14px] border outline-none transition-[border-color,box-shadow] focus-visible:border-brand-soft focus-visible:ring-[3px] focus-visible:ring-ring/30 aria-invalid:border-bad disabled:opacity-60";

export type Voice = "fa" | "target";

export function TextBox({
  value,
  onChange,
  voice,
  id,
  invalid,
  placeholder,
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  voice: Voice;
  id?: string;
  invalid?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { language } = useForm();
  return (
    <input
      id={id}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
      dir={voice === "target" ? "ltr" : "rtl"}
      lang={voice === "target" ? language : "fa"}
      className={cn(inputLook, "h-11 px-3.5", voice === "target" ? "lat text-[17px]" : "text-[15px]", className)}
    />
  );
}

export function AreaBox({
  value,
  onChange,
  voice,
  id,
  invalid,
  rows = 3,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  voice: Voice;
  id?: string;
  invalid?: boolean;
  rows?: number;
  className?: string;
}) {
  const { language } = useForm();
  return (
    <textarea
      id={id}
      value={value}
      rows={rows}
      aria-invalid={invalid || undefined}
      onChange={(event) => onChange(event.target.value)}
      dir={voice === "target" ? "ltr" : "rtl"}
      lang={voice === "target" ? language : "fa"}
      style={{ minHeight: `calc(${rows} * 1.75rem + 1.4rem)` }}
      className={cn(inputLook, "field-sizing-content px-3.5 py-2.5", voice === "target" ? "lat text-[17px] leading-[1.65]" : "text-[15px] leading-7", className)}
    />
  );
}

/** A one-line text field bound to the form. */
export function TextField({
  name,
  voice,
  label,
  wide,
  nullable,
  after,
}: {
  name: string;
  voice: Voice;
  label?: MessageKey;
  wide?: boolean;
  nullable?: boolean;
  after?: ReactNode;
}) {
  const [value, set, errors] = useField<string | null>(name);
  const id = useId();
  return (
    <Field name={name} label={label} errors={errors} wide={wide} htmlFor={id} after={after}>
      <TextBox id={id} value={value ?? ""} onChange={(next) => set(nullable && !next ? null : next)} voice={voice} invalid={errors.length > 0} />
    </Field>
  );
}

export function AreaField({ name, voice, label, rows, nullable, after }: { name: string; voice: Voice; label?: MessageKey; rows?: number; nullable?: boolean; after?: ReactNode }) {
  const [value, set, errors] = useField<string | null>(name);
  const id = useId();
  return (
    <Field name={name} label={label} errors={errors} wide htmlFor={id} after={after}>
      <AreaBox id={id} value={value ?? ""} onChange={(next) => set(nullable && !next ? null : next)} voice={voice} rows={rows} invalid={errors.length > 0} />
    </Field>
  );
}

export function NumberField({ name, label, min, max }: { name: string; label?: MessageKey; min?: number; max?: number }) {
  const [value, set, errors] = useField<number>(name);
  const id = useId();
  return (
    <Field name={name} label={label} errors={errors} htmlFor={id}>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        aria-invalid={errors.length > 0 || undefined}
        onChange={(event) => set(event.target.value === "" ? Number.NaN : Number(event.target.value))}
        className={cn(inputLook, "h-11 w-32 px-3.5 text-[15px] tabular-nums")}
      />
    </Field>
  );
}

export type Option = { value: string; label: string; latin?: boolean };

export function SelectBox({
  value,
  onChange,
  options,
  id,
  invalid,
  className,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Option[];
  id?: string;
  invalid?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <span className={cn("relative block", className)}>
      <select
        id={id}
        value={value}
        aria-label={label}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        className={cn(inputLook, "h-11 appearance-none ps-3.5 pe-10 text-[15px]")}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="text-ink-3 pointer-events-none absolute end-3.5 top-1/2 size-4 -translate-y-1/2" aria-hidden />
    </span>
  );
}

export function SelectField({ name, options, label, nullable }: { name: string; options: Option[]; label?: MessageKey; nullable?: boolean }) {
  const [value, set, errors] = useField<string | null>(name);
  const id = useId();
  return (
    <Field name={name} label={label} errors={errors} htmlFor={id}>
      <SelectBox
        id={id}
        value={value ?? ""}
        onChange={(next) => set(nullable && !next ? null : next)}
        options={nullable ? [{ value: "", label: "—" }, ...options] : options}
        invalid={errors.length > 0}
      />
    </Field>
  );
}

/** A few choices side by side, such as the level or «نوشتنی / شناختنی». */
export function Segmented({ value, onChange, options, label }: { value: string; onChange: (value: string) => void; options: Option[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="bg-tint flex w-fit flex-wrap gap-1 rounded-[14px] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "flex h-9 items-center rounded-[10px] px-3.5 text-[13.5px] font-bold transition-[background-color,color,box-shadow] duration-150",
            value === option.value ? "bg-surface dark:bg-tint-2 text-brand-text shadow-[var(--shadow-1)]" : "text-ink-2 hover:text-ink",
          )}
        >
          {option.latin ? <bdi className="lat text-[15px] font-semibold">{option.label}</bdi> : option.label}
        </button>
      ))}
    </div>
  );
}

export function SegmentedField({ name, options, label, after }: { name: string; options: Option[]; label?: MessageKey; after?: ReactNode }) {
  const [value, set, errors] = useField<string>(name);
  const texts = useTexts(name, label);
  return (
    <Field name={name} label={label} errors={errors} after={after}>
      <Segmented value={value} onChange={set} options={options} label={texts.label} />
    </Field>
  );
}

/** On or off, as a switch that reads well in both directions. */
export function Toggle({ checked, onChange, label, id, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: string; id?: string; disabled?: boolean }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-8 w-[52px] shrink-0 rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-45",
        checked ? "bg-brand" : "bg-line-2",
      )}
    >
      <span
        className={cn(
          "bg-surface absolute top-1 size-6 rounded-full shadow-[0_1px_3px_rgb(43_16_32/0.25)] transition-[inset-inline-start] duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none",
          checked ? "start-[24px]" : "start-1",
        )}
      />
    </button>
  );
}

export function ToggleField({ name, label, wide }: { name: string; label?: MessageKey; wide?: boolean }) {
  const [value, set, errors] = useField<boolean>(name);
  const texts = useTexts(name, label);
  const id = useId();
  return (
    <Field name={name} label={label} errors={errors} htmlFor={id} wide={wide}>
      <Toggle id={id} checked={Boolean(value)} onChange={set} label={texts.label} />
    </Field>
  );
}

/** Buttons at the end of a list row: move up, move down, remove. */
export function RowTools({
  index,
  count,
  onMove,
  onRemove,
  canRemove = true,
}: {
  index: number;
  count: number;
  onMove?: (from: number, to: number) => void;
  onRemove?: (index: number) => void;
  canRemove?: boolean;
}) {
  const button = "text-ink-3 hover:bg-tint hover:text-ink grid size-9 shrink-0 place-items-center rounded-[10px] disabled:opacity-30 disabled:hover:bg-transparent";
  return (
    <span className="flex shrink-0 items-center">
      {onMove ? (
        <>
          <button type="button" className={button} disabled={index === 0} onClick={() => onMove(index, index - 1)}>
            <ArrowUp className="size-4" strokeWidth={1.75} aria-hidden />
            <span className="sr-only">{t("admin.library.form.moveUp")}</span>
          </button>
          <button type="button" className={button} disabled={index === count - 1} onClick={() => onMove(index, index + 1)}>
            <ArrowDown className="size-4" strokeWidth={1.75} aria-hidden />
            <span className="sr-only">{t("admin.library.form.moveDown")}</span>
          </button>
        </>
      ) : null}
      {onRemove ? (
        <button type="button" className={cn(button, "hover:text-bad")} disabled={!canRemove} onClick={() => onRemove(index)}>
          <Trash2 className="size-4" strokeWidth={1.75} aria-hidden />
          <span className="sr-only">{t("admin.library.form.remove")}</span>
        </button>
      ) : null}
    </span>
  );
}

export function AddButton({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-brand-text hover:bg-tint flex h-10 w-fit items-center gap-1.5 rounded-[12px] px-3 text-[13.5px] font-bold transition-colors"
    >
      <Plus className="size-4" strokeWidth={2} aria-hidden />
      {label ?? t("admin.library.form.add")}
    </button>
  );
}

export const move = <T,>(list: T[], from: number, to: number) => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

/** A list of short texts, one per row (checklist items, accepted answers, homophones, …). */
export function ListField({ name, voice, label, max, ordered }: { name: string; voice: Voice; label?: MessageKey; max?: number; ordered?: boolean }) {
  const [value, set, errors] = useField<string[]>(name);
  const list = value ?? [];
  return (
    <Field name={name} label={label} errors={errors.filter((error) => !/\[\d+\]/.test(error.path))} wide>
      <ol className="flex flex-col gap-2">
        {list.map((item, index) => {
          const own = rowErrors(errors, name, index);
          return (
            <li key={index} className="flex flex-col gap-1">
              <span className="flex items-center gap-1.5">
                <TextBox value={item} voice={voice} invalid={own.length > 0} onChange={(next) => set(list.map((old, k) => (k === index ? next : old)))} />
                <RowTools
                  index={index}
                  count={list.length}
                  onMove={ordered ? (from, to) => set(move(list, from, to)) : undefined}
                  onRemove={(at) => set(list.filter((_, k) => k !== at))}
                />
              </span>
              {own.length > 0 ? <span className="text-bad text-[13px] font-bold">{own[0].message}</span> : null}
            </li>
          );
        })}
      </ol>
      {max === undefined || list.length < max ? <AddButton onClick={() => set([...list, ""])} /> : null}
    </Field>
  );
}

/** Pairs of a French or German text and its Persian translation (useful phrases, collocations). */
export function PairListField({ name, label, max }: { name: string; label?: MessageKey; max?: number }) {
  const [value, set, errors] = useField<{ text: string; translation_fa: string }[]>(name);
  const list = value ?? [];
  const update = (index: number, key: "text" | "translation_fa", next: string) => set(list.map((item, k) => (k === index ? { ...item, [key]: next } : item)));
  return (
    <Field name={name} label={label} errors={errors.filter((error) => !/\[\d+\]/.test(error.path))} wide>
      <ol className="flex flex-col gap-2">
        {list.map((item, index) => {
          const own = rowErrors(errors, name, index);
          return (
            <li key={index} className="flex flex-col gap-1">
              <span className="flex flex-wrap items-center gap-1.5 sm:flex-nowrap">
                <TextBox value={item.text} voice="target" onChange={(next) => update(index, "text", next)} invalid={own.length > 0} className="sm:flex-1" />
                <TextBox value={item.translation_fa} voice="fa" onChange={(next) => update(index, "translation_fa", next)} invalid={own.length > 0} className="sm:flex-1" />
                <RowTools index={index} count={list.length} onRemove={(at) => set(list.filter((_, k) => k !== at))} />
              </span>
              {own.length > 0 ? <span className="text-bad text-[13px] font-bold">{own[0].message}</span> : null}
            </li>
          );
        })}
      </ol>
      {max === undefined || list.length < max ? <AddButton onClick={() => set([...list, { text: "", translation_fa: "" }])} /> : null}
    </Field>
  );
}

/** A titled group of fields inside the form card. */
export function Section({ title, lead, children, columns = 2 }: { title?: string; lead?: string; children: ReactNode; columns?: 1 | 2 }) {
  return (
    <section className="border-line flex flex-col gap-5 border-b px-5 py-6 last:border-b-0 sm:px-7">
      {title ? (
        <div className="flex flex-col gap-1">
          <h2 className="text-ink text-[17px] font-extrabold">{title}</h2>
          {lead ? <p className="text-ink-3 text-[13.5px] leading-6">{isolateLatin(lead)}</p> : null}
        </div>
      ) : null}
      <div className={cn(columns === 2 ? "grid gap-x-6 gap-y-5 sm:grid-cols-2" : "flex flex-col gap-5")}>{children}</div>
    </section>
  );
}

export const levelOptions = (levels: string[]): Option[] => levels.map((level) => ({ value: level, label: level, latin: true }));

/** Several choices that can each be on or off, as chips (a text's key words, an exercise's units). */
export function ChipToggles({
  options,
  selected,
  onChange,
  max,
  label,
}: {
  options: (Option & { sub?: string })[];
  selected: string[];
  onChange: (next: string[]) => void;
  max?: number;
  label: string;
}) {
  const { language } = useForm();
  const full = max !== undefined && selected.length >= max;
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            disabled={!on && full}
            onClick={() => onChange(on ? selected.filter((value) => value !== option.value) : [...selected, option.value])}
            className={cn(
              "flex min-h-10 items-baseline gap-2 rounded-[12px] border px-3 py-1.5 text-start transition-[background-color,border-color,color] duration-150 disabled:opacity-40",
              on ? "border-brand bg-tint text-brand-text" : "border-line-2 text-ink-2 hover:border-ink-3 hover:text-ink",
            )}
          >
            {option.latin ? (
              <bdi dir="ltr" lang={language} className="lat text-[16px] font-semibold">
                {option.label}
              </bdi>
            ) : (
              <span className="text-[13.5px] font-bold">{isolateLatin(option.label)}</span>
            )}
            {option.sub ? <span className="text-ink-3 text-[12.5px]">{isolateLatin(option.sub)}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Words of a French or German text, counted the way the server counts them. */
export const countWords = (text: string) => text.split(/\s+/).filter((piece) => /[\p{L}\p{N}]/u.test(piece)).length;

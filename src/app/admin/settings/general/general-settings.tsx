"use client";

import { useId, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AddButton, AreaBox, Field, FormContext, move, RowTools, SelectBox, TextBox } from "@/app/admin/content/[type]/[id]/form-kit";
import { NumberBox } from "@/components/admin/number-box";
import { formatNumber, t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import type { FieldError } from "@/server/content/library/edit/types";
import type { LanguageCode } from "@/server/content/languages";
import type { SettingError } from "@/server/settings/engine-rules";
import { checkField, generalSections, lessonKinds, type GeneralFieldView, type GeneralSection, type GeneralValue, type Lesson } from "@/server/settings/general-fields";
import { saveGeneralAction } from "../actions";
import { SaveBar, SectionChips, type Notice } from "../save-bar";

/**
 * What a field holds while it is edited. Lists are typed one item per line, so a list is its text
 * until it is saved; everything else is edited in the shape it is saved in.
 */
type Draft = GeneralValue;

const splitLines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

function draftOf(field: GeneralFieldView, value: GeneralValue): Draft {
  if (field.kind === "lines") return (value as string[]).join("\n");
  if (field.kind === "levelLines") return Object.fromEntries(Object.entries(value as Record<string, string[]>).map(([level, list]) => [level, list.join("\n")]));
  return structuredClone(value);
}

/** The value a draft stands for, trimmed the way the save trims it. */
function valueOf(field: GeneralFieldView, draft: Draft): GeneralValue {
  switch (field.kind) {
    case "text":
      return (draft as string).trim();
    case "textMap":
      return Object.fromEntries(Object.entries(draft as Record<string, string>).map(([key, text]) => [key, text.trim()]));
    case "lines":
      return splitLines(draft as string);
    case "levelLines":
      return Object.fromEntries(Object.entries(draft as Record<string, string>).map(([level, text]) => [level, splitLines(text)]));
    case "lessons":
      return (draft as Lesson[]).map((lesson) => ({ label: lesson.label.trim(), kind: lesson.kind }));
    default:
      return draft;
  }
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const part = (key: string) => {
  const name = `admin.settings.general.parts.${key}` as MessageKey;
  return t(name) === name ? null : t(name);
};
const isLevel = (key: string) => /^[ABC][12]$/.test(key);

function Level({ level, className }: { level: string; className?: string }) {
  return (
    <bdi dir="ltr" className={cn("lat text-ink text-[15px] font-semibold", className)}>
      {level}
    </bdi>
  );
}

/** The label of one place inside a field: a level, a prompt name, a column. */
function PartLabel({ name }: { name: string }) {
  if (isLevel(name)) return <Level level={name} />;
  const text = part(name);
  return text ? <span>{text}</span> : <bdi dir="ltr">{name}</bdi>;
}

/**
 * «تنظیمات عمومی» (PRD §13.2): one card per part of the page, each field edited in a plain shape. Only
 * the fields that changed are sent; each becomes one row of «تاریخچه تغییرها».
 */
export function GeneralSettings({ fields, language }: { fields: GeneralFieldView[]; language: LanguageCode }) {
  const router = useRouter();
  const byId = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const [saved, setSaved] = useState<Record<string, GeneralValue>>(() => Object.fromEntries(fields.map((field) => [field.id, field.value])));
  const initialDrafts = () => Object.fromEntries(fields.map((field) => [field.id, draftOf(field, saved[field.id])]));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initialDrafts);
  const [serverErrors, setServerErrors] = useState<SettingError[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, startTransition] = useTransition();

  const values = useMemo(() => Object.fromEntries(fields.map((field) => [field.id, valueOf(field, drafts[field.id])])), [fields, drafts]);
  const dirtyIds = useMemo(() => fields.filter((field) => !sameValue(values[field.id], saved[field.id])).map((field) => field.id), [fields, values, saved]);
  const dirty = new Set(dirtyIds);

  const errors = useMemo(() => {
    const found: SettingError[] = dirtyIds.flatMap((id) => checkField(byId.get(id)!, values[id]));
    for (const error of serverErrors)
      if (dirtyIds.some((id) => error.key === id || error.key.startsWith(`${id}.`)) && !found.some((own) => own.key === error.key)) found.push(error);
    return found;
  }, [dirtyIds, values, byId, serverErrors]);

  const set = (id: string, draft: Draft) => {
    setDrafts((current) => ({ ...current, [id]: draft }));
    if (notice?.tone === "saved") setNotice(null);
  };

  const save = () => {
    if (errors.length > 0) {
      setNotice({ tone: "invalid", text: t("admin.settings.invalid", { count: errors.length }) });
      const first = fields.find((field) => errors.some((error) => error.key === field.id || error.key.startsWith(`${field.id}.`)));
      if (first) document.getElementById(first.id)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const changes = Object.fromEntries(dirtyIds.map((id) => [id, values[id]]));
    startTransition(async () => {
      const result = await saveGeneralAction(changes);
      if (result.state === "saved") {
        setSaved((current) => ({ ...current, ...result.values }));
        setDrafts((current) => ({ ...current, ...Object.fromEntries(Object.entries(result.values).map(([id, value]) => [id, draftOf(byId.get(id)!, value)])) }));
        setServerErrors([]);
        setNotice({ tone: "saved", text: t("admin.settings.saved", { count: result.changed.length }) });
        router.refresh();
      } else if (result.state === "invalid") {
        setServerErrors(result.errors);
        setNotice({ tone: "invalid", text: t("admin.settings.invalid", { count: result.errors.length }) });
      } else setNotice({ tone: "failed", text: t("admin.settings.failed") });
    });
  };

  const sections = generalSections.map((section) => ({ section, fields: fields.filter((field) => field.section === section) })).filter((group) => group.fields.length > 0);
  const form = { values: {}, set: () => {}, errors: [], language, slug: "settings" };

  return (
    <FormContext.Provider value={form}>
      <div className="flex flex-col gap-6">
        <SectionChips
          label={t("admin.settings.general.sectionsLabel")}
          items={sections.map((group) => ({
            id: `section-${group.section}`,
            name: t(`admin.settings.general.sections.${group.section}.title`),
            dirty: group.fields.some((field) => dirty.has(field.id)),
          }))}
        />

        {sections.map((group) => (
          <SectionCard key={group.section} section={group.section}>
            {group.fields.map((field) => {
              const own = errors.filter((error) => error.key === field.id || error.key.startsWith(`${field.id}.`));
              return (
                <FieldRow
                  key={field.id}
                  field={field}
                  draft={drafts[field.id]}
                  value={values[field.id]}
                  dirty={dirty.has(field.id)}
                  errors={own}
                  onChange={(draft) => set(field.id, draft)}
                />
              );
            })}
          </SectionCard>
        ))}

        <SaveBar
          count={dirtyIds.length}
          notice={notice}
          pending={pending}
          onSave={save}
          onUndo={() => {
            setDrafts(initialDrafts());
            setServerErrors([]);
            setNotice(null);
          }}
        />
      </div>
    </FormContext.Provider>
  );
}

function SectionCard({ section, children }: { section: GeneralSection; children: React.ReactNode }) {
  const titleId = `section-${section}-title`;
  return (
    <section id={`section-${section}`} aria-labelledby={titleId} className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={titleId} className="text-ink text-[17px] font-extrabold">
          {t(`admin.settings.general.sections.${section}.title`)}
        </h2>
        <p className="text-ink-3 max-w-[70ch] text-[13.5px] leading-6">{t(`admin.settings.general.sections.${section}.lead`)}</p>
      </div>
      <div className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">{children}</div>
    </section>
  );
}

/** Where an error sits inside a field, as the teacher reads it: «A2: …», «فهرست کلمه‌ها: …». */
function placed(field: GeneralFieldView, errors: SettingError[]): FieldError[] {
  return errors.map((error) => {
    const where = error.key === field.id ? "" : error.key.slice(field.id.length + 1);
    if (!where) return { path: field.id, message: error.message };
    const pieces = where.split(".");
    const name =
      field.kind === "lessons"
        ? t("admin.settings.general.lessonNumber", { number: Number(pieces[0]) + 1 })
        : pieces.map((piece) => (isLevel(piece) ? piece : (part(piece) ?? piece))).join(" · ");
    return { path: error.key, message: `${name}: ${error.message}` };
  });
}

function FieldRow({
  field,
  draft,
  value,
  dirty,
  errors,
  onChange,
}: {
  field: GeneralFieldView;
  draft: Draft;
  value: GeneralValue;
  dirty: boolean;
  errors: SettingError[];
  onChange: (draft: Draft) => void;
}) {
  const controlId = useId();
  const bad = new Set(errors.map((error) => error.key));
  const invalid = (where?: string) => bad.has(where ? `${field.id}.${where}` : field.id);
  const help = field.help ? t(field.help) : null;
  const after = countLine(field, draft, value);

  return (
    <div id={field.id} className={cn("target:bg-tint/60 scroll-mt-24 px-5 py-5 transition-colors duration-500 sm:px-6", dirty && "bg-tint/45")}>
      <Field
        name={field.id}
        label={field.label}
        help={help}
        errors={placed(field, errors)}
        htmlFor={field.kind === "text" || field.kind === "lines" ? controlId : undefined}
        after={after}
      >
        <Control field={field} draft={draft} onChange={onChange} invalid={invalid} controlId={controlId} />
      </Field>
    </div>
  );
}

/** A quiet count under lists and long texts: «۳ مورد», «۲۴۰ از ۳۰۰ نویسه». */
function countLine(field: GeneralFieldView, draft: Draft, value: GeneralValue) {
  if (field.kind === "lines") return t("admin.settings.general.itemCount", { count: (value as string[]).length, max: field.max });
  if (field.kind === "text") {
    const length = (draft as string).trim().length;
    return length > field.max * 0.8 ? t("admin.settings.general.charCount", { count: length, max: field.max }) : null;
  }
  return null;
}

const textArea =
  "bg-surface border-line-2 text-ink placeholder:text-ink-3 focus-visible:border-brand-soft focus-visible:ring-ring/30 aria-invalid:border-bad field-sizing-content w-full min-w-0 rounded-[14px] border px-3.5 py-2.5 outline-none transition-[border-color,box-shadow] focus-visible:ring-[3px]";

/** A list typed one item per line; French and German tense names are set in the Latin serif. */
function LinesBox({
  id,
  value,
  onChange,
  invalid,
  target,
  label,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  target: boolean;
  label?: string;
}) {
  const rows = Math.max(3, value.split("\n").length);
  return (
    <textarea
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={invalid || undefined}
      aria-label={label}
      dir={target ? "ltr" : "auto"}
      rows={rows}
      spellCheck={false}
      style={{ minHeight: `calc(${Math.min(rows, 4)} * 1.75rem + 1.4rem)` }}
      className={cn(textArea, target ? "lat text-[16px] leading-7" : "text-[15px] leading-7")}
    />
  );
}

function Control({
  field,
  draft,
  onChange,
  invalid,
  controlId,
}: {
  field: GeneralFieldView;
  draft: Draft;
  onChange: (draft: Draft) => void;
  invalid: (where?: string) => boolean;
  controlId: string;
}) {
  switch (field.kind) {
    case "text":
      return <AreaBox id={controlId} value={draft as string} onChange={onChange} voice="fa" rows={field.long ? 4 : 2} invalid={invalid()} />;

    case "textMap": {
      const map = draft as Record<string, string>;
      return (
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          {field.keys.map((key) => (
            <PairRow key={key} label={t("admin.settings.general.minutes", { count: Number(key) })}>
              <TextBox
                value={map[key] ?? ""}
                voice="fa"
                invalid={invalid(key)}
                onChange={(text) => onChange({ ...map, [key]: text })}
                placeholder={t("admin.settings.general.paceEmpty")}
              />
            </PairRow>
          ))}
        </div>
      );
    }

    case "lines":
      return <LinesBox id={controlId} value={draft as string} onChange={onChange} invalid={invalid()} target={false} />;

    case "levelLines": {
      const map = draft as Record<string, string>;
      const target = field.id.startsWith("conjugation.tenses");
      return (
        <div className="grid gap-4 lg:grid-cols-2">
          {Object.keys(map).map((level) => {
            const count = splitLines(map[level]).length;
            return (
              <div key={level} className="flex min-w-0 flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <Level level={level} />
                  <span className="text-ink-3 text-[12.5px] tabular-nums">{t("admin.settings.general.itemCount", { count, max: field.max })}</span>
                </div>
                <LinesBox value={map[level]} onChange={(text) => onChange({ ...map, [level]: text })} invalid={invalid(level)} target={target} label={level} />
              </div>
            );
          })}
        </div>
      );
    }

    case "numbers": {
      const map = draft as Record<string, number>;
      const keys = Object.keys(map);
      return (
        <div className={cn("grid gap-x-10 gap-y-3", keys.every(isLevel) ? "w-fit grid-cols-2 sm:grid-cols-4" : "grid-cols-1 sm:w-fit sm:grid-cols-2 xl:grid-cols-3")}>
          {keys.map((key) => (
            <label key={key} className={cn("flex min-w-0 items-center gap-3", keys.every(isLevel) ? "" : "justify-between sm:w-60")}>
              <span className="text-ink-2 min-w-0 text-[13.5px] leading-5 font-bold">
                <PartLabel name={key} />
              </span>
              <NumberBox value={map[key]} invalid={invalid(key)} onChange={(number) => onChange({ ...map, [key]: number })} className="w-20 shrink-0" />
            </label>
          ))}
        </div>
      );
    }

    case "levelNumbers": {
      const table = draft as Record<string, Record<string, number>>;
      const levels = Object.keys(table);
      return (
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <table className="w-full border-separate border-spacing-x-1 border-spacing-y-1.5 sm:w-auto sm:border-spacing-x-1.5">
            <thead>
              <tr>
                <th className="sr-only">{t("admin.settings.general.contentKind")}</th>
                {levels.map((level) => (
                  <th key={level} scope="col" className="pb-1 text-center font-normal">
                    <Level level={level} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {field.columns.map((column) => (
                <tr key={column}>
                  <th scope="row" className="text-ink-2 pe-2 text-start text-[13.5px] font-bold whitespace-nowrap">
                    <PartLabel name={column} />
                  </th>
                  {levels.map((level) => (
                    <td key={level} className="text-center">
                      <NumberBox
                        value={table[level][column]}
                        invalid={invalid(`${level}.${column}`)}
                        label={`${part(column) ?? column} ${level}`}
                        onChange={(number) => onChange({ ...table, [level]: { ...table[level], [column]: number } })}
                        className="w-full px-1 text-[14px] sm:w-24 sm:px-2 sm:text-[15px]"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case "ranges": {
      const map = draft as Record<string, [number, number]>;
      const unit = field.id === "prompt.writing_words" || field.id === "prompt.sentence_length" ? t("admin.settings.general.words") : null;
      return (
        <div className="grid gap-x-16 gap-y-2.5 sm:w-fit sm:grid-cols-2">
          {Object.keys(map).map((level) => {
            const [low, high] = map[level];
            return (
              <div key={level} className="flex items-center gap-2.5">
                <Level level={level} className="w-8 shrink-0" />
                <NumberBox
                  value={low}
                  invalid={invalid(level)}
                  label={t("admin.settings.general.rangeLow", { level })}
                  onChange={(number) => onChange({ ...map, [level]: [number, high] })}
                  className="w-16"
                />
                <span className="text-ink-3 text-[13.5px]">{t("admin.settings.general.to")}</span>
                <NumberBox
                  value={high}
                  invalid={invalid(level)}
                  label={t("admin.settings.general.rangeHigh", { level })}
                  onChange={(number) => onChange({ ...map, [level]: [low, number] })}
                  className="w-16"
                />
                {unit ? <span className="text-ink-3 text-[13px]">{unit}</span> : null}
              </div>
            );
          })}
        </div>
      );
    }

    case "lessons":
      return <LessonList field={field} lessons={draft as Lesson[]} onChange={onChange} invalid={invalid} />;
  }
}

function PairRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <span className="text-ink-2 text-[13.5px] font-bold whitespace-nowrap tabular-nums">{label}</span>
      {children}
    </>
  );
}

/** Phonics lessons in teaching order: each a name and its kind, moved with the arrows. */
function LessonList({
  field,
  lessons,
  onChange,
  invalid,
}: {
  field: GeneralFieldView;
  lessons: Lesson[];
  onChange: (lessons: Lesson[]) => void;
  invalid: (where?: string) => boolean;
}) {
  const kinds = lessonKinds(field.language).map((kind) => ({ value: kind, label: t(`admin.settings.general.phonicsKinds.${kind}` as MessageKey) }));
  const update = (index: number, lesson: Lesson) => onChange(lessons.map((old, k) => (k === index ? lesson : old)));
  return (
    <div className="flex flex-col gap-2">
      <ol className="flex flex-col gap-2">
        {lessons.map((lesson, index) => (
          <li key={index} className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-ink-3 w-6 shrink-0 text-center text-[13px] font-bold tabular-nums">{formatNumber(index + 1)}</span>
              <TextBox value={lesson.label} voice="fa" invalid={invalid(String(index))} onChange={(label) => update(index, { ...lesson, label })} className="flex-1" />
            </span>
            <span className="ms-8 flex min-w-0 items-center gap-1 md:ms-0">
              <SelectBox
                value={lesson.kind}
                onChange={(kind) => update(index, { ...lesson, kind })}
                options={kinds}
                label={t("admin.settings.general.lessonKind")}
                invalid={invalid(String(index))}
                className="min-w-0 flex-1 md:w-48 md:flex-none"
              />
              <RowTools
                index={index}
                count={lessons.length}
                onMove={(from, to) => onChange(move(lessons, from, to))}
                onRemove={(at) => onChange(lessons.filter((_, k) => k !== at))}
                canRemove={lessons.length > 1}
              />
            </span>
          </li>
        ))}
      </ol>
      {"max" in field && lessons.length < field.max ? (
        <AddButton onClick={() => onChange([...lessons, { label: "", kind: "rule" }])} label={t("admin.settings.general.addLesson")} />
      ) : null}
    </div>
  );
}

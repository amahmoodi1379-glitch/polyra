"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, RotateCcw, Search, X } from "lucide-react";
import { Segmented, Toggle } from "@/app/admin/content/[type]/[id]/form-kit";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/i18n";
import { plainDigits, typedNumber } from "@/lib/digits";
import { cn } from "@/lib/utils";
import type { EngineGroupView, EngineSettingView } from "@/server/settings/engine";
import { checkRelations, checkValue, shownValue, type EngineValue, type SettingError } from "@/server/settings/engine-rules";
import { saveEngineAction } from "../actions";
import { SaveBar, SectionChips, type Notice } from "../save-bar";

/** What a control holds while it is edited: typed text for numbers, on/off, or the chosen option. */
type Draft = string | boolean | number;

function draftOf(setting: Pick<EngineSettingView, "type">, value: EngineValue): Draft {
  switch (setting.type) {
    case "bool":
      return value === true;
    case "choice":
      return typeof value === "number" ? value : 0;
    case "weights":
      return Array.isArray(value) ? value.join(", ") : "";
    case "ratio":
      return typeof value === "number" ? typedNumber(Math.round(value * 1000) / 10) : "";
    default:
      return typeof value === "number" ? typedNumber(value) : "";
  }
}

/** The value a draft stands for, or "bad" when it is not a number at all. */
function valueOf(setting: Pick<EngineSettingView, "type">, draft: Draft): EngineValue | "bad" {
  if (typeof draft === "boolean" || typeof draft === "number") return draft;
  const text = plainDigits(draft);
  if (setting.type === "weights") {
    if (text === "") return null;
    const list = draft
      .split(/[,،\s]+/)
      .filter(Boolean)
      .map((item) => Number(plainDigits(item)));
    return list.every((item) => Number.isFinite(item)) ? list : "bad";
  }
  if (text === "") return setting.type === "optional_int" ? null : "bad";
  if (!/^-?\d+(\.\d+)?$/.test(text)) return "bad";
  const number = Number(text);
  return setting.type === "ratio" ? Math.round(number * 10) / 1000 : number;
}

const fold = (text: string) => text.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " ").toLowerCase();
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The settings, grouped as the catalog groups them, with a search and «فقط تغییرکرده‌ها». Each value
 * is checked as it is typed; «ذخیره» sends only the keys that changed (PRD §13.2).
 */
export function EngineSettings({ groups }: { groups: EngineGroupView[] }) {
  const router = useRouter();
  const settings = useMemo(() => groups.flatMap((group) => group.settings), [groups]);
  const byKey = useMemo(() => new Map(settings.map((setting) => [setting.key, setting])), [settings]);
  const [saved, setSaved] = useState<Record<string, EngineValue>>(() => Object.fromEntries(settings.map((setting) => [setting.key, setting.value])));
  const initialDrafts = () => Object.fromEntries(settings.map((setting) => [setting.key, draftOf(setting, saved[setting.key])]));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(initialDrafts);
  const [serverErrors, setServerErrors] = useState<SettingError[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [query, setQuery] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [pending, startTransition] = useTransition();

  const values = useMemo(() => Object.fromEntries(settings.map((setting) => [setting.key, valueOf(setting, drafts[setting.key])])), [settings, drafts]);
  const dirtyKeys = useMemo(() => settings.filter((setting) => !sameValue(values[setting.key], saved[setting.key])).map((setting) => setting.key), [settings, values, saved]);
  const dirty = new Set(dirtyKeys);

  // Each key on its own, then the rules between keys for what was changed; then what the server said.
  const errors = useMemo(() => {
    const found = new Map<string, string>();
    for (const key of dirtyKeys) {
      const value = values[key];
      const problem = value === "bad" ? t("admin.settings.engine.errors.number") : checkValue(byKey.get(key)!, value);
      if (problem) found.set(key, problem);
    }
    const typed = Object.fromEntries(Object.entries(values).filter(([, value]) => value !== "bad"));
    for (const error of checkRelations(typed, new Set(dirtyKeys))) if (!found.has(error.key)) found.set(error.key, error.message);
    for (const error of serverErrors) if (!found.has(error.key) && dirtyKeys.includes(error.key)) found.set(error.key, error.message);
    return found;
  }, [dirtyKeys, values, byKey, serverErrors]);

  const set = (key: string, draft: Draft) => {
    setDrafts((current) => ({ ...current, [key]: draft }));
    if (notice?.tone === "saved") setNotice(null);
  };

  const save = () => {
    if (errors.size > 0) {
      setNotice({ tone: "invalid", text: t("admin.settings.invalid", { count: errors.size }) });
      document.getElementById(`setting-${[...errors.keys()][0]}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const changes = Object.fromEntries(dirtyKeys.map((key) => [key, values[key]]));
    startTransition(async () => {
      const result = await saveEngineAction(changes);
      if (result.state === "saved") {
        setSaved((current) => ({ ...current, ...(changes as Record<string, EngineValue>) }));
        setDrafts((current) => ({ ...current, ...Object.fromEntries(dirtyKeys.map((key) => [key, draftOf(byKey.get(key)!, changes[key] as EngineValue)])) }));
        setServerErrors([]);
        setNotice({ tone: "saved", text: t("admin.settings.saved", { count: result.changed.length }) });
        router.refresh();
      } else if (result.state === "invalid") {
        setServerErrors(result.errors);
        setNotice({ tone: "invalid", text: t("admin.settings.invalid", { count: result.errors.length }) });
      } else setNotice({ tone: "failed", text: t("admin.settings.failed") });
    });
  };

  const words = fold(query.trim()).split(/\s+/).filter(Boolean);
  const visible = (setting: EngineSettingView) =>
    (!onlyChanged || dirty.has(setting.key) || !sameValue(saved[setting.key], setting.default)) &&
    words.every((word) => fold(`${setting.description_fa} ${setting.key}`).includes(word));
  const shown = groups.map((group) => ({ ...group, settings: group.settings.filter(visible) })).filter((group) => group.settings.length > 0);
  const changedCount = settings.filter((setting) => !sameValue(saved[setting.key], setting.default)).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="bg-surface border-line-2 focus-within:border-brand-soft focus-within:ring-ring/30 flex h-11 min-w-0 flex-[1_1_18rem] items-center gap-2 rounded-[14px] border px-3.5 transition-[border-color,box-shadow] focus-within:ring-[3px]">
            <Search className="text-ink-3 size-[18px] shrink-0" strokeWidth={2} aria-hidden />
            <span className="sr-only">{t("admin.settings.search")}</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("admin.settings.search")}
              className="text-ink placeholder:text-ink-3 min-w-0 flex-1 bg-transparent text-[15px] outline-none [&::-webkit-search-cancel-button]:hidden"
            />
            {query ? (
              <button type="button" onClick={() => setQuery("")} className="text-ink-3 hover:text-ink -me-1 rounded-[8px] p-1" aria-label={t("admin.settings.clearSearch")}>
                <X className="size-4" strokeWidth={2} aria-hidden />
              </button>
            ) : null}
          </label>
          <button
            type="button"
            aria-pressed={onlyChanged}
            onClick={() => setOnlyChanged((value) => !value)}
            className={cn(
              "flex h-11 items-center gap-2 rounded-[14px] border px-4 text-[14px] font-bold whitespace-nowrap transition-colors",
              onlyChanged ? "border-brand bg-tint text-brand-text" : "border-line-2 bg-surface text-ink-2 hover:text-ink",
            )}
          >
            {t("admin.settings.engine.onlyChanged")}
            <span className="text-[12.5px] tabular-nums">{formatNumber(changedCount)}</span>
          </button>
        </div>
        <SectionChips
          label={t("admin.settings.engine.groupsLabel")}
          items={shown.map((group) => ({ id: `group-${group.group}`, name: group.name, dirty: group.settings.some((setting) => dirty.has(setting.key)) }))}
        />
      </div>

      {shown.length === 0 ? (
        <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-10 text-center shadow-[var(--shadow-1)]">{t("admin.settings.engine.nothingFound")}</p>
      ) : (
        shown.map((group) => (
          <section key={group.group} id={`group-${group.group}`} aria-labelledby={`group-${group.group}-title`} className="flex scroll-mt-6 flex-col gap-3">
            <h2 id={`group-${group.group}-title`} className="text-ink flex items-baseline gap-2 text-[17px] font-extrabold">
              {group.name}
              <span className="text-ink-3 text-[13px] font-bold tabular-nums">{formatNumber(group.settings.length)}</span>
            </h2>
            <ul className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
              {group.settings.map((setting) => (
                <SettingRow
                  key={setting.key}
                  setting={setting}
                  draft={drafts[setting.key]}
                  savedValue={saved[setting.key]}
                  dirty={dirty.has(setting.key)}
                  error={errors.get(setting.key)}
                  onChange={(draft) => set(setting.key, draft)}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      <SaveBar
        count={dirtyKeys.length}
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
  );
}

function SettingRow({
  setting,
  draft,
  savedValue,
  dirty,
  error,
  onChange,
}: {
  setting: EngineSettingView;
  draft: Draft;
  savedValue: EngineValue;
  dirty: boolean;
  error?: string;
  onChange: (draft: Draft) => void;
}) {
  const id = `setting-${setting.key}`;
  const controlId = setting.type === "weights" ? `${id}-weights` : setting.type === "choice" ? undefined : `${id}-control`;
  const current = valueOf(setting, draft);
  const atDefault = sameValue(current, setting.default);
  const differs = !sameValue(savedValue, setting.default);
  const range =
    setting.type === "bool" || setting.type === "weights" || setting.type === "choice"
      ? null
      : t("admin.settings.engine.range", { min: shownValue(setting, setting.min ?? 0), max: shownValue(setting, setting.max ?? 0) });

  return (
    <li id={id} className={cn("flex scroll-mt-24 flex-col gap-3 px-5 py-4 transition-colors sm:px-6", dirty && "bg-tint/45")}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-[1_1_20rem] flex-col gap-1">
          <label htmlFor={controlId} className="text-ink flex items-start gap-2 text-[14.5px] leading-6 font-bold">
            {differs ? <span className="bg-brand mt-2.5 size-1.5 shrink-0 rounded-full" title={t("admin.settings.engine.notDefault")} aria-hidden /> : null}
            {setting.description_fa}
          </label>
          <p className="text-ink-3 flex flex-wrap items-center gap-x-2 text-[12.5px] leading-5">
            <span className={cn(differs && "text-brand-text font-bold")}>{t("admin.settings.engine.default", { value: shownValue(setting, setting.default) })}</span>
            {range ? <span aria-hidden>·</span> : null}
            {range ? <span>{range}</span> : null}
            <bdi dir="ltr" className="text-ink-3/80 font-mono text-[11.5px]">
              {setting.key}
            </bdi>
          </p>
        </div>
        {/* The weights are typed in the box below; their row has only the reset button, when there is something to reset. */}
        <div className={cn("flex items-center gap-1.5", setting.type === "weights" && atDefault && "hidden")}>
          <Control setting={setting} draft={draft} invalid={Boolean(error)} onChange={onChange} id={`${id}-control`} />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(atDefault && "invisible")}
            aria-hidden={atDefault || undefined}
            tabIndex={atDefault ? -1 : undefined}
            onClick={() => onChange(draftOf(setting, setting.default))}
            aria-label={t("admin.settings.engine.reset", { value: shownValue(setting, setting.default) })}
            title={t("admin.settings.engine.reset", { value: shownValue(setting, setting.default) })}
          >
            <RotateCcw strokeWidth={2} aria-hidden />
          </Button>
        </div>
      </div>
      {setting.type === "weights" ? (
        <textarea
          id={`${id}-weights`}
          dir="ltr"
          value={draft as string}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={Boolean(error) || undefined}
          aria-label={setting.description_fa}
          rows={2}
          className="bg-surface border-line-2 text-ink placeholder:text-ink-3 focus-visible:border-brand-soft focus-visible:ring-ring/30 aria-invalid:border-bad field-sizing-content min-h-[4.5rem] w-full rounded-[14px] border px-3.5 py-2.5 font-mono text-[13px] leading-6 outline-none focus-visible:ring-[3px]"
        />
      ) : null}
      {error ? (
        <p className="text-bad flex items-start gap-1.5 text-[13px] leading-6 font-bold" role="alert">
          <CircleAlert className="mt-1 size-4 shrink-0" strokeWidth={2} aria-hidden />
          {error}
        </p>
      ) : null}
    </li>
  );
}

function Control({ setting, draft, invalid, onChange, id }: { setting: EngineSettingView; draft: Draft; invalid: boolean; onChange: (draft: Draft) => void; id: string }) {
  if (setting.type === "bool")
    return (
      <span className="flex items-center gap-2.5">
        <span className={cn("text-[13px] font-bold", draft ? "text-brand-text" : "text-ink-3")}>{t(draft ? "admin.settings.engine.on" : "admin.settings.engine.off")}</span>
        <Toggle id={id} checked={draft === true} onChange={onChange} label={setting.description_fa} />
      </span>
    );
  if (setting.type === "choice")
    return (
      <Segmented
        value={String(draft)}
        onChange={(value) => onChange(Number(value))}
        options={(setting.options ?? []).map((option) => ({ value: String(option), label: formatNumber(option) }))}
        label={setting.description_fa}
      />
    );
  if (setting.type === "weights") return null;
  return (
    <span className="relative flex items-center">
      <input
        id={id}
        dir="ltr"
        inputMode={setting.type === "int" || setting.type === "optional_int" ? "numeric" : "decimal"}
        autoComplete="off"
        value={draft as string}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={invalid || undefined}
        placeholder={setting.type === "optional_int" ? t("admin.settings.engine.emptyShort") : undefined}
        className={cn(
          "bg-surface border-line-2 text-ink placeholder:text-ink-3 focus-visible:border-brand-soft focus-visible:ring-ring/30 aria-invalid:border-bad h-10 w-28 rounded-[12px] border px-3 text-center text-[16px] font-bold tabular-nums outline-none transition-[border-color,box-shadow] focus-visible:ring-[3px]",
          // The field reads left to right; «٪» follows the number on its left, as Persian writes «۵۵٪».
          setting.type === "ratio" && "pr-3 pl-7",
        )}
      />
      {setting.type === "ratio" ? (
        <span className="text-ink-3 pointer-events-none absolute left-3 text-[14px] font-bold" aria-hidden>
          ٪
        </span>
      ) : null}
    </span>
  );
}

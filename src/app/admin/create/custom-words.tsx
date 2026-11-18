"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { SubmitButton } from "@/components/admin/submit-button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { startBatch } from "./actions";

const MAX = 1000;
const countWords = (text: string) => new Set(text.split(/\r?\n|[،,;؛]/).map((line) => line.trim().toLowerCase()).filter(Boolean)).size;

/**
 * «کلمه‌های دلخواه» (owner's choice, DECISIONS.md): any words or phrases, one per line, made into a word
 * list batch like the frequency list's, optionally all of one level.
 */
export function CustomWords({ language, levels }: { language: string; levels: string[] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const count = countWords(text);
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="text-brand-text hover:bg-tint flex h-11 w-fit items-center gap-1.5 rounded-[12px] px-3 text-[14px] font-bold transition-colors"
      >
        <ChevronDown className={cn("size-4 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} strokeWidth={2.25} aria-hidden />
        {t("admin.create.custom.open")}
      </button>
      {open ? (
        <form action={startBatch} className="flex flex-col gap-3">
          <input type="hidden" name="kind" value="word-list" />
          <input type="hidden" name="language" value={language} />
          <label className="flex flex-col gap-1.5">
            <span className="text-ink-2 text-[13px] font-bold">{t("admin.create.custom.label")}</span>
            <textarea
              name="words"
              dir="ltr"
              lang={language}
              rows={6}
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder={t("admin.create.custom.placeholder")}
              className="bg-surface border-line-2 text-ink focus-visible:border-brand-soft focus-visible:ring-ring/30 lat min-h-36 rounded-[16px] border px-4 py-3 text-[16px] leading-7 outline-none focus-visible:ring-[3px]"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-ink-2 flex items-center gap-2 text-[13px] font-bold">
              {t("admin.create.custom.level")}
              <select
                name="level"
                defaultValue=""
                className="bg-surface border-line-2 text-ink h-11 rounded-[12px] border px-3 text-[14px] font-bold outline-none focus-visible:ring-[3px]"
              >
                <option value="">{t("admin.create.custom.levelAuto")}</option>
                {levels.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
            <span className="text-ink-3 text-[13px] tabular-nums">{t("admin.create.custom.count", { count })}</span>
            <SubmitButton variant="secondary" className="ms-auto" disabled={count === 0 || count > MAX}>
              {t("admin.create.custom.action")}
            </SubmitButton>
          </div>
          {count > MAX ? (
            <p role="alert" className="text-bad text-[13px] font-bold">
              {t("admin.create.custom.tooMany", { max: MAX })}
            </p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}

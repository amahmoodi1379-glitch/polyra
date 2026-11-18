"use client";

import { useState } from "react";
import { NumberBox } from "@/components/admin/number-box";
import { SubmitButton } from "@/components/admin/submit-button";
import { formatNumber, t } from "@/i18n";
import { startBatch } from "./actions";

/**
 * One row's «ساخت…» button. A kind with a batch size also has «چند تا؟»: the number is the teacher's
 * (owner's choice), from 1 to `max`; the button's words follow it.
 */
export function StartForm({
  slug,
  language,
  level,
  label,
  primary,
  size,
}: {
  slug: string;
  language: string;
  level?: string;
  /** With `{size}` where the number goes, when the row has a size. */
  label: string;
  primary: boolean;
  size?: { value: number; max: number };
}) {
  const [count, setCount] = useState(size?.value ?? 0);
  const valid = !size || (Number.isInteger(count) && count >= 1 && count <= size.max);
  return (
    <form action={startBatch} className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
      <input type="hidden" name="kind" value={slug} />
      <input type="hidden" name="language" value={language} />
      {level ? <input type="hidden" name="level" value={level} /> : null}
      <div className="flex items-center gap-2">
        {size ? (
          <label className="text-ink-2 flex items-center gap-2 text-[13px] font-bold">
            {t("admin.create.size")}
            <NumberBox value={count} onChange={setCount} invalid={!valid} label={t("admin.create.size")} className="h-11 w-[4.5rem]" />
            <input type="hidden" name="size" value={valid ? String(count) : ""} />
          </label>
        ) : null}
        <SubmitButton variant={primary ? "default" : "secondary"} className="flex-1 sm:flex-none" disabled={!valid}>
          {label.replace("{size}", formatNumber(valid ? count : (size?.value ?? 0)))}
        </SubmitButton>
      </div>
      {size && !valid ? (
        <p role="alert" className="text-bad text-[12.5px] font-bold">
          {t("admin.create.sizeRange", { max: size.max })}
        </p>
      ) : null}
    </form>
  );
}

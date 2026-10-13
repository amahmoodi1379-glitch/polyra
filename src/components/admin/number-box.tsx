"use client";

import { useState } from "react";
import { plainDigits, typedNumber } from "@/lib/digits";
import { cn } from "@/lib/utils";

const parse = (text: string) => {
  const plain = plainDigits(text);
  return /^-?\d+(\.\d+)?$/.test(plain) ? Number(plain) : Number.NaN;
};
const sameNumber = (a: number, b: number) => a === b || (Number.isNaN(a) && Number.isNaN(b));

/**
 * A whole number typed with Persian or Latin digits. What cannot be read gives NaN, which the save
 * refuses with a message; the field keeps the teacher's own text until it reads as the value again.
 */
export function NumberBox({
  value,
  onChange,
  id,
  invalid,
  label,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  id?: string;
  invalid?: boolean;
  label?: string;
  className?: string;
}) {
  const [text, setText] = useState(() => (Number.isFinite(value) ? typedNumber(value) : ""));
  const shown = sameNumber(parse(text), value) ? text : Number.isFinite(value) ? typedNumber(value) : text;
  return (
    <input
      id={id}
      dir="ltr"
      inputMode="numeric"
      autoComplete="off"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={shown}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parse(event.target.value));
      }}
      className={cn(
        "bg-surface border-line-2 text-ink focus-visible:border-brand-soft focus-visible:ring-ring/30 aria-invalid:border-bad h-10 w-20 min-w-0 rounded-[12px] border px-2 text-center text-[15px] font-bold tabular-nums outline-none transition-[border-color,box-shadow] focus-visible:ring-[3px]",
        className,
      )}
    />
  );
}

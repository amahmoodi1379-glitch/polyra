/**
 * Iranian mobile numbers. Stored as E.164 (+989XXXXXXXXX). People type them in many ways:
 * Persian or Arabic digits, spaces, dashes, a leading 0, 98, +98 or 0098.
 */

const PERSIAN_ZERO = 0x06f0;
const ARABIC_ZERO = 0x0660;

/** Replaces Persian and Arabic-Indic digits with ASCII digits. */
export function toAsciiDigits(input: string): string {
  return input.replace(/[۰-۹٠-٩]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= PERSIAN_ZERO ? code - PERSIAN_ZERO : code - ARABIC_ZERO);
  });
}

/** Returns +989XXXXXXXXX, or null when the input is not an Iranian mobile number. */
export function normalizeMobile(input: string): string | null {
  let digits = toAsciiDigits(input).replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("0098")) digits = digits.slice(4);
  else if (digits.startsWith("98")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  if (!/^9\d{9}$/.test(digits)) return null;
  return `+98${digits}`;
}

/** 0912 345 6789, in Persian digits, for display. */
export function formatMobileFa(e164: string): string {
  const local = `0${e164.replace(/^\+98/, "")}`;
  const grouped = `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`;
  return grouped.replace(/\d/g, (d) => String.fromCharCode(PERSIAN_ZERO + Number(d)));
}

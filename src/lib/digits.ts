const PERSIAN_ZERO = 0x06f0;

/** Writes ASCII digits as Persian digits, leaving everything else as it is. */
export function toPersianDigits(input: string | number): string {
  return String(input).replace(/\d/g, (d) => String.fromCharCode(PERSIAN_ZERO + Number(d)));
}

/** 118 seconds -> "۱:۵۸". */
export function formatClockFa(totalSeconds: number): string {
  const seconds = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return toPersianDigits(`${m}:${String(s).padStart(2, "0")}`);
}

const ASCII_ZERO = 48;

/** Persian or Arabic digits and decimal marks as plain ASCII, so «۵۵٫۵» reads as "55.5". */
export function plainDigits(text: string): string {
  return text
    .replace(/[۰-۹]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - PERSIAN_ZERO + ASCII_ZERO))
    .replace(/[٠-٩]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0x0660 + ASCII_ZERO))
    .replace(/[٫,،/]/g, ".")
    .replace(/[\s٪%]/g, "");
}

/** A number as typed into a Persian field: Persian digits and the Persian decimal mark. */
export const typedNumber = (value: number) => toPersianDigits(String(value)).replace(".", "٫");

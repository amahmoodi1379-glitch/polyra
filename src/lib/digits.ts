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

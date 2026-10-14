/**
 * CSV for the panel's «خروجی» and the word file import (PRD §13.2, §14.7): UTF-8, header row first.
 * Files start with a byte order mark so Excel opens Persian text as UTF-8; reading drops it again.
 */
export type CsvCell = string | number | boolean | null | undefined;

const needsQuotes = /[",;\t\r\n]|^\s|\s$/;

function cell(value: CsvCell) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return needsQuotes.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: CsvCell[][]): string {
  return "\uFEFF" + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}

/**
 * Reads CSV text into rows of cells (RFC 4180: quoted cells may hold commas, quotes and line breaks).
 * A spreadsheet saved with ";" or tabs between cells is read too: the separator is the one the header
 * line uses most. Blank lines are dropped.
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, "");
  const separator = guessSeparator(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  let i = 0;
  const endRow = () => {
    row.push(value);
    if (row.some((item) => item.trim() !== "")) rows.push(row);
    row = [];
    value = "";
  };
  while (i < source.length) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          value += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else value += char;
      i++;
      continue;
    }
    if (char === '"' && value.trim() === "") {
      quoted = true;
      value = "";
    } else if (char === separator) {
      row.push(value);
      value = "";
    } else if (char === "\r" || char === "\n") {
      endRow();
      if (char === "\r" && source[i + 1] === "\n") i++;
    } else value += char;
    i++;
  }
  if (value !== "" || row.length > 0) endRow();
  return rows;
}

function guessSeparator(text: string) {
  const header = text.slice(0, text.search(/\r|\n|$/));
  const counts = [",", ";", "\t"].map((separator) => ({ separator, count: header.split(separator).length - 1 }));
  const best = counts.reduce((top, item) => (item.count > top.count ? item : top));
  return best.count > 0 ? best.separator : ",";
}

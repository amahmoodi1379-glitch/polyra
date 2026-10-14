/**
 * The small markup the panel guide's texts use in fa.json (PRD §13.2 «راهنمای ادمین»), so the
 * guide can name a button or link a page without any HTML in the strings:
 *
 * - a blank line starts a new block; a block whose lines all start with "- " is a list, "1. " a numbered list
 * - `**bold**`, `[[a button's label]]`, `{{page}}` (a panel page, linked), `_word_` (French or German), `` `code` ``
 */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "button"; text: string }
  | { kind: "page"; page: string }
  | { kind: "word"; text: string }
  | { kind: "code"; text: string };

export type Block = { kind: "p"; inline: Inline[] } | { kind: "ul" | "ol"; items: Inline[][] };

const inlinePattern = /\*\*(.+?)\*\*|\[\[(.+?)\]\]|\{\{(\w+)\}\}|_([^_\n]+)_|`([^`\n]+)`/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(inlinePattern)) {
    if (match.index > last) out.push({ kind: "text", text: text.slice(last, match.index) });
    const [, bold, button, page, word, code] = match;
    if (bold !== undefined) out.push({ kind: "bold", children: parseInline(bold) });
    else if (button !== undefined) out.push({ kind: "button", text: button });
    else if (page !== undefined) out.push({ kind: "page", page });
    else if (word !== undefined) out.push({ kind: "word", text: word });
    else out.push({ kind: "code", text: code });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}

const bullet = /^- /;
const numbered = /^\d+\.\s/;

export function parseBlocks(text: string): Block[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block): Block => {
      const lines = block.split("\n").map((line) => line.trim());
      if (lines.every((line) => bullet.test(line))) return { kind: "ul", items: lines.map((line) => parseInline(line.replace(bullet, ""))) };
      if (lines.every((line) => numbered.test(line))) return { kind: "ol", items: lines.map((line) => parseInline(line.replace(numbered, ""))) };
      return { kind: "p", inline: parseInline(lines.join(" ")) };
    });
}

/** Every `{{page}}` named in a text, so a test can check each one has a link. */
export function pagesIn(text: string): string[] {
  return [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1]);
}

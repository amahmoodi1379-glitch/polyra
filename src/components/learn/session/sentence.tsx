"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { Gloss, SentenceView } from "@/engine/ex";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * A sentence of the target language with its blanks (PRD §5.6) and touchable words (PRD §5.9): a tap
 * on a word shows its meaning above it, a name says «اسم خاص», a number is read in Persian.
 */

export type Fill = { text: string; state: "pick" | "ok" | "bad" } | null;

type Open = { key: string; text: string; x: number; y: number } | null;

function glossText(gloss: Gloss, surface: string): string | null {
  if (gloss.kind === "name") return t("learn.session.properName");
  if (gloss.kind === "number") return gloss.meaning ?? (/^\d+$/.test(surface) ? formatNumber(Number(surface)) : null);
  return gloss.meaning;
}

/** One text piece cut at its touchable words; `from` is where it starts in the whole sentence. */
function pieces(text: string, from: number, glosses: Gloss[], open: Open, show: (key: string, value: string, el: HTMLElement) => void, onTap?: (gloss: Gloss) => void) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const gloss of glosses) {
    const start = gloss.start - from;
    const end = gloss.end - from;
    if (end <= 0 || start >= text.length || start < at) continue;
    const surface = text.slice(start, end);
    const meaning = glossText(gloss, surface);
    if (!meaning) continue;
    if (start > at) out.push(text.slice(at, start));
    const key = `${gloss.start}`;
    out.push(
      <span
        key={key}
        className="gl"
        role="button"
        tabIndex={0}
        aria-expanded={open?.key === key}
        onClick={(event) => {
          show(key, meaning, event.currentTarget);
          onTap?.(gloss);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          show(key, meaning, event.currentTarget);
        }}
      >
        {surface}
      </span>,
    );
    at = end;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

export function SentenceLine({
  view,
  fills = [],
  small,
  language,
  touch = true,
  onTap,
  onBlank,
}: {
  view: SentenceView;
  fills?: Fill[];
  small?: boolean;
  language: string;
  touch?: boolean;
  onTap?: (gloss: Gloss) => void;
  onBlank?: (index: number) => void;
}) {
  const [open, setOpen] = useState<Open>(null);
  useEffect(() => {
    if (!open) return;
    const hide = () => setOpen(null);
    const timer = window.setTimeout(hide, 2600);
    window.addEventListener("scroll", hide, { passive: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", hide);
    };
  }, [open]);
  const show = (key: string, text: string, el: HTMLElement) => {
    const box = el.getBoundingClientRect();
    setOpen(open?.key === key ? null : { key, text, x: box.left + box.width / 2, y: box.top });
  };

  // Where each segment starts in the sentence text, a blank counted by its size.
  const sizes = view.segments.map((segment) => (segment.t === "text" ? segment.s.length : segment.size));
  const starts = sizes.map((_, index) => sizes.slice(0, index).reduce((sum, size) => sum + size, 0));
  const glosses = touch ? view.glosses : [];
  return (
    <>
      <p className={cn("ex-sentence lat", small && "sm")} lang={language} dir="ltr">
        {view.segments.map((segment, index) => {
          if (segment.t === "text") return <span key={index}>{pieces(segment.s, starts[index], glosses, open, show, onTap)}</span>;
          const fill = fills[segment.i] ?? null;
          const label = view.segments.filter((item) => item.t === "blank").length > 1 ? t("learn.session.blankN", { n: segment.i + 1 }) : t("learn.session.blank");
          const body = fill ? fill.text : segment.first ? <span className="first">{segment.first}</span> : null;
          const className = cn("slot", fill && "filled", fill?.state);
          return onBlank ? (
            <button key={index} type="button" className={className} aria-label={label} onClick={() => onBlank(segment.i)}>
              {body}
            </button>
          ) : (
            <span key={index} className={className} aria-label={fill ? undefined : label}>
              {body}
            </span>
          );
        })}
      </p>
      {open ? (
        <span className="gloss" role="status" style={{ left: open.x, top: open.y }}>
          {open.text}
        </span>
      ) : null}
    </>
  );
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { sfx } from "./sfx";

/**
 * A bottom sheet over an aubergine scrim (DESIGN.md, «Navigation»): it rises with a spring and closes
 * with Escape, a tap on the scrim, or its own button. Focus moves into it and back to the opener.
 */
export function Sheet({ open, onClose, labelledBy, children }: { open: boolean; onClose: () => void; labelledBy: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [entered, setEntered] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  if (open && !mounted) setMounted(true);
  const shown = open && entered;

  useEffect(() => {
    if (open) {
      opener.current = document.activeElement;
      sfx("bloom", 0.35);
      const frame = requestAnimationFrame(() => {
        setEntered(true);
        const first = sheet.current?.querySelector<HTMLElement>("[data-autofocus], button, a, input");
        first?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
    const timer = window.setTimeout(() => {
      setMounted(false);
      setEntered(false);
    }, 300);
    if (opener.current instanceof HTMLElement) opener.current.focus({ preventScroll: true });
    opener.current = null;
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;
  return (
    <div
      className={shown ? "scrim open" : "scrim"}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={sheet}>
        <span className="grab" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}

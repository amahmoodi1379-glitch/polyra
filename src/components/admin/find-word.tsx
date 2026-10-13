"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Search } from "lucide-react";
import type { Pos } from "@/generated/prisma/client";
import { findWords } from "@/app/admin/resolve/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import type { WordRef } from "@/server/content/resolve";

const posLabel = (pos: Pos) => t(`content.pos.${pos}` as MessageKey);

function Lat({ language, children, className }: { language: string; children: React.ReactNode; className?: string }) {
  return (
    <span dir="ltr" lang={language} className={cn("lat text-[1.08em] font-semibold", className)}>
      {children}
    </span>
  );
}

/** Finds a vocabulary word as the admin types: its French or German form, or its Persian meaning. */
export function FindWord({ language, onPick, onCancel }: { language: string; onPick: (word: WordRef) => void; onCancel: () => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WordRef[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const ticket = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function change(value: string) {
    setQuery(value);
    window.clearTimeout(timer.current);
    const text = value.trim();
    const mine = ++ticket.current;
    if (!text) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = window.setTimeout(async () => {
      const found = await findWords(language, text).catch(() => []);
      if (mine !== ticket.current) return;
      setResults(found);
      setSearching(false);
    }, 220);
  }

  return (
    <div className="border-line-2 animate-in fade-in slide-in-from-top-1 flex flex-col gap-3 rounded-[18px] border p-4 duration-200 motion-reduce:animate-none sm:p-5">
      <label htmlFor={`${id}-query`} className="text-ink text-[14.5px] font-bold">
        {t("admin.resolve.search.label")}
      </label>
      <div className="relative max-w-md">
        <Search className="text-ink-3 pointer-events-none absolute start-4 top-1/2 size-[18px] -translate-y-1/2" strokeWidth={2} aria-hidden />
        <Input
          id={`${id}-query`}
          type="text"
          enterKeyHint="search"
          dir="auto"
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={60}
          value={query}
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
          }}
          placeholder={t("admin.resolve.search.placeholder")}
          aria-describedby={`${id}-status`}
          className="px-11"
        />
      </div>
      <p id={`${id}-status`} aria-live="polite" className="text-ink-3 flex items-center gap-1.5 text-[13.5px] leading-6 empty:-mt-3">
        {searching ? (
          <>
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden />
            {t("admin.resolve.search.searching")}
          </>
        ) : results && results.length === 0 ? (
          t("admin.resolve.search.none")
        ) : null}
      </p>
      {results && results.length > 0 ? (
        <ul className="-mx-2 flex flex-col">
          {results.map((word) => (
            <li key={word.id}>
              <button
                type="button"
                onClick={() => onPick(word)}
                className="hover:bg-tint focus-visible:bg-tint focus-visible:ring-ring/45 flex min-h-12 w-full items-baseline gap-3 rounded-[12px] px-3 py-2.5 text-start transition-colors duration-150 outline-none focus-visible:ring-[3px]"
              >
                <Lat language={language} className="text-ink shrink-0 text-[17px]">
                  {word.lemma}
                </Lat>
                <span className="text-ink-3 shrink-0 text-[13px]">{posLabel(word.pos)}</span>
                <span className="text-ink-2 min-w-0 flex-1 truncate text-[14.5px]">{word.meaning_fa ?? ""}</span>
                <span className="lat text-ink-3 shrink-0 text-[13px]">{word.level}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

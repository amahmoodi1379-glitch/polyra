"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, CircleDashed, LoaderCircle, Search, X } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { contentStatuses } from "@/server/content/library/slugs";
import { libraryHref, type LibraryState } from "./links";

/** Search, level, status and «فقط ناقص‌ها» above the list. Every change is a new address. */
export function FilterBar({ state, levels, placeholder }: { state: LibraryState; levels: string[]; placeholder: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(state.q ?? "");
  const typed = useRef(false);

  const go = (next: Partial<LibraryState>) => startTransition(() => router.replace(libraryHref({ ...state, page: 1, ...next }), { scroll: false }));

  useEffect(() => {
    if (!typed.current) return;
    const timer = setTimeout(() => go({ q: q.trim() }), 350);
    return () => clearTimeout(timer);
    // Only the typed text starts a search; the rest of the state comes from the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const filtered = Boolean(state.level || state.status || state.incomplete || state.q);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-[1_1_18rem]">
          <span className="sr-only">{placeholder}</span>
          <Search className="text-ink-3 pointer-events-none absolute start-4 top-1/2 size-[18px] -translate-y-1/2" strokeWidth={1.75} aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(event) => {
              typed.current = true;
              setQ(event.target.value);
            }}
            placeholder={placeholder}
            className="bg-surface border-line-2 text-ink placeholder:text-ink-3 focus-visible:border-brand-soft focus-visible:ring-ring/30 h-11 w-full rounded-[14px] border ps-11 pe-10 text-[15px] outline-none focus-visible:ring-[3px] [&::-webkit-search-cancel-button]:hidden"
          />
          {pending ? (
            <LoaderCircle className="text-ink-3 absolute end-3.5 top-1/2 size-[18px] -translate-y-1/2 animate-spin motion-reduce:animate-none" aria-hidden />
          ) : q ? (
            <button
              type="button"
              onClick={() => {
                typed.current = true;
                setQ("");
              }}
              className="text-ink-3 hover:text-ink absolute end-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-[10px]"
            >
              <X className="size-4" strokeWidth={2} aria-hidden />
              <span className="sr-only">{t("admin.library.filters.clear")}</span>
            </button>
          ) : null}
        </label>

        <div className="relative">
          <select
            aria-label={t("admin.library.filters.status")}
            value={state.status ?? ""}
            onChange={(event) => go({ status: (event.target.value || null) as LibraryState["status"] })}
            className={cn(
              "border-line-2 bg-surface h-11 appearance-none rounded-[14px] border ps-4 pe-10 text-[14px] font-bold outline-none",
              "focus-visible:border-brand-soft focus-visible:ring-ring/30 focus-visible:ring-[3px]",
              state.status ? "text-brand-text" : "text-ink-2",
            )}
          >
            <option value="">{t("admin.library.filters.allStatuses")}</option>
            {[...contentStatuses, "suspended" as const].map((status) => (
              <option key={status} value={status}>
                {t(`admin.library.statuses.${status}`)}
              </option>
            ))}
          </select>
          <ChevronDown className="text-ink-3 pointer-events-none absolute end-3.5 top-1/2 size-4 -translate-y-1/2" aria-hidden />
        </div>

        <button
          type="button"
          aria-pressed={state.incomplete ? "true" : "false"}
          onClick={() => go({ incomplete: !state.incomplete })}
          className={cn(
            "flex h-11 items-center gap-2 rounded-[14px] border px-3.5 text-[14px] font-bold transition-[background-color,color,border-color] duration-150",
            state.incomplete ? "bg-tint text-brand-text border-transparent" : "border-line-2 bg-surface text-ink-2 hover:text-ink",
          )}
        >
          <CircleDashed className="size-[18px]" strokeWidth={1.75} aria-hidden />
          {t("admin.library.filters.incomplete")}
        </button>
      </div>

      {levels.length > 0 || filtered ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {levels.length > 0 ? (
            <nav aria-label={t("admin.library.filters.level")} className="bg-tint flex gap-1 rounded-[14px] p-1">
              {[null, ...levels].map((level) => (
                <Link
                  key={level ?? "all"}
                  href={libraryHref({ ...state, level, page: 1 })}
                  scroll={false}
                  aria-current={(state.level ?? null) === level ? "page" : undefined}
                  className={cn(
                    "flex h-8 items-center rounded-[10px] px-3 text-[13px] font-bold transition-[background-color,color,box-shadow] duration-150",
                    (state.level ?? null) === level ? "bg-surface dark:bg-tint-2 text-brand-text shadow-[var(--shadow-1)]" : "text-ink-2 hover:text-ink",
                  )}
                >
                  {level ? <bdi className="lat text-[14px] font-semibold">{level}</bdi> : t("admin.library.filters.allLevels")}
                </Link>
              ))}
            </nav>
          ) : (
            <span />
          )}
          {filtered ? (
            <Link
              href={libraryHref({ language: state.language, type: state.type })}
              scroll={false}
              onClick={() => {
                typed.current = false;
                setQ("");
              }}
              className="text-ink-3 hover:text-ink flex h-8 items-center gap-1.5 rounded-[10px] px-2 text-[13px] font-bold"
            >
              <X className="size-3.5" strokeWidth={2} aria-hidden />
              {t("admin.library.filters.clear")}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

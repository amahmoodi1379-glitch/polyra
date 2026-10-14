"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, Search, X } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { errorKinds, type ErrorKind } from "@/server/error-report";
import { errorsHref, type ErrorsState } from "./links";

/** Search and «همه / سرور / مرورگر» above the list. Every change is a new address. */
export function ErrorsFilter({ state, counts }: { state: ErrorsState; counts: Record<ErrorKind | "all", number> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(state.q);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) return;
    const timer = setTimeout(() => startTransition(() => router.replace(errorsHref({ kind: state.kind, q: q.trim() }), { scroll: false })), 350);
    return () => clearTimeout(timer);
    // Only the typed text starts a search; the tab comes from the address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative min-w-0 flex-[1_1_18rem]">
        <span className="sr-only">{t("admin.errors.search")}</span>
        <Search className="text-ink-3 pointer-events-none absolute start-4 top-1/2 size-[18px] -translate-y-1/2" strokeWidth={1.75} aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(event) => {
            typed.current = true;
            setQ(event.target.value);
          }}
          placeholder={t("admin.errors.search")}
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
            <span className="sr-only">{t("admin.errors.clear")}</span>
          </button>
        ) : null}
      </label>

      <nav aria-label={t("admin.errors.kindsLabel")} className="bg-tint flex gap-1 rounded-[14px] p-1">
        {[null, ...errorKinds].map((kind) => {
          const current = state.kind === kind;
          return (
            <Link
              key={kind ?? "all"}
              href={errorsHref({ kind, q: state.q })}
              scroll={false}
              aria-current={current ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-[10px] px-3 text-[13.5px] font-bold whitespace-nowrap transition-[background-color,color,box-shadow] duration-150",
                current ? "bg-surface dark:bg-tint-2 text-brand-text shadow-[var(--shadow-1)]" : "text-ink-2 hover:text-ink",
              )}
            >
              {t(kind ? `admin.errors.kinds.${kind}` : "admin.errors.kinds.all")}
              <span className={cn("text-[12px] tabular-nums", current ? "text-brand-text/70" : "text-ink-3")}>{t("admin.errors.count", { count: counts[kind ?? "all"] })}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

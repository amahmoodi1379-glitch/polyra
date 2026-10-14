"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Search, X } from "lucide-react";
import { t } from "@/i18n";

const href = (q: string) => (q ? `/admin/users?${new URLSearchParams({ q })}` : "/admin/users");

/** The phone search: each pause in typing is a new address, so a search can be shared or reloaded. */
export function UsersSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(initial);
  const typed = useRef(false);

  useEffect(() => {
    if (!typed.current) return;
    const timer = setTimeout(() => startTransition(() => router.replace(href(q.trim()), { scroll: false })), 350);
    return () => clearTimeout(timer);
  }, [q, router]);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="relative max-w-[30rem]">
        <span className="sr-only">{t("admin.users.search")}</span>
        <Search className="text-ink-3 pointer-events-none absolute start-4 top-1/2 size-[18px] -translate-y-1/2" strokeWidth={1.75} aria-hidden />
        {/* A number reads left to right; inside a right-to-left field its groups would show reversed.
            The panel is right-to-left, so the icon sits on the right and the clear button on the left. */}
        <input
          type="search"
          dir="ltr"
          inputMode="tel"
          autoComplete="off"
          value={q}
          onChange={(event) => {
            typed.current = true;
            setQ(event.target.value);
          }}
          placeholder={t("admin.users.search")}
          className="bg-surface border-line-2 text-ink placeholder:text-ink-3 focus-visible:border-brand-soft focus-visible:ring-ring/30 h-12 w-full rounded-[14px] border pr-11 pl-10 text-right text-[16px] tabular-nums shadow-[var(--shadow-1)] outline-none focus-visible:ring-[3px] [&::-webkit-search-cancel-button]:hidden"
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
            <span className="sr-only">{t("admin.users.clear")}</span>
          </button>
        ) : null}
      </label>
      <p className="text-ink-3 text-[12.5px]">{t("admin.users.searchHint")}</p>
    </div>
  );
}

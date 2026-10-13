"use client";

import { useEffect } from "react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type Notice = { tone: "saved" | "invalid" | "failed"; text: string };

/**
 * The bar at the foot of a settings page: how many changes wait, «برگرداندن» and «ذخیره». Leaving the
 * page with unsaved changes asks first.
 */
export function SaveBar({ count, notice, pending, onUndo, onSave }: { count: number; notice: Notice | null; pending: boolean; onUndo: () => void; onSave: () => void }) {
  useEffect(() => {
    if (count === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [count]);

  return (
    <div
      className={cn(
        "bg-glass border-line sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-[20px] border p-2 ps-4 shadow-[var(--shadow-2)] backdrop-blur-md transition-opacity",
        count === 0 && !notice && "opacity-90",
      )}
    >
      <div className="me-auto flex min-w-0 flex-col py-1" role="status" aria-live="polite">
        {notice ? (
          <span className={cn("flex items-center gap-1.5 text-[14px] font-bold", notice.tone === "saved" ? "text-ink" : "text-bad")}>
            {notice.tone === "saved" ? <Check className="size-4" strokeWidth={2.5} aria-hidden /> : <CircleAlert className="size-4" strokeWidth={2} aria-hidden />}
            {notice.text}
          </span>
        ) : (
          <span className="text-ink-3 text-[13.5px]">{count > 0 ? t("admin.settings.unsaved", { count }) : t("admin.library.form.clean")}</span>
        )}
      </div>
      {count > 0 ? (
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onUndo}>
          {t("admin.library.form.undo")}
        </Button>
      ) : null}
      <Button type="button" disabled={count === 0 || pending} onClick={onSave} className="min-w-28">
        {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
        {t("admin.library.form.save")}
      </Button>
    </div>
  );
}

/** The chips at the top that jump to each part of a long settings page; a dot marks unsaved changes. */
export function SectionChips({ label, items }: { label: string; items: { id: string; name: string; dirty: boolean }[] }) {
  return (
    <nav aria-label={label} className="-mx-5 overflow-x-auto px-5 pb-1 lg:mx-0 lg:px-0">
      <ul className="flex w-max gap-1.5 lg:w-auto lg:flex-wrap">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className="text-ink-2 hover:text-ink hover:bg-tint flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] font-bold whitespace-nowrap transition-colors"
            >
              {item.name}
              {item.dirty ? <span className="bg-brand size-1.5 rounded-full" aria-hidden /> : null}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

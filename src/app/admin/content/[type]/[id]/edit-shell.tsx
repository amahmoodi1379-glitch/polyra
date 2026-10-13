"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { FieldError } from "@/server/content/library/edit/types";
import type { LibrarySlug } from "@/server/content/library/slugs";
import { saveItem } from "./actions";
import { FormContext } from "./form-kit";

type Notice = { tone: "saved" | "invalid" | "failed"; text: string; notes?: string[]; general?: string[] };

/**
 * Holds the form's values, saves them and shows what happened (PRD §13.2). The save bar sits at the
 * bottom at the thumb (DESIGN.md «Action area at the thumb») and only wakes when something changed.
 */
export function EditShell({
  slug,
  id,
  language,
  initial,
  readOnly,
  children,
}: {
  slug: LibrarySlug;
  id: number;
  language: string;
  initial: Record<string, unknown>;
  readOnly?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = useMemo(() => JSON.stringify(values) !== JSON.stringify(saved), [values, saved]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = (name: string, value: unknown) => {
    setValues((current) => ({ ...current, [name]: value }));
    if (notice?.tone === "saved") setNotice(null);
  };

  const save = () =>
    startTransition(async () => {
      const result = await saveItem(slug, id, values);
      if (result.state === "saved") {
        setValues(result.values);
        setSaved(result.values);
        setErrors([]);
        setNotice({ tone: "saved", text: t("admin.library.form.saved"), notes: result.notes });
        router.refresh();
      } else if (result.state === "invalid") {
        setErrors(result.errors);
        const general = result.errors.filter((error) => !error.path || !(error.path.split(/[.[]/)[0] in values)).map((error) => error.message);
        setNotice({ tone: "invalid", text: t("admin.library.form.invalid", { count: result.errors.length }), general });
        requestAnimationFrame(() => {
          const first = result.errors.find((error) => error.path)?.path.split(/[.[]/)[0];
          document.querySelector(`[data-field="${first}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      } else {
        setNotice({ tone: "failed", text: t(result.state === "gone" ? "admin.library.form.gone" : "admin.library.result.failed") });
      }
    });

  return (
    <FormContext.Provider value={{ values, set, errors, language, slug }}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
        className="flex flex-col gap-4"
      >
        <fieldset disabled={readOnly} className="bg-surface min-w-0 rounded-[22px] shadow-[var(--shadow-1)] disabled:opacity-80">
          {children}
        </fieldset>

        {readOnly ? null : (
        <div
          className={cn(
            "bg-glass border-line sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-[20px] border p-2 ps-4 shadow-[var(--shadow-2)] backdrop-blur-md transition-opacity",
            !dirty && !notice && "opacity-90",
          )}
        >
          <div className="me-auto flex min-w-0 flex-col py-1" role="status" aria-live="polite">
            {notice ? (
              <>
                <span
                  className={cn(
                    "flex items-center gap-1.5 text-[14px] font-bold",
                    notice.tone === "saved" ? "text-ink" : "text-bad",
                  )}
                >
                  {notice.tone === "saved" ? <Check className="size-4" strokeWidth={2.5} aria-hidden /> : <CircleAlert className="size-4" strokeWidth={2} aria-hidden />}
                  {notice.text}
                </span>
                {[...(notice.general ?? []), ...(notice.notes ?? [])].map((line) => (
                  <span key={line} className="text-ink-2 text-[13px]">
                    {line}
                  </span>
                ))}
              </>
            ) : (
              <span className="text-ink-3 text-[13.5px]">{dirty ? t("admin.library.form.unsaved") : t("admin.library.form.clean")}</span>
            )}
          </div>
          {dirty ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => {
                setValues(saved);
                setErrors([]);
                setNotice(null);
              }}
            >
              {t("admin.library.form.undo")}
            </Button>
          ) : null}
          <Button type="submit" disabled={!dirty || pending} className="min-w-28">
            {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
            {t("admin.library.form.save")}
          </Button>
        </div>
        )}
      </form>
    </FormContext.Provider>
  );
}

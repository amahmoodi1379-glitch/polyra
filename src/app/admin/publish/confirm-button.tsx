"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { cn } from "@/lib/utils";
import type { PublishOutcome } from "./actions";

/**
 * A button on «انتشار» that asks first, runs one server action and says what happened. It stays put
 * across the refresh that follows, so its message is still there when the page has changed.
 */
export function ConfirmButton({
  label,
  icon,
  variant = "default",
  disabled = false,
  title,
  description,
  list,
  listLead,
  confirmLabel,
  run,
}: {
  label: string;
  icon?: ReactNode;
  variant?: "default" | "secondary" | "outline" | "ghost";
  disabled?: boolean;
  title: string;
  description: string;
  list?: string[];
  listLead?: string;
  confirmLabel: string;
  run: () => Promise<PublishOutcome>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<PublishOutcome | null>(null);
  const [pending, startTransition] = useTransition();

  const go = () =>
    startTransition(async () => {
      const outcome = await run();
      setMessage(outcome);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button type="button" variant={variant} disabled={disabled || pending} onClick={() => setOpen(true)}>
        {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : icon}
        {label}
      </Button>
      {message ? (
        <p role="status" className={cn("flex items-center gap-1.5 text-[13.5px] leading-6 font-bold", message.ok ? "text-ink" : "text-bad")}>
          {message.ok ? <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden /> : null}
          {isolateLatin(message.message)}
        </p>
      ) : null}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isolateLatin(title)}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {list?.length ? (
            <div className="bg-idk-soft text-ink flex flex-col gap-1.5 rounded-[14px] px-4 py-3 text-[13.5px] leading-6">
              {listLead ? <p className="font-bold">{listLead}</p> : null}
              <ul className="flex list-disc flex-col gap-0.5 ps-5">
                {list.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.library.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => {
                setOpen(false);
                go();
              }}
            >
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

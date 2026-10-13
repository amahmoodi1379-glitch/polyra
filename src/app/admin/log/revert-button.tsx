"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, LoaderCircle, Undo2 } from "lucide-react";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { revertAction } from "./actions";

/**
 * «برگردان»: asks once, puts the old value back, and says what happened or why it could not. It stays
 * mounted when the row stops being the item's latest change, so the result is still shown after the refresh.
 */
export function RevertButton({ logId, ready }: { logId: number; ready: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () =>
    startTransition(async () => {
      const result = await revertAction(logId);
      if (result.state === "reverted") {
        setMessage({ tone: "ok", text: [t("admin.log.reverted"), ...result.notes].join(" ") });
        router.refresh();
      } else if (result.state === "blocked") {
        setMessage({ tone: "bad", text: t(`admin.log.blocked.${result.reason}`) });
      } else {
        setMessage({ tone: "bad", text: t("admin.log.failed") });
      }
    });

  if (!ready && !message) return <p className="text-ink-3 text-[12.5px]">{t("admin.log.laterHint")}</p>;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {message?.tone === "ok" || !ready ? null : (
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setOpen(true)} className="text-brand-text -ms-2.5">
          {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : <Undo2 strokeWidth={2} aria-hidden />}
          {t("admin.log.revert")}
        </Button>
      )}
      {message ? (
        <p role="status" className={cn("flex items-center gap-1.5 text-[13px] leading-6 font-bold", message.tone === "ok" ? "text-ink" : "text-bad")}>
          {message.tone === "ok" ? <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden /> : null}
          {message.text}
        </p>
      ) : null}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.log.confirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.log.confirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.library.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => {
                setOpen(false);
                run();
              }}
            >
              {t("admin.log.confirmYes")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

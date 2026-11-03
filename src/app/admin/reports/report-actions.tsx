"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { actOnReport, type ReportStep } from "./actions";

/**
 * The four answers to an open report (PRD §13.10): «جواب کاربر هم درست است» where it applies,
 * «اصلاح شد» after the form below is saved (with «حق با زبان‌آموز بود»), «تعلیق» and «رد گزارش»;
 * and its priority by hand.
 */
export function ReportActions({
  id,
  canAccept,
  canBeRight,
  priority,
  suspend,
}: {
  id: number;
  canAccept: boolean;
  /** Only an answer recorded as wrong or «نمی‌دانم» can be put right for the learner. */
  canBeRight: boolean;
  priority: "normal" | "high";
  /** What «تعلیق» takes out, or that it is out already. */
  suspend: "sentence" | "item" | "already" | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [right, setRight] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);

  const run = (step: ReportStep) =>
    startTransition(async () => {
      setMessage(null);
      const outcome = await actOnReport(id, step);
      if (!outcome.ok) {
        setMessage({ text: t(`admin.reports.problem.${outcome.reason}`), bad: true });
        router.refresh();
        return;
      }
      const done =
        step === "accept" ? "accept" : step === "fixed" || step === "fixedRight" ? "fixed" : step === "suspend" ? "suspend" : step === "reject" ? "reject" : "priority";
      setMessage({ text: [t(`admin.reports.done.${done}`), outcome.right ? t("admin.reports.done.right") : ""].filter(Boolean).join(" "), bad: false });
      router.refresh();
    });

  return (
    <section aria-labelledby="report-actions" className="bg-surface flex flex-col gap-5 rounded-[22px] p-5 shadow-[var(--shadow-1)]" data-report-actions>
      <h3 id="report-actions" className="text-ink text-[16px] font-extrabold">
        {t("admin.reports.actions.title")}
      </h3>

      <div className="flex flex-col gap-2">
        <Button type="button" className="w-fit" disabled={pending || !canAccept} onClick={() => run("accept")} data-act="accept">
          {t("admin.reports.actions.accept")}
        </Button>
        <p className="text-ink-2 text-[13.5px] leading-6">{t(canAccept ? "admin.reports.actions.acceptHelp" : "admin.reports.actions.acceptNo")}</p>
      </div>

      <div className="border-line flex flex-col gap-2 border-t pt-4">
        <p className="text-ink text-[15px] font-extrabold">{t("admin.reports.actions.fix")}</p>
        <p className="text-ink-2 text-[13.5px] leading-6">{t("admin.reports.actions.fixHelp")}</p>
        <label className="flex min-h-11 w-fit cursor-pointer items-center gap-2.5 text-[14.5px] font-bold">
          <input type="checkbox" className="accent-brand size-[18px]" checked={right} disabled={!canBeRight} onChange={(event) => setRight(event.target.checked)} data-right />
          <span className={canBeRight ? "text-ink" : "text-ink-3"}>{t("admin.reports.actions.right")}</span>
        </label>
        <p className="text-ink-3 text-[13px] leading-6">{t(canBeRight ? "admin.reports.actions.rightHelp" : "admin.reports.actions.rightNo")}</p>
        <Button type="button" variant="secondary" className="w-fit" disabled={pending} onClick={() => run(right && canBeRight ? "fixedRight" : "fixed")} data-act="fixed">
          {t("admin.reports.actions.fixed")}
        </Button>
      </div>

      <div className="border-line flex flex-col gap-2 border-t pt-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={pending || suspend === null || suspend === "already"} onClick={() => run("suspend")} data-act="suspend">
            {t("admin.reports.actions.suspend")}
          </Button>
          <Button type="button" variant="secondary" disabled={pending} onClick={() => setConfirm(true)} data-act="reject">
            {t("admin.reports.actions.reject")}
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => run(priority === "high" ? "normal" : "high")} data-act="priority">
            {t(priority === "high" ? "admin.reports.actions.normal" : "admin.reports.actions.high")}
          </Button>
          {pending ? <LoaderCircle className="text-ink-3 size-5 self-center animate-spin motion-reduce:animate-none" aria-label={t("admin.library.selection.working")} /> : null}
        </div>
        {suspend ? (
          <p className="text-ink-2 text-[13.5px] leading-6">
            {t(suspend === "sentence" ? "admin.reports.actions.suspendSentence" : suspend === "item" ? "admin.reports.actions.suspendItem" : "admin.reports.actions.suspendedAlready")}
          </p>
        ) : null}
        <p className="text-ink-3 text-[13px] leading-6">{t("admin.reports.actions.priorityHelp")}</p>
      </div>

      {message ? (
        <p role={message.bad ? "alert" : "status"} className={message.bad ? "text-bad text-[14px] font-bold" : "text-ok text-[14px] font-bold"} data-report-message>
          {message.text}
        </p>
      ) : null}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.reports.actions.reject")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.reports.actions.rejectConfirm")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.reports.actions.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirm(false);
                run("reject");
              }}
              data-act="reject-yes"
            >
              {t("admin.reports.actions.rejectYes")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

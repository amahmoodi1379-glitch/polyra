"use client";

import { useEffect, useState } from "react";
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
import type { RemovalSummary } from "@/server/content/library/remove";
import { deleteSelected, previewDelete, type Selection } from "./actions";

type State = { step: "checking" } | { step: "ready" | "deleting"; summary: RemovalSummary } | { step: "failed" };

const PARTS = ["sentences", "targets", "tables", "questions", "exercises"] as const;

/**
 * «حذف» for one item or many (owner's choice, DECISIONS.md): first says exactly what goes with them,
 * then deletes on «حذف کن». Learners' progress on them is named, with «کنار بگذار» as the gentler way.
 */
export function RemoveDialog({
  slug,
  language,
  selection,
  open,
  onClose,
  onDone,
  onRetire,
}: {
  slug: string;
  language: string;
  selection: Selection;
  open: boolean;
  onClose: () => void;
  onDone: (outcome: { deleted: number } | { failed: true }) => void;
  onRetire?: () => void;
}) {
  const [state, setState] = useState<State>({ step: "checking" });
  const key = JSON.stringify(selection);

  useEffect(() => {
    if (!open) return;
    let live = true;
    setState({ step: "checking" });
    void previewDelete(slug, language, JSON.parse(key) as Selection).then((outcome) => {
      if (!live) return;
      setState(outcome.state === "failed" ? { step: "failed" } : { step: "ready", summary: outcome.summary });
    });
    return () => {
      live = false;
    };
  }, [open, slug, language, key]);

  const remove = async () => {
    if (state.step !== "ready") return;
    setState({ step: "deleting", summary: state.summary });
    const outcome = await deleteSelected(slug, language, JSON.parse(key) as Selection);
    onClose();
    onDone(outcome.state === "failed" ? { failed: true } : { deleted: outcome.state === "deleted" ? outcome.summary.items : 0 });
  };

  const summary = state.step === "ready" || state.step === "deleting" ? state.summary : null;
  const parts = summary ? PARTS.filter((part) => summary[part] > 0) : [];

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && state.step !== "deleting" && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("admin.library.remove.title")}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-ink-2 flex flex-col gap-2.5 text-[14.5px] leading-7">
              {state.step === "checking" ? (
                <p className="flex items-center gap-2">
                  <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden />
                  {t("admin.library.remove.checking")}
                </p>
              ) : null}
              {state.step === "failed" ? <p className="text-bad font-bold">{t("admin.library.remove.failed")}</p> : null}
              {summary ? (
                <>
                  <p className="text-ink font-bold">{summary.items > 0 ? t("admin.library.remove.items", { count: summary.items }) : t("admin.library.remove.nothing")}</p>
                  {summary.published > 0 ? <p>{t("admin.library.remove.published", { count: summary.published })}</p> : null}
                  {parts.length > 0 ? (
                    <div>
                      <p>{t("admin.library.remove.with")}</p>
                      <ul className="list-disc ps-5">
                        {parts.map((part) => (
                          <li key={part}>{t(`admin.library.remove.parts.${part}`, { count: summary[part] })}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {summary.candidates > 0 ? <p>{t("admin.library.remove.candidates", { count: summary.candidates })}</p> : null}
                  {summary.learners > 0 ? <p className="text-bad font-bold">{t("admin.library.remove.learners", { count: summary.learners })}</p> : null}
                  {summary.refused.length > 0 ? <p>{t("admin.library.remove.refused", { count: summary.refused.length })}</p> : null}
                  {summary.items > 0 ? <p className="text-ink-3 text-[13.5px]">{t("admin.library.remove.undo")}</p> : null}
                </>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={state.step === "deleting"}>{t("admin.library.cancel")}</AlertDialogCancel>
          {summary && summary.learners > 0 && onRetire ? (
            <Button
              type="button"
              variant="secondary"
              disabled={state.step === "deleting"}
              onClick={() => {
                onClose();
                onRetire();
              }}
            >
              {t("admin.library.remove.retireInstead")}
            </Button>
          ) : null}
          <Button type="button" variant="destructive" disabled={state.step !== "ready" || !summary || summary.items === 0} onClick={() => void remove()}>
            {state.step === "deleting" ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
            {t("admin.library.remove.yes")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

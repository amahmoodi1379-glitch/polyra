"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, MoreHorizontal } from "lucide-react";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { ContentStatus } from "@/generated/prisma/client";
import { t } from "@/i18n";
import type { LibrarySlug, StatusAction } from "@/server/content/library/slugs";
import { libraryHref } from "../../links";
import { applyStatus } from "../../actions";
import { deleteDraft } from "./actions";

/** What can be done to an item in its current state (PRD §13.2, §13.7). */
function actionsFor(status: ContentStatus, suspended: boolean) {
  if (status === "retired") return { main: null, more: [] as StatusAction[] };
  const pause: StatusAction = suspended ? "unsuspend" : "suspend";
  if (status === "published") return { main: null, more: [pause] };
  if (status === "approved") return { main: null, more: ["draft", pause] as StatusAction[] };
  return { main: "approve" as const, more: [pause] };
}

export function ItemActions({
  slug,
  id,
  language,
  status,
  suspended,
}: {
  slug: LibrarySlug;
  id: number;
  language: string;
  status: ContentStatus;
  suspended: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<"retire" | "delete" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const { main, more } = actionsFor(status, suspended);
  if (status === "retired") return null;

  const run = (action: StatusAction) =>
    startTransition(async () => {
      setMessage(null);
      const outcome = await applyStatus(slug, language, [id], action);
      if (outcome.state === "failed") setMessage(t("admin.library.result.failed"));
      else if (outcome.refused.length > 0) setMessage(t(`admin.library.refused.${outcome.refused[0].reason}`));
      router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      setMessage(null);
      const outcome = await deleteDraft(slug, id);
      if (outcome.state === "deleted") {
        router.replace(libraryHref({ language, type: slug }));
        return;
      }
      setMessage(t(`admin.library.item.deleteResult.${outcome.state}`));
    });

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex items-center gap-2">
        {pending ? <LoaderCircle className="text-ink-3 size-5 animate-spin motion-reduce:animate-none" aria-label={t("admin.library.selection.working")} /> : null}
        {main ? (
          <Button type="button" disabled={pending} onClick={() => run(main)}>
            {t(`admin.library.actions.${main}`)}
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary" disabled={pending}>
              <MoreHorizontal strokeWidth={2} aria-hidden />
              {t("admin.library.moreActions")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-56 rounded-[16px] p-1.5">
            {more.map((action) => (
              <DropdownMenuItem key={action} className="h-10 rounded-[10px] px-3 text-[14px] font-bold" onSelect={() => run(action)}>
                {t(`admin.library.actions.${action}`)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-bad focus:text-bad h-10 rounded-[10px] px-3 text-[14px] font-bold" onSelect={() => setConfirm("retire")}>
              {t("admin.library.actions.retire")}
            </DropdownMenuItem>
            {status === "draft" ? (
              <DropdownMenuItem className="text-bad focus:text-bad h-10 rounded-[10px] px-3 text-[14px] font-bold" onSelect={() => setConfirm("delete")}>
                {t("admin.library.item.delete")}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {message ? (
        <p role="alert" className="text-bad max-w-xs text-[13px] leading-6 font-bold sm:text-end">
          {message}
        </p>
      ) : null}

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "delete" ? t("admin.library.item.delete") : t("admin.library.actions.retire")}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "delete" ? t("admin.library.item.confirmDelete") : t("admin.library.confirmRetire", { count: 1 })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.library.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                const what = confirm;
                setConfirm(null);
                if (what === "delete") remove();
                else run("retire");
              }}
            >
              {confirm === "delete" ? t("admin.library.item.confirmDeleteYes") : t("admin.library.confirmRetireYes")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

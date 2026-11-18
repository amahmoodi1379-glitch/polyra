"use client";

import { useState, useTransition } from "react";
import Link from "@/components/admin/link";
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
import { copyableSlugs, type LibrarySlug, type StatusAction } from "@/server/content/library/slugs";
import { reviewHref } from "../../../review/links";
import { itemHref, libraryHref } from "../../links";
import { applyStatus, copyItemAction } from "../../actions";
import { RemoveDialog } from "../../remove-dialog";

/**
 * What can be done to an item in its current state (PRD §13.2, §13.7). An item waiting for review
 * is approved on «بازبینی», so its main button opens it there.
 */
function actionsFor(status: ContentStatus, suspended: boolean): { main: StatusAction | "open" | null; more: StatusAction[] } {
  if (status === "retired") return { main: "unretire", more: [] };
  const pause: StatusAction = suspended ? "unsuspend" : "suspend";
  if (status === "published") return { main: null, more: [pause] };
  if (status === "approved") return { main: null, more: ["review", "draft", pause] };
  if (status === "needs_review") return { main: "open", more: ["draft", pause] };
  return { main: "review", more: [pause] };
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
  const [confirm, setConfirm] = useState<"retire" | null>(null);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { main, more } = actionsFor(status, suspended);

  const copy = () =>
    startTransition(async () => {
      setMessage(null);
      const outcome = await copyItemAction(slug, id);
      if (outcome.state === "copied") router.push(itemHref(slug, outcome.id));
      else setMessage(t("admin.library.add.copyFailed"));
    });

  const run = (action: StatusAction) =>
    startTransition(async () => {
      setMessage(null);
      const outcome = await applyStatus(slug, language, { ids: [id] }, action);
      if (outcome.state === "failed") setMessage(t("admin.library.result.failed"));
      else if (outcome.refused.length > 0) setMessage(t(`admin.library.refused.${outcome.refused[0].reason}`));
    });

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <div className="flex items-center gap-2">
        {pending ? <LoaderCircle className="text-ink-3 size-5 animate-spin motion-reduce:animate-none" aria-label={t("admin.library.selection.working")} /> : null}
        {main === "open" ? (
          <Button asChild>
            <Link href={reviewHref({ language, at: { slug, id } })}>{t("admin.review.openHere")}</Link>
          </Button>
        ) : main ? (
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
            {copyableSlugs.includes(slug) ? (
              <DropdownMenuItem className="h-10 rounded-[10px] px-3 text-[14px] font-bold" onSelect={copy}>
                {slug === "words" ? t("admin.library.add.copyWord") : t("admin.library.add.copy")}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            {status === "retired" ? null : (
              <DropdownMenuItem className="text-bad focus:text-bad h-10 rounded-[10px] px-3 text-[14px] font-bold" onSelect={() => setConfirm("retire")}>
                {t("admin.library.actions.retire")}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-bad focus:text-bad h-10 rounded-[10px] px-3 text-[14px] font-bold" onSelect={() => setRemoving(true)}>
              {t("admin.library.item.delete")}
            </DropdownMenuItem>
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
            <AlertDialogTitle>{t("admin.library.actions.retire")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.library.confirmRetire", { count: 1 })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.library.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirm(null);
                run("retire");
              }}
            >
              {t("admin.library.confirmRetireYes")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RemoveDialog
        slug={slug}
        language={language}
        selection={{ ids: [id] }}
        open={removing}
        onClose={() => setRemoving(false)}
        onRetire={status === "retired" ? undefined : () => run("retire")}
        onDone={(outcome) => {
          if ("failed" in outcome) setMessage(t("admin.library.remove.failed"));
          else if (outcome.deleted > 0) router.replace(libraryHref({ language, type: slug }));
          else setMessage(t("admin.library.remove.nothing"));
        }}
      />
    </div>
  );
}

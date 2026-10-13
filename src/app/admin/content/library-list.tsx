"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, CircleDashed, LoaderCircle, MoreHorizontal, X } from "lucide-react";
import { joinDots } from "@/components/admin/join-dots";
import { LevelChip, StatusChip } from "@/components/admin/status-chip";
import { Voiced } from "@/components/admin/voiced";
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
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { cn } from "@/lib/utils";
import type { LibraryPage, LibraryRow } from "@/server/content/library/list";
import type { LibrarySlug, StatusAction } from "@/server/content/library/slugs";
import { applyStatus } from "./actions";
import { itemHref, libraryHref, type LibraryState } from "./links";

type Notice = { tone: "done" | "failed"; text: string; refused: { title: string; reason: string }[] };

/** One page of items with selection and status changes for the selected ones (PRD §13.2). */
export function LibraryList({
  language,
  type,
  page,
  state,
  emptyText,
}: {
  language: string;
  type: LibrarySlug;
  page: LibraryPage;
  state: LibraryState;
  emptyText: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [confirmRetire, setConfirmRetire] = useState(false);
  const [pending, startTransition] = useTransition();
  const ids = page.rows.map((row) => row.id);
  const allOn = ids.length > 0 && ids.every((id) => selected.has(id));

  const toggle = (id: number, on: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const run = (action: StatusAction) =>
    startTransition(async () => {
      const titles = new Map(page.rows.map((row) => [row.id, row.title]));
      const outcome = await applyStatus(type, language, [...selected], action);
      if (outcome.state === "failed") {
        setNotice({ tone: "failed", text: t("admin.library.result.failed"), refused: [] });
        return;
      }
      setNotice({
        tone: "done",
        text: outcome.changed > 0 ? t("admin.library.result.changed", { count: outcome.changed }) : outcome.refused.length ? "" : t("admin.library.result.nothing"),
        refused: outcome.refused.map((item) => ({ title: titles.get(item.id) ?? "", reason: t(`admin.library.refused.${item.reason}`) })),
      });
      setSelected(new Set());
      router.refresh();
    });

  if (page.rows.length === 0) {
    return (
      <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-10 text-center shadow-[var(--shadow-1)]">{emptyText}</p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {notice ? <NoticePanel notice={notice} language={language} onClose={() => setNotice(null)} /> : null}

      <div className="flex items-center justify-between gap-3 px-1">
        <label className="text-ink-2 flex min-h-11 cursor-pointer items-center gap-3 px-3 text-[13.5px] font-bold">
          <Checkbox
            checked={allOn}
            onCheckedChange={(on) => setSelected(on === true ? new Set(ids) : new Set())}
            className="size-[18px] rounded-[6px]"
          />
          {t("admin.library.selection.all")}
        </label>
        <span className="text-ink-3 text-[13px] tabular-nums">{t("admin.library.pager.total", { count: page.total })}</span>
      </div>

      <ul className={cn("bg-surface rounded-[22px] shadow-[var(--shadow-1)] transition-opacity", pending && "opacity-60")}>
        {page.rows.map((row) => (
          <Row key={row.id} row={row} type={type} language={language} checked={selected.has(row.id)} onCheck={(on) => toggle(row.id, on)} />
        ))}
      </ul>

      {page.pages > 1 ? <Pager page={page} state={state} /> : null}

      {selected.size > 0 ? (
        <div
          role="region"
          aria-label={t("admin.library.selection.count", { count: selected.size })}
          className="bg-glass border-line sticky bottom-4 z-20 flex flex-wrap items-center gap-2 rounded-[20px] border p-2 ps-4 shadow-[var(--shadow-2)] backdrop-blur-md"
        >
          <span className="text-ink me-auto text-[14px] font-bold tabular-nums">{t("admin.library.selection.count", { count: selected.size })}</span>
          {pending ? <LoaderCircle className="text-ink-3 size-5 animate-spin motion-reduce:animate-none" aria-label={t("admin.library.selection.working")} /> : null}
          <Button type="button" size="sm" disabled={pending} onClick={() => run("approve")}>
            {t("admin.library.actions.approve")}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="secondary" size="sm" disabled={pending}>
                <MoreHorizontal strokeWidth={2} aria-hidden />
                {t("admin.library.moreActions")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52 rounded-[16px] p-1.5">
              {(["draft", "suspend", "unsuspend"] as const).map((action) => (
                <DropdownMenuItem key={action} className="h-10 rounded-[10px] px-3 text-[14px] font-bold" onSelect={() => run(action)}>
                  {t(`admin.library.actions.${action}`)}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                className="text-bad focus:text-bad h-10 rounded-[10px] px-3 text-[14px] font-bold"
                onSelect={() => setConfirmRetire(true)}
              >
                {t("admin.library.actions.retire")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => setSelected(new Set())} disabled={pending}>
            <X strokeWidth={2} aria-hidden />
            <span className="sr-only">{t("admin.library.selection.none")}</span>
          </Button>
        </div>
      ) : null}

      <AlertDialog open={confirmRetire} onOpenChange={setConfirmRetire}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.library.actions.retire")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.library.confirmRetire", { count: selected.size })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.library.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmRetire(false);
                run("retire");
              }}
            >
              {t("admin.library.confirmRetireYes")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({
  row,
  type,
  language,
  checked,
  onCheck,
}: {
  row: LibraryRow;
  type: LibrarySlug;
  language: string;
  checked: boolean;
  onCheck: (on: boolean) => void;
}) {
  return (
    <li className={cn("border-line flex items-start gap-1 border-b py-1.5 pe-4 last:border-b-0", checked && "bg-tint/40")}>
      <label className="grid size-11 shrink-0 cursor-pointer place-items-center">
        <Checkbox checked={checked} onCheckedChange={(on) => onCheck(on === true)} className="size-[18px] rounded-[6px]" aria-label={t("admin.library.selection.select", { item: row.title })} />
      </label>
      <Link
        href={itemHref(type, row.id)}
        className="group hover:bg-tint/50 -my-0.5 flex min-w-0 flex-1 flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-[14px] px-2 py-2 transition-colors"
      >
        <span className="flex min-w-0 flex-[1_1_16rem] flex-col gap-0.5">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
            <Voiced
              text={row.title}
              voice={row.titleVoice}
              language={language}
              className={cn("text-ink group-hover:text-brand-text transition-colors", row.titleVoice === "target" ? "text-[18px] leading-snug" : "text-[15px] leading-7 font-bold")}
            />
            {row.meta ? <span className="text-ink-3 text-[12.5px]">{isolateLatin(row.meta)}</span> : null}
          </span>
          {row.subtitle ? (
            <Voiced
              text={row.subtitle}
              voice={row.subtitleVoice}
              language={language}
              className={cn("text-ink-2 line-clamp-2", row.subtitleVoice === "target" ? "text-[15px]" : "text-[14px] leading-6")}
            />
          ) : null}
          {row.missing.length > 0 ? (
            <span className="text-brand-text mt-1 flex items-center gap-1.5 text-[12.5px] font-bold">
              <CircleDashed className="size-3.5 shrink-0" strokeWidth={2} aria-hidden />
              <span className="sr-only">{t("admin.library.missingLabel")}: </span>
              <span>{joinDots(row.missing)}</span>
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {row.level ? <LevelChip level={row.level} /> : null}
          <StatusChip status={row.status} suspended={row.suspended} />
        </span>
      </Link>
    </li>
  );
}

function NoticePanel({ notice, language, onClose }: { notice: Notice; language: string; onClose: () => void }) {
  return (
    <div
      role="status"
      className={cn("flex items-start gap-3 rounded-[18px] px-4 py-3", notice.tone === "failed" ? "bg-bad-soft text-bad" : "bg-tint text-ink")}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {notice.text ? <p className="font-bold">{notice.text}</p> : null}
        {notice.refused.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-ink font-bold">{t("admin.library.refused.title", { count: notice.refused.length })}</p>
            <ul className="text-ink-2 flex flex-col gap-0.5 text-[13.5px]">
              {notice.refused.slice(0, 8).map((item, index) => (
                <li key={index}>
                  <bdi dir="auto" lang={language} className="text-ink font-semibold">
                    {item.title}
                  </bdi>
                  {": "}
                  {item.reason}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <button type="button" onClick={onClose} className="text-ink-3 hover:text-ink grid size-8 shrink-0 place-items-center rounded-[10px]">
        <X className="size-4" strokeWidth={2} aria-hidden />
        <span className="sr-only">{t("admin.library.cancel")}</span>
      </button>
    </div>
  );
}

function Pager({ page, state }: { page: LibraryPage; state: LibraryState }) {
  const link = (to: number) => libraryHref({ ...state, page: to });
  return (
    <nav aria-label={t("admin.library.pager.label")} className="flex items-center justify-center gap-2">
      <Button asChild variant="secondary" size="icon-sm" className={cn(page.page <= 1 && "pointer-events-none opacity-40")}>
        <Link href={link(page.page - 1)} aria-disabled={page.page <= 1} tabIndex={page.page <= 1 ? -1 : undefined}>
          <ChevronRight className="ltr:rotate-180" strokeWidth={2} aria-hidden />
          <span className="sr-only">{t("admin.library.pager.prev")}</span>
        </Link>
      </Button>
      <span className="text-ink-2 min-w-32 text-center text-[13.5px] font-bold tabular-nums">
        {t("admin.library.pager.of", { page: page.page, pages: page.pages })}
      </span>
      <Button asChild variant="secondary" size="icon-sm" className={cn(page.page >= page.pages && "pointer-events-none opacity-40")}>
        <Link href={link(page.page + 1)} aria-disabled={page.page >= page.pages} tabIndex={page.page >= page.pages ? -1 : undefined}>
          <ChevronLeft className="ltr:rotate-180" strokeWidth={2} aria-hidden />
          <span className="sr-only">{t("admin.library.pager.next")}</span>
        </Link>
      </Button>
    </nav>
  );
}



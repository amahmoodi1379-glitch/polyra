"use client";

import { memo, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type Announcements, type DragEndEvent, type UniqueIdentifier } from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDownWideNarrow, ArrowUpLeft, Check, CircleAlert, GripVertical, Hand, Link2, LoaderCircle, Pause, Search, X } from "lucide-react";
import { Voiced } from "@/components/admin/voiced";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatNumber, t, tRich } from "@/i18n";
import { arrange, automatic, moveTo } from "@/lib/arrange";
import { cn } from "@/lib/utils";
import type { OrderRow, OrderView } from "@/server/content/order";
import { itemHref } from "../content/links";
import { saveOrderAction } from "./actions";

type Notice = { tone: "saved" | "quiet" | "failed"; text: string };

/** Persian and Arabic digits read as Latin ones. */
const latinDigits = (value: string) => value.replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0)).replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660));
const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").replace(/[‌‏‎]/g, "").toLowerCase();
const sameOrder = (a: number[], b: number[]) => a.length === b.length && a.every((id, index) => id === b[index]);
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * One list of «ترتیب»: drag a row by its handle (mouse, finger or keyboard) or type its new number.
 * Moves stay on the page until «ذخیره ترتیب», like the edit forms. In the word list, phrases and new
 * senses follow their words by themselves (PRD §5.8).
 */
export function OrderBoard({ view }: { view: OrderView }) {
  const router = useRouter();
  const start = useMemo(() => view.rows.map((row) => row.id), [view]);
  const [source, setSource] = useState(view);
  const [ids, setIds] = useState(start);
  const [saved, setSaved] = useState(start);
  const [moved, setMoved] = useState<Set<number>>(() => new Set());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [query, setQuery] = useState("");
  const [focusId, setFocusId] = useState<number | null>(null);
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [pending, startTransition] = useTransition();

  // New rows from the server (after a save) replace the page's copy.
  if (source !== view) {
    setSource(view);
    setIds(start);
    setSaved(start);
    setMoved(new Set());
  }

  const byId = useMemo(() => new Map(view.rows.map((row) => [row.id, row])), [view]);
  const follows = useMemo(() => automatic(ids, view.anchored), [ids, view.anchored]);
  const dirty = !sameOrder(ids, saved);
  const movedCount = [...moved].filter((id) => ids.indexOf(id) !== saved.indexOf(id)).length;

  const needle = fold(query.trim());
  const visible = needle
    ? ids.filter((id) => {
        const row = byId.get(id)!;
        return [row.title, row.sub ?? "", row.meta ?? ""].some((text) => fold(text).includes(needle));
      })
    : ids;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (focusId === null) return;
    document.querySelector(`[data-row="${focusId}"]`)?.scrollIntoView({
      block: "center",
      behavior: reduceMotion() ? "auto" : "smooth",
    });
  }, [focusId, ids]);

  /** Applies a move; in the word list the automatic words then follow their anchors again. */
  const move = useCallback(
    (id: number, reorder: (current: number[]) => number[]) => {
      setIds((current) => {
        const next = reorder(current);
        return view.list === "words" ? arrange(next, view.anchored) : next;
      });
      setMoved((current) => new Set(current).add(id));
      setNotice(null);
    },
    [view],
  );
  const typed = useCallback(
    (id: number, position: number) => {
      move(id, (current) => moveTo(current, id, position));
      setFocusId(id);
    },
    [move],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const title = (id: UniqueIdentifier) => byId.get(Number(id))?.title ?? "";
  const place = (id: UniqueIdentifier) => ids.indexOf(Number(id)) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      t("admin.order.announce.start", {
        item: title(active.id),
        position: place(active.id),
      }),
    onDragOver: ({ active, over }) =>
      over
        ? t("admin.order.announce.over", {
            item: title(active.id),
            position: place(over.id),
          })
        : undefined,
    onDragEnd: ({ active, over }) =>
      t("admin.order.announce.end", {
        item: title(active.id),
        position: place(over?.id ?? active.id),
      }),
    onDragCancel: () => t("admin.order.announce.cancel"),
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const id = Number(active.id);
    move(id, (current) => arrayMove(current, current.indexOf(id), current.indexOf(Number(over.id))));
  };

  const save = (manual?: boolean) =>
    startTransition(async () => {
      const result = await saveOrderAction(view.list, view.language, view.level, view.base, ids, manual);
      if (result.state === "saved") {
        setSaved(ids);
        setMoved(new Set());
        setNotice(result.changed ? { tone: "saved", text: t("admin.order.saved") } : { tone: "quiet", text: t("admin.order.unchanged") });
        router.refresh();
      } else if (result.state === "stale") {
        setNotice({ tone: "failed", text: t("admin.order.stale") });
        router.refresh();
      } else {
        setNotice({ tone: "failed", text: t("admin.order.failed") });
      }
    });

  if (view.rows.length === 0) {
    return <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-10 text-center shadow-[var(--shadow-1)]">{t("admin.order.empty")}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {view.list === "texts" ? (
        <div className="bg-tint/60 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-[18px] px-4 py-2.5">
          <p className="text-ink-2 flex items-start gap-2 text-[13.5px] leading-6">
            {view.manual ? (
              <Hand className="text-brand-text mt-1 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            ) : (
              <ArrowDownWideNarrow className="text-brand-text mt-1 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            )}
            <span>
              <strong className="text-ink font-bold">{t(view.manual ? "admin.order.mode.manualTitle" : "admin.order.mode.autoTitle")}</strong>{" "}
              {t(view.manual ? "admin.order.mode.manual" : "admin.order.mode.auto")}
            </span>
          </p>
          {view.manual ? (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmAuto(true)}>
              {t("admin.order.backToAuto")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="relative min-w-0 flex-[1_1_16rem]">
          <span className="sr-only">{t("admin.order.find")}</span>
          <Search className="text-ink-3 pointer-events-none absolute start-4 top-1/2 size-[18px] -translate-y-1/2" strokeWidth={1.75} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("admin.order.find")}
            className="bg-surface border-line-2 text-ink placeholder:text-ink-3 focus-visible:border-brand-soft focus-visible:ring-ring/30 h-11 w-full rounded-[14px] border ps-11 pe-10 text-[15px] outline-none focus-visible:ring-[3px] [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="text-ink-3 hover:text-ink absolute end-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-[10px]"
            >
              <X className="size-4" strokeWidth={2} aria-hidden />
              <span className="sr-only">{t("admin.order.clearFind")}</span>
            </button>
          ) : null}
        </label>
        <span className="text-ink-3 text-[13px] tabular-nums" aria-live="polite">
          {needle ? (visible.length > 0 ? t("admin.order.findCount", { count: visible.length }) : t("admin.order.findNone")) : t("admin.order.count", { count: ids.length })}
        </span>
      </div>

      <DndContext
        id={`order-${view.list}`}
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis]}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: t("admin.order.announce.instructions"),
          },
        }}
      >
        <SortableContext items={visible} strategy={verticalListSortingStrategy}>
          <ol className={cn("bg-surface rounded-[22px] py-1 shadow-[var(--shadow-1)] transition-opacity", pending && "opacity-60")}>
            {visible.map((id) => (
              <Row
                key={id}
                row={byId.get(id)!}
                language={view.language}
                position={ids.indexOf(id) + 1}
                total={ids.length}
                auto={follows.has(id)}
                locked={Boolean(needle)}
                moved={moved.has(id) && ids.indexOf(id) !== saved.indexOf(id)}
                onPosition={typed}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      {view.list === "words" && view.anchored.length > 0 ? <p className="text-ink-3 px-1 text-[13px] leading-6">{t("admin.order.followsHelp")}</p> : null}

      <div
        className={cn(
          "bg-glass border-line sticky bottom-4 z-20 flex flex-wrap items-center gap-3 rounded-[20px] border p-2 ps-4 shadow-[var(--shadow-2)] backdrop-blur-md transition-opacity",
          !dirty && !notice && "opacity-90",
        )}
      >
        <div className="me-auto flex min-w-0 flex-col py-1" role="status" aria-live="polite">
          {notice && !dirty ? (
            <span className={cn("flex items-center gap-1.5 text-[14px] font-bold", notice.tone === "failed" ? "text-bad" : "text-ink")}>
              {notice.tone === "failed" ? <CircleAlert className="size-4" strokeWidth={2} aria-hidden /> : <Check className="size-4" strokeWidth={2.5} aria-hidden />}
              {notice.text}
            </span>
          ) : (
            <span className={cn("text-[13.5px]", dirty ? "text-ink font-bold" : "text-ink-3")}>
              {dirty ? t("admin.order.unsaved", { count: Math.max(movedCount, 1) }) : t("admin.order.clean")}
            </span>
          )}
        </div>
        {dirty ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setIds(saved);
              setMoved(new Set());
              setNotice(null);
            }}
          >
            {t("admin.order.undo")}
          </Button>
        ) : null}
        <Button type="button" disabled={!dirty || pending} className="min-w-28" onClick={() => save()}>
          {pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
          {t("admin.order.save")}
        </Button>
      </div>

      <AlertDialog open={confirmAuto} onOpenChange={setConfirmAuto}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.order.backToAuto")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.order.confirmAuto")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.library.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => {
                setConfirmAuto(false);
                save(false);
              }}
            >
              {t("admin.order.confirmAutoYes")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const Row = memo(function Row({
  row,
  language,
  position,
  total,
  auto,
  locked,
  moved,
  onPosition,
}: {
  row: OrderRow;
  language: string;
  position: number;
  total: number;
  auto: boolean;
  locked: boolean;
  moved: boolean;
  onPosition: (id: number, position: number) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: row.id,
    disabled: locked ? true : auto ? { draggable: true, droppable: false } : false,
    transition: { duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  });

  return (
    <li
      ref={setNodeRef}
      data-row={row.id}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "border-line relative flex items-center gap-1 border-b py-0.5 ps-1.5 pe-2 last:border-b-0 sm:gap-2 sm:pe-3",
        moved && "bg-tint/50",
        isDragging && "bg-surface ring-line-2 z-10 rounded-[14px] border-transparent shadow-[var(--shadow-2)] ring-1",
      )}
    >
      {moved ? <span className="bg-brand absolute inset-y-2 start-0 w-[3px] rounded-full" aria-hidden /> : null}
      {auto ? (
        <span className="text-ink-3 grid size-10 shrink-0 place-items-center" title={t("admin.order.follows", { word: row.follows ?? "" })}>
          <Link2 className="size-4" strokeWidth={1.75} aria-hidden />
        </span>
      ) : locked ? (
        <span className="size-10 shrink-0" aria-hidden />
      ) : (
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t("admin.order.drag", { item: row.title })}
          className="text-ink-3 hover:bg-tint hover:text-ink focus-visible:ring-ring/45 grid size-10 shrink-0 cursor-grab touch-none place-items-center rounded-[12px] outline-none focus-visible:ring-[3px] active:cursor-grabbing"
        >
          <GripVertical className="size-[18px]" strokeWidth={1.75} aria-hidden />
        </button>
      )}

      <PositionField position={position} total={total} label={t("admin.order.position", { item: row.title })} disabled={auto} onCommit={(value) => onPosition(row.id, value)} />

      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 py-2 sm:flex-nowrap">
        <span className="flex min-w-0 items-baseline gap-x-2 sm:max-w-[55%] sm:shrink-0">
          <Voiced
            text={row.title}
            voice={row.voice}
            language={language}
            className={cn("text-ink min-w-0 truncate", row.voice === "target" ? "text-[17px] leading-snug" : "text-[15px] leading-7 font-bold")}
          />
          {row.meta ? <span className="text-ink-3 shrink-0 text-[12.5px] whitespace-nowrap">{row.meta}</span> : null}
        </span>
        {auto && row.follows ? (
          <span className="text-ink-3 min-w-0 basis-full truncate text-[13px] leading-6 sm:basis-auto">
            {tRich("admin.order.follows", {
              word: (
                <bdi className="lat text-ink-2 text-[14px]" dir="ltr" lang={language}>
                  {row.follows}
                </bdi>
              ),
            })}
          </span>
        ) : row.sub ? (
          <Voiced
            text={row.sub}
            voice={row.subVoice}
            language={language}
            className={cn("text-ink-2 min-w-0 basis-full truncate sm:basis-auto", row.subVoice === "target" ? "text-[14px]" : "text-[13.5px] leading-6")}
          />
        ) : null}
      </div>

      {row.suspended ? (
        <span className="text-idk flex shrink-0 items-center gap-1 text-[12.5px] font-bold">
          <Pause className="size-3" strokeWidth={2.5} aria-hidden />
          <span className="sr-only sm:not-sr-only">{t("admin.library.statuses.suspended")}</span>
        </span>
      ) : row.status === "published" ? (
        <span className="text-brand-text flex shrink-0 items-center gap-1.5 text-[12.5px] font-bold">
          <span className="bg-brand size-1.5 rounded-full" aria-hidden />
          <span className="sr-only sm:not-sr-only">{t("admin.library.statuses.published")}</span>
        </span>
      ) : null}
      <a
        href={itemHref(row.slug, row.id)}
        target="_blank"
        rel="noreferrer"
        aria-label={t("admin.order.open", { item: row.title })}
        className="text-ink-3 hover:bg-tint hover:text-ink grid size-9 shrink-0 place-items-center rounded-[10px] transition-colors"
      >
        <ArrowUpLeft className="size-4 ltr:-scale-x-100" strokeWidth={1.75} aria-hidden />
      </a>
    </li>
  );
});

/** The row's number; typing another one moves the row there. */
function PositionField({
  position,
  total,
  label,
  disabled,
  onCommit,
}: {
  position: number;
  total: number;
  label: string;
  disabled: boolean;
  onCommit: (position: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const done = () => {
    if (draft === null) return;
    const value = Number(latinDigits(draft.trim()));
    setDraft(null);
    if (Number.isInteger(value) && value >= 1 && value !== position) onCommit(Math.min(value, total));
  };
  if (disabled) {
    return <span className="text-ink-3 w-12 shrink-0 text-center text-[14px] font-bold tabular-nums">{formatNumber(position)}</span>;
  }
  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label={label}
      value={draft ?? formatNumber(position)}
      onFocus={(event) => {
        setDraft(formatNumber(position));
        event.target.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={done}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          done();
        } else if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      className="text-ink-2 hover:border-line-2 focus-visible:border-brand-soft focus-visible:bg-surface focus-visible:text-ink focus-visible:ring-ring/30 h-9 w-12 shrink-0 rounded-[10px] border border-transparent bg-transparent text-center text-[14px] font-bold tabular-nums outline-none focus-visible:ring-[3px]"
    />
  );
}

"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "@/components/admin/link";
import { useRouter } from "next/navigation";
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
import { cn } from "@/lib/utils";
import type { LibrarySlug } from "@/server/content/library/slugs";
import type { Mastery, ReviewDecision } from "@/server/content/review/decide";
import { decide } from "./actions";

/** A decision the server refused after the page had moved on: shown on whichever item is open now. */
type Late = { text: string; href: string };
let late: Late | null = null;
const lateListeners = new Set<() => void>();
const setLate = (next: Late | null) => {
  late = next;
  lateListeners.forEach((listener) => listener());
};
const subscribeLate = (listener: () => void) => {
  lateListeners.add(listener);
  return () => lateListeners.delete(listener);
};

/** The whole next page, data included, fetched while the teacher looks at this one. */
const fullPrefetch = { kind: "full" } as unknown as Parameters<ReturnType<typeof useRouter>["prefetch"]>[1];

/**
 * «تأیید»، «رد» and «بعدی» for the item on screen (PRD §13.9 step 4); a B1 or B2 word carries its
 * «نوشتنی / شناختنی» choice with the approval (PRD §13.4). The next item is fetched while this one is on
 * screen, so a decision opens it at once and is saved on the way; a refusal (an error, a sentence in use)
 * comes back as a line on the next item with a way back to this one.
 */
export function ReviewActions({
  slug,
  language,
  id,
  blocked,
  mastery,
  nextHref,
  afterHref,
  hereHref,
}: {
  slug: LibrarySlug;
  language: string;
  id: number;
  blocked: boolean;
  /** Only for a B1 or B2 word: the current value and the chatbot's suggestion. */
  mastery: { value: Mastery; suggested: Mastery | null; manual: boolean } | null;
  /** «بعدی» without deciding. */
  nextHref: string | null;
  /** Where to go once this item is decided. */
  afterHref: string;
  /** This item, for the way back when its decision was refused. */
  hereHref: string;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<Mastery | null>(mastery?.value ?? null);
  const [confirm, setConfirm] = useState(false);
  const [sent, setSent] = useState(false);
  const problem = useSyncExternalStore(subscribeLate, () => late, () => null);

  useEffect(() => {
    router.prefetch(afterHref, fullPrefetch);
  }, [router, afterHref]);

  // Back on the item whose decision was refused: the line has done its job.
  useEffect(() => {
    if (late?.href === hereHref) setLate(null);
  }, [hereHref]);

  const run = (decision: ReviewDecision) => {
    if (sent) return;
    setSent(true);
    setLate(null);
    void decide(slug, language, id, decision, decision === "approve" ? choice : null).then(
      (outcome) => {
        if (outcome.state !== "done" && outcome.state !== "gone") setLate({ text: t("admin.review.notSaved"), href: hereHref });
      },
      () => setLate({ text: t("admin.review.notSaved"), href: hereHref }),
    );
    router.push(afterHref);
  };

  return (
    <section aria-label={t("admin.review.decision")} className="bg-surface flex flex-col gap-4 rounded-[22px] p-5 shadow-[var(--shadow-1)]">
      {mastery ? (
        <fieldset className="flex flex-col gap-2.5">
          <legend className="text-ink mb-1 text-[15px] font-extrabold">{t("admin.review.mastery.title")}</legend>
          <p className="text-ink-2 text-[13.5px] leading-6">{t("admin.review.mastery.help")}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {(["produce", "recognize"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={choice === value}
                onClick={() => setChoice(value)}
                className={cn(
                  "h-11 rounded-[12px] border px-4 text-[14.5px] font-bold transition-colors",
                  choice === value ? "border-brand bg-tint text-brand-text" : "border-line-2 text-ink-2 hover:text-ink",
                )}
              >
                {t(`admin.library.options.mastery.${value}`)}
              </button>
            ))}
          </div>
          {mastery.suggested && mastery.suggested !== mastery.value ? (
            <p className="text-ink-2 text-[13.5px] leading-6">{t("admin.review.mastery.suggested", { value: t(`admin.library.options.mastery.${mastery.suggested}`) })}</p>
          ) : null}
          {mastery.manual ? <p className="text-ink-3 text-[13px] leading-6">{t("admin.library.words.masteryManual")}</p> : null}
        </fieldset>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" disabled={sent || blocked} onClick={() => run("approve")}>
          {t("admin.review.approve")}
        </Button>
        <Button type="button" variant="secondary" disabled={sent} onClick={() => setConfirm(true)}>
          {t("admin.review.reject")}
        </Button>
        {nextHref ? (
          <Button asChild variant="ghost">
            <Link href={nextHref}>{t("admin.review.skip")}</Link>
          </Button>
        ) : null}
      </div>
      {blocked ? <p className="text-ink-2 text-[13.5px] leading-6">{t("admin.review.blockedHint")}</p> : null}
      {problem && problem.href !== hereHref ? (
        <p role="alert" className="text-bad text-[13.5px] leading-6 font-bold">
          {problem.text}{" "}
          <Link href={problem.href} prefetch className="text-brand-text underline underline-offset-4">
            {t("admin.review.backToIt")}
          </Link>
        </p>
      ) : null}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.review.reject")}</AlertDialogTitle>
            <AlertDialogDescription>{t("admin.review.confirmReject")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("admin.library.cancel")}</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirm(false);
                run("reject");
              }}
            >
              {t("admin.review.confirmRejectYes")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

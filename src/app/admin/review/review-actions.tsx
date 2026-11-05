"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
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
import { cn } from "@/lib/utils";
import type { LibrarySlug } from "@/server/content/library/slugs";
import type { Mastery, ReviewDecision } from "@/server/content/review/decide";
import { decide } from "./actions";

/**
 * «تأیید»، «رد» and «بعدی» for the item on screen (PRD §13.9 step 4). After a decision the next item
 * opens; a B1 or B2 word carries its «نوشتنی / شناختنی» choice with the approval (PRD §13.4).
 */
export function ReviewActions({
  slug,
  language,
  id,
  blocked,
  mastery,
  nextHref,
  afterHref,
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
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<Mastery | null>(mastery?.value ?? null);
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = (decision: ReviewDecision) =>
    startTransition(async () => {
      setMessage(null);
      // On success the server answers with the next item's page, so nothing comes back here.
      const outcome = await decide(slug, language, id, decision, decision === "approve" ? choice : null, afterHref);
      if (!outcome) return;
      if (outcome.state === "done" || outcome.state === "gone") {
        router.push(afterHref);
        return;
      }
      setMessage(outcome.state === "blocked" ? t("admin.review.blocked") : outcome.state === "inUse" ? t("admin.library.refused.sentenceInUse") : t("admin.review.failed"));
    });

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
        <Button type="button" disabled={pending || blocked} onClick={() => run("approve")}>
          {t("admin.review.approve")}
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => setConfirm(true)}>
          {t("admin.review.reject")}
        </Button>
        {nextHref ? (
          <Button asChild variant="ghost">
            <Link href={nextHref}>{t("admin.review.skip")}</Link>
          </Button>
        ) : null}
        {pending ? <LoaderCircle className="text-ink-3 size-5 animate-spin motion-reduce:animate-none" aria-label={t("admin.library.selection.working")} /> : null}
      </div>
      {blocked ? <p className="text-ink-2 text-[13.5px] leading-6">{t("admin.review.blockedHint")}</p> : null}
      {message ? (
        <p role="alert" className="text-bad text-[13.5px] leading-6 font-bold">
          {message}
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

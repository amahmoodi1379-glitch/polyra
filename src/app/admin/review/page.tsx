import "@/app/(learner)/learner.css";
import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CircleAlert, ListChecks } from "lucide-react";
import { ItemAudioPanel } from "@/components/admin/audio/item-audio";
import { LanguageTabs } from "@/components/admin/language-tabs";
import { PageHeader } from "@/components/admin/page-header";
import { FindingList } from "@/components/admin/qa-mark";
import { LearnerPreview } from "@/components/admin/review/learner-preview";
import { LevelChip, StatusChip } from "@/components/admin/status-chip";
import { Voiced } from "@/components/admin/voiced";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { itemAudio } from "@/server/content/audio/view";
import { levelRank, pickLanguage } from "@/server/content/languages";
import { editors } from "@/server/content/library/edit";
import type { WordContext, WordValues } from "@/server/content/library/edit/words";
import { entityOf, isLibrarySlug } from "@/server/content/library/slugs";
import { reviewBlockers } from "@/server/content/review/decide";
import { findingsOf, warningsOf } from "@/server/content/review/findings";
import { reviewQueue, type ReviewRef } from "@/server/content/review/list";
import { previewItem } from "@/server/content/review/preview";
import type { EntityRef } from "@/server/content/report";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { ItemForm } from "../content/[type]/[id]/item-form";
import { itemHref } from "../content/links";
import { reviewHref } from "./links";
import { ReviewActions } from "./review-actions";

export const metadata: Metadata = { title: t("admin.review.title") };

const parseAt = (value: unknown): ReviewRef | null => {
  const match = typeof value === "string" ? /^([a-z]+)-(\d+)$/.exec(value) : null;
  return match && isLibrarySlug(match[1]) ? { slug: match[1], id: Number(match[2]) } : null;
};
const positive = (value: unknown) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null);

/**
 * «بازبینی» (PRD §13.9 step 4, §13.4): what waits for the teacher, one item at a time, shown the way
 * the learner gets it, with what the quality check found and what still keeps it back. Approving is
 * done only here (owner decision, DECISIONS.md); the form is under the item for a fix on the spot.
 */
export default async function ReviewPage({ searchParams }: PageProps<"/admin/review">) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const language = pickLanguage(params.lang, admin.admin_language);
  const batch = positive(params.batch);
  const type = isLibrarySlug(params.type) ? params.type : null;
  const queue = await reviewQueue(language, { batch, slug: type });
  const wanted = parseAt(params.at);
  const index = Math.max(0, wanted ? queue.findIndex((ref) => ref.slug === wanted.slug && ref.id === wanted.id) : 0);
  const current = queue[index] ?? null;
  const scope = { language, batch, type };
  const back = batch
    ? {
        href: `/admin/batches/${batch}`,
        label: t("admin.review.backBatch", { id: formatNumber(batch) }),
      }
    : { href: "/admin", label: t("admin.review.back") };

  const header = (
    <div className="flex flex-col gap-3">
      <Link
        href={back.href}
        className="text-ink-3 hover:text-ink -ms-1 inline-flex w-fit items-center gap-1.5 rounded-[10px] px-1 py-1 text-[14px] font-bold transition-colors"
      >
        <ArrowRight className="size-4 ltr:-scale-x-100" strokeWidth={2} aria-hidden />
        {back.label}
      </Link>
      <PageHeader
        title={t("admin.review.title")}
        lead={t("admin.review.lead")}
        actions={admin.admin_language === "all" && !batch ? <LanguageTabs current={language} path="/admin/review" /> : null}
      />
    </div>
  );

  if (!current) {
    return (
      <>
        {header}
        <section className="bg-surface flex flex-col items-start gap-4 rounded-[22px] px-6 py-10 shadow-[var(--shadow-1)]">
          <p className="text-ink text-[16px] font-extrabold">{t("admin.review.emptyTitle")}</p>
          <p className="text-ink-2 max-w-[60ch]">{t(batch ? "admin.review.emptyBatch" : "admin.review.empty")}</p>
          <Button asChild variant="secondary">
            <Link href={back.href}>{back.label}</Link>
          </Button>
        </section>
      </>
    );
  }

  const { slug, id } = current;
  const loaded = await editors[slug].load(id);
  if (!loaded) return header;
  const ref: EntityRef = { type: entityOf[slug] as EntityRef["type"], id };
  const [preview, blockers, findings, warnings, levels, audio] = await Promise.all([
    previewItem(slug, language, id),
    reviewBlockers(db, slug, id),
    findingsOf(ref.type, [id]),
    warningsOf(ref),
    appSetting<string[]>(`levels.${language}`),
    itemAudio(slug, id),
  ]);
  const { view } = loaded;
  const after = queue[index + 1] ?? null;
  const next = queue.length > 1 ? (queue[index + 1] ?? queue[0]) : null;
  const word = slug === "words" ? (loaded as unknown as { values: WordValues; context: WordContext }) : null;
  const mastery =
    word && levelRank(view.level) >= levelRank("B1")
      ? {
          value: word.values.mastery,
          suggested: word.context.masterySuggested as "produce" | "recognize" | null,
          manual: word.context.masteryManual,
        }
      : null;
  const itemFindings = findings.get(id) ?? [];
  const showForm = preview.state === "none";

  return (
    <>
      {header}
      {/* On a phone the learner's view comes right under the title; on a wide screen it stays beside everything. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px] xl:grid-rows-[auto_1fr] xl:gap-x-8">
        <div className="flex min-w-0 flex-col gap-3 xl:col-start-1 xl:row-start-1">
          <p className="text-ink-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px] font-bold">
            <span className="text-ink num">{t("admin.review.position", { n: formatNumber(index + 1), total: formatNumber(queue.length) })}</span>
            <span>{t(`admin.library.types.${slug}`)}</span>
          </p>
          <h2 className="min-w-0">
            <Voiced
              text={view.title}
              voice={view.titleVoice}
              language={language}
              className={cn(
                "text-ink inline-block max-w-full",
                view.titleVoice === "target" ? "text-[26px] leading-tight" : "text-[20px] leading-snug font-extrabold",
              )}
            />
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            {view.level ? <LevelChip level={view.level} /> : null}
            <StatusChip status={view.status} suspended={view.suspended} />
            <Link href={itemHref(slug, id)} className="text-brand-text text-[13.5px] font-bold underline-offset-4 hover:underline">
              {t("admin.review.open")}
            </Link>
          </div>
        </div>

        <aside
          className="flex min-w-0 flex-col items-center gap-3 xl:sticky xl:top-8 xl:col-start-2 xl:row-span-2 xl:row-start-1"
          aria-label={t("admin.review.preview.title")}
        >
          {preview.state === "ready" ? (
            <LearnerPreview key={`${slug}-${id}`} preview={preview} languageName={t(`common.languages.${language}`)} itemKey={`${slug}-${id}`} />
          ) : (
            <p className="bg-surface text-ink-2 w-full rounded-[22px] px-5 py-6 text-[14px] leading-7 shadow-[var(--shadow-1)]">
              {t(`admin.review.preview.${preview.reason}`)}
            </p>
          )}
        </aside>

        <div className="flex min-w-0 flex-col gap-5 xl:col-start-1 xl:row-start-2">
          {blockers.length > 0 ? (
            <section className="bg-bad-soft text-ink flex flex-col gap-2 rounded-[18px] px-4 py-3.5 text-[14px] leading-6">
              {blockers.map((blocker) => (
                <p key={blocker} className="flex items-start gap-2">
                  <CircleAlert className="text-bad mt-1 size-4 shrink-0" strokeWidth={2.25} aria-hidden />
                  <span>
                    {t(`admin.review.blockers.${blocker}`)}{" "}
                    {blocker !== "skeleton" ? (
                      <Link href={`/admin/resolve?lang=${language}`} className="text-brand-text font-bold underline-offset-4 hover:underline">
                        {t("admin.review.resolve")}
                      </Link>
                    ) : null}
                  </span>
                </p>
              ))}
            </section>
          ) : null}

          <section className="bg-surface flex flex-col gap-2.5 rounded-[18px] px-4 py-3.5 shadow-[var(--shadow-1)]" aria-labelledby="check-title">
            <h3 id="check-title" className="text-ink flex items-center gap-2 text-[15px] font-extrabold">
              <ListChecks className="text-brand-text size-4.5 shrink-0" strokeWidth={2.25} aria-hidden />
              {t("admin.review.check.title")}
            </h3>
            <ul className="text-ink-2 flex list-disc flex-col gap-1 ps-5 text-[14px] leading-6">
              {t(`admin.review.check.${slug}`)
                .split("\n")
                .map((line) => (
                  <li key={line}>{isolateLatin(line)}</li>
                ))}
            </ul>
          </section>

          {itemFindings.length > 0 ? (
            <section className="flex flex-col gap-2.5" aria-labelledby="qa-title">
              <h3 id="qa-title" className="text-ink text-[15px] font-extrabold">
                {t("admin.review.findings", { count: formatNumber(itemFindings.length) })}
              </h3>
              <FindingList findings={itemFindings} />
            </section>
          ) : null}

          {warnings.length > 0 ? (
            <section className="flex flex-col gap-2" aria-labelledby="warn-title">
              <h3 id="warn-title" className="text-ink text-[15px] font-extrabold">
                {t("admin.review.warnings")}
              </h3>
              <ul className="text-ink-2 flex list-disc flex-col gap-1 ps-5 text-[14px] leading-6">
                {warnings.map((text) => (
                  <li key={text}>{isolateLatin(text)}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {audio ? <ItemAudioPanel audio={audio} language={language} /> : null}

          <ReviewActions
            slug={slug}
            language={language}
            id={id}
            blocked={blockers.length > 0}
            mastery={mastery}
            nextHref={next ? reviewHref({ ...scope, at: next }) : null}
            afterHref={reviewHref({ ...scope, at: after })}
          />

          <details className="group bg-surface rounded-[22px] shadow-[var(--shadow-1)]" open={showForm}>
            <summary className="text-ink flex min-h-14 cursor-pointer items-center px-5 text-[15px] font-extrabold">{t("admin.review.edit")}</summary>
            <div className="flex flex-col gap-6 px-1 pb-2 sm:px-3">
              <ItemForm slug={slug} id={id} language={language} values={loaded.values} context={loaded.context} levels={levels} readOnly={false} />
            </div>
          </details>
        </div>
      </div>
    </>
  );
}

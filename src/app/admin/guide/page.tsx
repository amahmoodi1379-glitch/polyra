import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, MessageCircleQuestion } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { StatusChip, SuspendedChip } from "@/components/admin/status-chip";
import { formatNumber, t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { parseBlocks, type Block, type Inline } from "@/lib/guide-markup";
import { requireAdmin } from "@/server/auth/session";
import { SectionChips } from "../settings/save-bar";
import { GuideToc } from "./guide-toc";
import { guidePages } from "./links";

export const metadata: Metadata = { title: t("admin.guide.title") };

const sections = ["glance", "workbench", "steps", "kinds", "statuses", "decisions", "audio", "order", "publish", "edit", "settings", "health", "errors"] as const;
type Section = (typeof sections)[number];
type PlainSection = Exclude<Section, "steps" | "kinds" | "statuses" | "decisions">;

const steps = ["prompt", "paste", "report", "qa"] as const;
/** In the order a language is built (the same order as «ساخت محتوا»). */
const kinds = ["wordList", "words", "sentences", "units", "grammar", "translations", "conjugation", "phonics", "texts", "phrases", "dialogues", "errorfix", "writing"] as const;
const path = ["draft", "needs_review", "approved", "published"] as const;
const statuses = [...path, "suspended", "retired"] as const;
const decisions = ["candidate", "suspect", "duplicate"] as const;

/**
 * «راهنمای پنل» (PRD §13.2): every task of the panel in plain Persian, written from PRD §13 and §14.
 * The texts live in fa.json under admin.guide with the small markup of `@/lib/guide-markup`.
 */
export default async function GuidePage() {
  await requireAdmin();
  const toc = sections.map((id) => ({ id, name: t(`admin.guide.sections.${id}.title`) }));

  return (
    <>
      <PageHeader title={t("admin.guide.title")} lead={t("admin.guide.lead")} />

      <div className="lg:hidden">
        <SectionChips label={t("admin.guide.toc")} items={toc.map((item) => ({ ...item, dirty: false }))} />
      </div>

      <div className="flex flex-col gap-10 lg:grid lg:grid-cols-[minmax(0,1fr)_188px] lg:items-start lg:gap-14">
        <article className="flex min-w-0 flex-col">
          {sections.map((id) => (
            <GuideSection key={id} id={id}>
              {id === "steps" ? (
                <Steps />
              ) : id === "kinds" ? (
                <Kinds />
              ) : id === "statuses" ? (
                <Statuses />
              ) : id === "decisions" ? (
                <Decisions />
              ) : (
                <Rich text={t(`admin.guide.sections.${id as PlainSection}.body`)} />
              )}
            </GuideSection>
          ))}
        </article>
        <GuideToc label={t("admin.guide.toc")} items={toc} />
      </div>
    </>
  );
}

function GuideSection({ id, children }: { id: Section; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-line flex scroll-mt-24 flex-col gap-4 border-t py-10 first:border-t-0 first:pt-2 lg:scroll-mt-10">
      <h2 id={`${id}-title`} className="text-ink text-[21px] leading-tight font-extrabold text-balance">
        {t(`admin.guide.sections.${id}.title`)}
      </h2>
      {children}
    </section>
  );
}

function Steps() {
  return (
    <>
      <Rich text={t("admin.guide.sections.steps.lead")} />
      <ol className="bg-surface divide-line my-2 flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
        {steps.map((step, index) => (
          <li key={step} className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-3 gap-y-3 px-5 py-5 sm:px-6">
            <span className="text-brand-text text-[26px] leading-none font-extrabold tabular-nums" aria-hidden>
              {formatNumber(index + 1)}
            </span>
            <div className="flex min-w-0 flex-col gap-3">
              <h3 className="text-ink text-[16.5px] font-extrabold">
                <span className="sr-only">{t("admin.batch.stepOf", { step: index + 1, total: steps.length })}: </span>
                {t(`admin.batch.steps.${step}`)}
              </h3>
              <dl className="grid gap-x-6 gap-y-3 md:grid-cols-2">
                {(["you", "panel"] as const).map((who) => (
                  <div key={who} className="flex min-w-0 flex-col gap-1">
                    <dt className="text-ink-3 text-[12.5px] font-bold">{t(`admin.guide.${who}`)}</dt>
                    <dd className="text-ink text-[15px] leading-7">
                      <Inlines items={parseInlineOnly(t(`admin.guide.sections.steps.items.${step}.${who}`))} />
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ol>
      <Rich text={t("admin.guide.sections.steps.after")} />
    </>
  );
}

function Kinds() {
  return (
    <>
      <Rich text={t("admin.guide.sections.kinds.lead")} />
      <dl className="divide-line my-2 flex flex-col divide-y">
        {kinds.map((kind) => (
          <div key={kind} id={`kind-${kind}`} className="grid scroll-mt-24 gap-x-8 gap-y-2 py-5 first:pt-2 md:grid-cols-[11rem_minmax(0,1fr)] lg:scroll-mt-10">
            <dt className="text-ink text-[16px] leading-7 font-extrabold">{t(`admin.create.kinds.${kind}.name`)}</dt>
            <dd className="min-w-0">
              <Rich text={t(`admin.guide.sections.kinds.items.${kind}`)} />
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Statuses() {
  return (
    <>
      <Rich text={t("admin.guide.sections.statuses.lead")} />
      <ol aria-hidden className="my-1 flex flex-wrap items-center gap-x-2 gap-y-2">
        {path.map((status, index) => (
          <li key={status} className="flex items-center gap-2">
            {index > 0 ? <ArrowLeft className="text-ink-3 size-4 ltr:rotate-180" strokeWidth={2} /> : null}
            <StatusChip status={status} />
          </li>
        ))}
      </ol>
      <dl className="bg-surface divide-line flex flex-col divide-y rounded-[22px] shadow-[var(--shadow-1)]">
        {statuses.map((status) => (
          <div key={status} className="grid gap-x-6 gap-y-2 px-5 py-4 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:px-6">
            <dt className="flex items-start">{status === "suspended" ? <SuspendedChip /> : <StatusChip status={status} />}</dt>
            <dd className="text-ink text-[15px] leading-7">
              <Inlines items={parseInlineOnly(t(`admin.guide.sections.statuses.items.${status}`))} />
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Decisions() {
  return (
    <>
      <Rich text={t("admin.guide.sections.decisions.lead")} />
      <div className="my-2 flex flex-col gap-8">
        {decisions.map((item) => (
          <div key={item} id={`decision-${item}`} className="flex scroll-mt-24 flex-col gap-3 lg:scroll-mt-10">
            <div className="flex flex-col gap-0.5">
              <h3 className="text-ink text-[16.5px] font-extrabold">{t(`admin.guide.sections.decisions.items.${item}.name`)}</h3>
              <p className="text-ink-2 text-[15px] leading-7">{t(`admin.guide.sections.decisions.items.${item}.what`)}</p>
            </div>
            <figure className="bg-surface flex items-start gap-3 rounded-[18px] px-4 py-3.5 shadow-[var(--shadow-1)]">
              <MessageCircleQuestion className="text-brand-text mt-1 size-5 shrink-0" strokeWidth={1.75} aria-hidden />
              <figcaption className="sr-only">{t("admin.guide.example")}</figcaption>
              <blockquote className="text-ink text-[15px] leading-7 font-medium">
                <Inlines items={parseInlineOnly(t(`admin.guide.sections.decisions.items.${item}.example`))} />
              </blockquote>
            </figure>
            <Rich text={t(`admin.guide.sections.decisions.items.${item}.body`)} />
          </div>
        ))}
      </div>
    </>
  );
}

function parseInlineOnly(text: string): Inline[] {
  const [block] = parseBlocks(text);
  return block?.kind === "p" ? block.inline : [{ kind: "text", text }];
}

function Rich({ text }: { text: string }) {
  return (
    <div className="text-ink flex max-w-[68ch] flex-col gap-3 text-[15px] leading-7">
      {parseBlocks(text).map((block, index) => (
        <RichBlock key={index} block={block} />
      ))}
    </div>
  );
}

function RichBlock({ block }: { block: Block }) {
  if (block.kind === "p") {
    return (
      <p>
        <Inlines items={block.inline} />
      </p>
    );
  }
  const List = block.kind === "ul" ? "ul" : "ol";
  return (
    <List className="flex flex-col gap-2">
      {block.items.map((item, index) => (
        <li key={index} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1">
          {block.kind === "ul" ? (
            <span className="bg-brand/70 mt-[0.7rem] size-1.5 rounded-full" aria-hidden />
          ) : (
            <span className="text-brand-text font-extrabold tabular-nums" aria-hidden>
              {formatNumber(index + 1)}.
            </span>
          )}
          <span className="min-w-0">
            <Inlines items={item} />
          </span>
        </li>
      ))}
    </List>
  );
}

function Inlines({ items }: { items: Inline[] }) {
  return items.map((item, index) => {
    switch (item.kind) {
      case "text":
        return isolateLatin(item.text);
      case "bold":
        return (
          <strong key={index} className="font-extrabold">
            <Inlines items={item.children} />
          </strong>
        );
      case "button":
        return (
          <span
            key={index}
            className="bg-surface border-line-2 text-ink rounded-[8px] border px-1.5 py-px text-[13.5px] font-bold whitespace-nowrap shadow-[0_1px_0_var(--line-2)]"
          >
            {isolateLatin(item.text)}
          </span>
        );
      case "page": {
        const page = item.page in guidePages ? guidePages[item.page as keyof typeof guidePages] : null;
        if (!page) return item.page;
        return (
          <Link key={index} href={page.href} className="text-brand-text font-bold underline-offset-4 hover:underline">
            «{t(page.label)}»
          </Link>
        );
      }
      case "word":
        return (
          <bdi key={index} dir="ltr" className="lat text-[1.06em]">
            {item.text}
          </bdi>
        );
      case "code":
        return (
          <bdi key={index} dir="ltr" className="bg-tint rounded-[6px] px-1 font-mono text-[0.9em]">
            {item.text}
          </bdi>
        );
    }
  });
}

import type { ReactNode } from "react";
import Link from "next/link";
import { Voiced, type Voice } from "@/components/admin/voiced";
import { formatNumber, t } from "@/i18n";
import { formatDateTimeFa } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ContextOf } from "@/server/content/library/edit";
import type { ItemView } from "@/server/content/library/edit/types";
import type { LibrarySlug } from "@/server/content/library/slugs";
import { itemHref } from "../../links";

type Line = { label: string; value: ReactNode };
type Linked = { id: number; type: LibrarySlug; text: string; voice: Voice; sub?: string };

/** Where the item came from, and what it is part of or made of (PRD §13.2). */
export function ItemAside({ slug, language, view, context, top }: { slug: LibrarySlug; language: string; view: ItemView; context: unknown; top?: ReactNode }) {
  const info: Line[] = [
    { label: t("admin.library.item.created"), value: formatDateTimeFa(new Date(view.createdAt)) },
    { label: t("admin.library.item.updated"), value: formatDateTimeFa(new Date(view.updatedAt)) },
    {
      label: t("admin.library.item.batch"),
      value: view.importBatchId ? (
        <Link href={`/admin/batches/${view.importBatchId}`} className="text-brand-text font-bold underline-offset-4 hover:underline">
          {t("admin.library.item.batchLink", { id: formatNumber(view.importBatchId) })}
        </Link>
      ) : (
        t("admin.library.item.byHand")
      ),
    },
    ...(view.modelName ? [{ label: t("admin.library.item.model"), value: <bdi className="lat">{view.modelName}</bdi> }] : []),
    ...(view.promptVersion ? [{ label: t("admin.library.item.prompt"), value: <bdi className="lat">{view.promptVersion}</bdi> }] : []),
  ];
  const related = relatedOf(slug, context);

  return (
    <aside className="flex flex-col gap-4 xl:sticky xl:top-8">
      {top}
      {related.lines.length > 0 || related.groups.length > 0 ? (
        <Card title={t("admin.library.item.related")}>
          {related.lines.length > 0 ? <Lines lines={related.lines} /> : null}
          {related.groups.map((group) => (
            <div key={group.title} className="flex flex-col gap-1.5">
              <h3 className="text-ink-3 text-[12.5px] font-bold">{group.title}</h3>
              {group.items.length > 0 ? (
                <ul className="-mx-2 flex flex-col">
                  {group.items.map((item) => (
                    <li key={`${item.type}-${item.id}`}>
                      <Link href={itemHref(item.type, item.id)} className="hover:bg-tint flex flex-col rounded-[10px] px-2 py-1.5 transition-colors">
                        <Voiced text={item.text} voice={item.voice} language={language} className={cn("self-start", item.voice === "target" ? "text-ink text-[15.5px] leading-snug" : "text-ink text-[14px] leading-6")} />
                        {item.sub ? <span className="text-ink-3 text-[12.5px] leading-5">{item.sub}</span> : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-ink-3 text-[13px] leading-6">{group.empty}</p>
              )}
            </div>
          ))}
        </Card>
      ) : null}
      <Card title={t("admin.library.item.info")}>
        <Lines lines={info} />
      </Card>
    </aside>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="bg-surface flex flex-col gap-4 rounded-[22px] px-5 py-5 shadow-[var(--shadow-1)]">
      <h2 className="text-ink text-[15px] font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

function Lines({ lines }: { lines: Line[] }) {
  return (
    <dl className="flex flex-col gap-2.5 text-[13.5px]">
      {lines.map((line) => (
        <div key={line.label} className="flex items-baseline justify-between gap-4">
          <dt className="text-ink-3 shrink-0">{line.label}</dt>
          <dd className="text-ink min-w-0 text-end tabular-nums">{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}

type Group = { title: string; items: Linked[]; empty: string };

function relatedOf(slug: LibrarySlug, context: unknown): { lines: Line[]; groups: Group[] } {
  switch (slug) {
    case "words": {
      const c = context as ContextOf<"words">;
      return {
        lines: [
          { label: t("admin.library.words.code"), value: <bdi className="lat">{c.code}</bdi> },
          ...(c.frequencyRank ? [{ label: t("admin.library.words.frequency"), value: formatNumber(c.frequencyRank) }] : []),
          ...(c.senseOf ? [{ label: t("admin.library.words.senseOf"), value: <bdi className="lat">{c.senseOf}</bdi> }] : []),
          { label: t("admin.library.words.targets"), value: t("admin.library.words.targetsOf", { count: formatNumber(c.targets), goal: formatNumber(c.goal) }) },
        ],
        groups: [
          {
            title: t("admin.library.words.sentences"),
            items: c.sentences.map((sentence) => ({ id: sentence.id, type: "sentences", text: sentence.text, voice: "target", sub: sentence.translation_fa })),
            empty: t("admin.library.words.noSentences"),
          },
          ...(c.tables.length > 0
            ? [{ title: t("admin.library.words.tables"), items: c.tables.map((table) => ({ id: table.id, type: "tables" as const, text: table.tense, voice: "target" as const })), empty: "" }]
            : []),
        ],
      };
    }
    case "sentences": {
      const c = context as ContextOf<"sentences">;
      return {
        lines: [
          { label: t("admin.library.sentences.level"), value: c.level ? <bdi className="lat">{c.level}</bdi> : "—" },
        ],
        groups: [
          {
            title: t("admin.library.sentences.uses"),
            items: c.uses.map((use) => ({ id: use.id, type: use.type, text: use.title, voice: use.voice, sub: t(`admin.library.types.${use.type}`) })),
            empty: t("admin.library.sentences.noUses"),
          },
        ],
      };
    }
    case "units": {
      const c = context as ContextOf<"units">;
      return {
        lines: [
          { label: t("content.fields.unit_code"), value: <bdi className="lat">{c.unitCode}</bdi> },
          { label: t("admin.library.units.counts.targets"), value: t("admin.library.words.targetsOf", { count: formatNumber(c.counts.targets), goal: formatNumber(c.counts.minTargets) }) },
          { label: t("admin.library.units.counts.transforms"), value: formatNumber(c.counts.transforms) },
          { label: t("admin.library.units.counts.translations"), value: formatNumber(c.counts.translations) },
          { label: t("admin.library.units.counts.tables"), value: formatNumber(c.counts.tables) },
        ],
        groups: [
          {
            title: t("admin.library.units.examples"),
            items: c.examples.map((sentence) => ({ id: sentence.id, type: "sentences", text: sentence.text, voice: "target", sub: sentence.translation_fa })),
            empty: t("admin.library.units.noExamples"),
          },
        ],
      };
    }
    case "transforms":
    case "translations": {
      const c = context as ContextOf<"transforms">;
      return {
        lines: [],
        groups: [
          {
            title: t("admin.library.grammarItems.unit"),
            items: [{ id: c.unit.id, type: "units", text: c.unit.title_fa, voice: "fa", sub: c.unit.unit_code }],
            empty: "",
          },
        ],
      };
    }
    case "texts": {
      const c = context as ContextOf<"texts">;
      return {
        lines: [
          { label: t("content.fields.code"), value: <bdi className="lat">{c.code}</bdi> },
          { label: t("content.fields.kind"), value: t("admin.library.texts.kindLine", { kind: c.kindName, band: formatNumber(c.band) }) },
          ...(c.wordCount ? [{ label: t("admin.library.texts.sentences"), value: t("admin.library.texts.words", { count: formatNumber(c.wordCount) }) }] : []),
        ],
        groups: [],
      };
    }
    case "dialogues": {
      const c = context as ContextOf<"dialogues">;
      return { lines: [{ label: t("content.fields.code"), value: <bdi className="lat">{c.code}</bdi> }], groups: [] };
    }
    case "phonics": {
      const c = context as ContextOf<"phonics">;
      return {
        lines: [
          { label: t("content.fields.kind"), value: t(`admin.library.phonicsKind.${c.kind}`) },
          ...(c.orderNo ? [{ label: t("admin.library.phonics.orderLabel"), value: formatNumber(c.orderNo) }] : []),
        ],
        groups: [],
      };
    }
    default:
      return { lines: [], groups: [] };
  }
}

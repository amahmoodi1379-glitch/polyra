import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import { formatAgoFa } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireAdmin } from "@/server/auth/session";
import { batchParams, batchStep, type KindSlug } from "@/server/content/batches";
import { isLanguage, languageCodes, type LanguageCode } from "@/server/content/languages";
import { contentStatus } from "@/server/content/status";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { startBatch } from "./actions";

export const metadata: Metadata = { title: t("admin.create.title") };

type Row = {
  slug: KindSlug;
  name: string;
  status: string;
  action: string | null;
  level?: string;
};

/** Which language this page works in: the URL, else the panel's language, else French. */
function pickLanguage(requested: string | undefined, scope: string | null): LanguageCode {
  if (requested && isLanguage(requested)) return requested;
  if (scope && isLanguage(scope)) return scope;
  return "fr";
}

export default async function CreatePage({ searchParams }: PageProps<"/admin/create">) {
  const admin = await requireAdmin("/admin/create");
  const query = await searchParams;
  const language = pickLanguage(typeof query.lang === "string" ? query.lang : undefined, admin.admin_language);
  const error = typeof query.error === "string" ? query.error : null;

  const [status, sizes, open] = await Promise.all([
    contentStatus(language),
    appSetting<Record<string, number>>("batch.sizes"),
    db.importBatch.findMany({
      where: { language, state: { in: ["prompt_made", "pasted", "imported"] } },
      orderBy: { updated_at: "desc" },
      take: 12,
    }),
  ]);
  const unfinished = open.filter((batch) => batchStep(batch) < 5);
  const now = new Date();

  const info = status.wordsWithoutInfo[0];
  const short = status.wordsWithoutSentences[0];
  const unitLevel = status.levelsWithoutUnits[0];
  const rows: Row[] = [
    {
      slug: "word-list",
      name: t("admin.create.kinds.wordList.name"),
      status: status.frequencyLeft
        ? t("admin.create.kinds.wordList.status", { count: status.frequencyLeft })
        : t("admin.create.nothing.frequency"),
      action: status.frequencyLeft
        ? t("admin.create.kinds.wordList.action", { size: Math.min(sizes["P-C"] ?? 200, status.frequencyLeft) })
        : null,
    },
    {
      slug: "words",
      name: t("admin.create.kinds.words.name"),
      status: info
        ? t("admin.create.kinds.words.status", { count: info.count, level: info.level })
        : status.wordCount
          ? t("admin.create.nothing.words")
          : t("admin.create.kinds.words.needsList"),
      action: info ? t("admin.create.kinds.words.action", { size: Math.min(sizes["P-W"] ?? 50, info.count) }) : null,
      level: info?.level,
    },
    {
      slug: "sentences",
      name: t("admin.create.kinds.sentences.name"),
      status: short
        ? t("admin.create.kinds.sentences.status", { count: short.count, level: short.level, goal: status.sentenceGoal })
        : status.wordCount
          ? t("admin.create.nothing.sentences")
          : t("admin.create.kinds.sentences.needsWords"),
      action: short ? t("admin.create.kinds.sentences.action", { size: Math.min(sizes["P-S"] ?? 10, short.count) }) : null,
      level: short?.level,
    },
    {
      slug: "units",
      name: t("admin.create.kinds.units.name"),
      status: unitLevel ? t("admin.create.kinds.units.status", { level: unitLevel }) : t("admin.create.nothing.units"),
      action: unitLevel ? t("admin.create.kinds.units.action", { level: unitLevel }) : null,
      level: unitLevel,
    },
  ];
  // One clear next step: the first kind on the main path that has work.
  const primary = rows.find((row) => row.action && row.slug !== "units")?.slug ?? rows.find((row) => row.action)?.slug;

  return (
    <>
      <PageHeader
        title={t("admin.create.title")}
        lead={t("admin.create.lead")}
        actions={admin.admin_language === "all" ? <LanguageTabs current={language} /> : null}
      />

      {error ? (
        <p role="alert" className="bg-bad-soft text-bad rounded-[16px] px-5 py-3.5 text-[14.5px] font-medium">
          {t("errors.withCode", { code: error })}
        </p>
      ) : null}

      {unfinished.length > 0 ? (
        <section aria-labelledby="unfinished" className="flex flex-col gap-3">
          <h2 id="unfinished" className="text-ink text-[17px] font-extrabold">
            {t("admin.create.unfinished")}
          </h2>
          <ul className="bg-surface rounded-[22px] shadow-[var(--shadow-1)]">
            {unfinished.map((batch) => {
              const params = batchParams(batch);
              return (
                <li key={batch.id} className="border-line flex items-center gap-4 border-b px-5 py-3.5 last:border-b-0">
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-ink truncate font-bold">
                      {t(`admin.batch.kind.${batch.prompt_kind}` as MessageKey)}
                      {params.level && params.level.length === 2 ? <span className="lat text-ink-2 ms-2 font-semibold">{params.level}</span> : null}
                    </span>
                    <span className="text-ink-3 text-[13px]">
                      {t("admin.create.unfinishedStep", { step: batchStep(batch), total: 4 })} · {formatAgoFa(batch.updated_at, now)}
                    </span>
                  </div>
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/admin/batches/${batch.id}`}>
                      {t("admin.create.continue")}
                      <ArrowLeft className="rtl:scale-x-100 ltr:-scale-x-100" strokeWidth={1.75} aria-hidden />
                    </Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-label={t("admin.create.title")} className="flex flex-col gap-3">
        <ol className="bg-surface rounded-[22px] shadow-[var(--shadow-1)]">
          {rows.map((row) => (
            <li
              key={row.slug}
              className="border-line flex flex-col gap-3 border-b px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:gap-6 sm:px-6"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h3 className="text-ink text-[16px] font-extrabold">{row.name}</h3>
                <p className={cn("text-[14.5px]", row.action ? "text-ink-2" : "text-ink-3")}>{row.status}</p>
              </div>
              {row.action ? (
                <form action={startBatch} className="shrink-0">
                  <input type="hidden" name="kind" value={row.slug} />
                  <input type="hidden" name="language" value={language} />
                  {row.level ? <input type="hidden" name="level" value={row.level} /> : null}
                  <Button type="submit" variant={row.slug === primary ? "default" : "secondary"} className="w-full sm:w-auto">
                    {row.action}
                  </Button>
                </form>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="text-ink-3 px-1 text-[13.5px]">{t("admin.create.soon")}</p>
      </section>
    </>
  );
}

function LanguageTabs({ current }: { current: LanguageCode }) {
  return (
    <nav aria-label={t("admin.create.language")} className="bg-tint grid grid-cols-2 gap-1 rounded-[16px] p-1">
      {languageCodes.map((code) => (
        <Link
          key={code}
          href={`/admin/create?lang=${code}`}
          aria-current={code === current ? "page" : undefined}
          className={cn(
            "flex h-9 min-w-24 items-center justify-center rounded-[12px] px-4 text-[13.5px] font-bold transition-[background-color,color,box-shadow] duration-150",
            code === current ? "bg-surface dark:bg-tint-2 text-brand-text shadow-[var(--shadow-1)]" : "text-ink-2 hover:text-ink",
          )}
        >
          {t(`common.languages.${code}`)}
        </Link>
      ))}
    </nav>
  );
}

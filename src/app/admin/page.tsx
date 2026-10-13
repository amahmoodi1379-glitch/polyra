import Link from "next/link";
import { ArrowLeft, ClipboardPaste } from "lucide-react";
import { PageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import { requireAdmin } from "@/server/auth/session";
import { batchStep, hasQa, type KindSlug } from "@/server/content/batches";
import { isLanguage, languageCodes, type LanguageCode } from "@/server/content/languages";
import { typeCounts } from "@/server/content/library/list";
import { librarySlugs } from "@/server/content/library/slugs";
import { contentStatus } from "@/server/content/status";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { libraryHref } from "./content/links";
import { startBatch } from "./create/actions";

type Action = { start: KindSlug; level?: string; label: string } | { href: string; label: string };
type WorkRow = { key: string; text: string; action: Action | null; note?: string };

async function languageRows(language: LanguageCode, sizes: Record<string, number>) {
  const [status, open, reviewing, approved] = await Promise.all([
    contentStatus(language),
    db.importBatch.findMany({
      where: { language, state: { in: ["prompt_made", "pasted", "imported"] } },
      orderBy: { updated_at: "asc" },
    }),
    typeCounts(language, "needs_review"),
    typeCounts(language, "approved"),
  ]);
  const unfinished = open.filter((batch) => batchStep(batch) < 4);
  const waitingQa = open.filter((batch) => batch.state === "imported" && hasQa(batch.prompt_kind) && batchStep(batch) === 4);
  const rows: WorkRow[] = [];

  if (unfinished.length) {
    rows.push({
      key: "unfinished",
      text: t("admin.workbench.rows.unfinished", { count: unfinished.length }),
      action: {
        href: unfinished.length === 1 ? `/admin/batches/${unfinished[0].id}` : `/admin/create?lang=${language}`,
        label: t("admin.workbench.actions.continue"),
      },
    });
  }
  if (waitingQa.length) {
    rows.push({
      key: "qa",
      text: t("admin.workbench.rows.waitingQa", { count: waitingQa.length }),
      action: { href: `/admin/batches/${waitingQa[0].id}`, label: t("admin.workbench.actions.qa") },
    });
  }
  const info = status.wordsWithoutInfo[0];
  if (info) {
    rows.push({
      key: "words",
      text: t("admin.workbench.rows.wordsWithoutInfo", { count: info.count, level: info.level }),
      action: {
        start: "words",
        level: info.level,
        label: t("admin.workbench.actions.words", { size: Math.min(sizes["P-W"] ?? 50, info.count) }),
      },
    });
  }
  const short = status.wordsWithoutSentences[0];
  if (short) {
    rows.push({
      key: "sentences",
      text: t("admin.workbench.rows.wordsWithoutSentences", { count: short.count, level: short.level, goal: status.sentenceGoal }),
      action: {
        start: "sentences",
        level: short.level,
        label: t("admin.workbench.actions.sentences", { size: Math.min(sizes["P-S"] ?? 10, short.count) }),
      },
    });
  }
  const unitLevel = status.levelsWithoutUnits[0];
  if (unitLevel && status.wordCount) {
    rows.push({
      key: "units",
      text: t("admin.workbench.rows.unitsMissing", { level: unitLevel }),
      action: { start: "units", level: unitLevel, label: t("admin.workbench.actions.units") },
    });
  }
  const grammar = status.grammarNext;
  if (grammar) {
    rows.push({
      key: "grammar",
      text: t("admin.workbench.rows.grammar", { count: grammar.count, level: grammar.level, title: grammar.title }),
      action: { start: "grammar", level: grammar.level, label: t("admin.workbench.actions.grammar") },
    });
  }
  const translations = status.translationsNext;
  if (translations) {
    rows.push({
      key: "translations",
      text: t("admin.workbench.rows.translations", {
        count: translations.count,
        level: translations.level,
        goal: translations.want,
        title: translations.title,
      }),
      action: { start: "translations", level: translations.level, label: t("admin.workbench.actions.translations") },
    });
  }
  const tables = status.tables.next;
  if (tables) {
    rows.push({
      key: "conjugation",
      text: t("admin.workbench.rows.conjugation", { count: tables.count, level: tables.level }),
      action: {
        start: "conjugation",
        level: tables.level,
        label:
          Math.min(sizes["P-X"] ?? 20, tables.count) === 1
            ? t("admin.workbench.actions.conjugationOne")
            : t("admin.workbench.actions.conjugation", { size: Math.min(sizes["P-X"] ?? 20, tables.count) }),
      },
    });
  }
  const sounds = status.phonicsNext;
  if (sounds) {
    rows.push({
      key: "phonics",
      text: t("admin.workbench.rows.phonics", { count: sounds.count, label: sounds.label }),
      action: { start: "phonics", label: t("admin.workbench.actions.phonics") },
    });
  }
  const texts = status.texts;
  if (texts.state === "ready") {
    rows.push({
      key: "texts",
      text: t("admin.workbench.rows.texts", { count: texts.left, level: texts.level, goal: texts.goal }),
      action: {
        start: "texts",
        level: texts.level,
        label: texts.size === 1 ? t("admin.workbench.actions.textsOne") : t("admin.workbench.actions.texts", { size: texts.size }),
      },
    });
  }
  const phraseList = status.phrases;
  if (phraseList.state === "ready") {
    rows.push({
      key: "phrases",
      text: t("admin.workbench.rows.phrases", { count: phraseList.count, level: phraseList.level, goal: phraseList.goal }),
      action: { start: "phrases", level: phraseList.level, label: t("admin.workbench.actions.phrases") },
    });
  }
  for (const [key, next] of [
    ["dialogues", status.dialogues],
    ["errorfix", status.errorfix],
    ["writing", status.writing],
  ] as const) {
    if (next.state !== "ready") continue;
    rows.push({
      key,
      text: t(`admin.workbench.rows.${key}`, { count: next.left, level: next.level, goal: next.goal }),
      action: { start: key, level: next.level, label: t(`admin.workbench.actions.${key}`, { size: next.size }) },
    });
  }
  if (status.candidates + status.suspects > 0) {
    rows.push({
      key: "review",
      text: t("admin.workbench.rows.review", { candidates: status.candidates, suspects: status.suspects }),
      action: { href: `/admin/resolve?lang=${language}`, label: t("admin.workbench.actions.resolve") },
    });
  }
  const toReview = librarySlugs.reduce((sum, slug) => sum + reviewing[slug], 0);
  if (toReview) {
    // The type with the most items waiting opens first; the library's type tabs lead to the rest.
    const type = librarySlugs.reduce((best, slug) => (reviewing[slug] > reviewing[best] ? slug : best));
    rows.push({
      key: "needsReview",
      text: t("admin.workbench.rows.needsReview", { count: toReview }),
      action: { href: libraryHref({ language, type, status: "needs_review" }), label: t("admin.workbench.actions.review") },
    });
  }
  const toPublish = librarySlugs.reduce((sum, slug) => sum + approved[slug], 0);
  if (toPublish) {
    rows.push({
      key: "publish",
      text: t("admin.workbench.rows.publish", { count: toPublish }),
      action: { href: `/admin/publish?lang=${language}`, label: t("admin.workbench.actions.publish") },
    });
  }
  if (status.duplicates) {
    rows.push({
      key: "duplicates",
      text: t("admin.workbench.rows.duplicates", { count: status.duplicates }),
      action: { href: `/admin/resolve?lang=${language}#duplicates`, label: t("admin.workbench.actions.decide") },
    });
  }
  return { rows, empty: status.wordCount === 0 && open.length === 0 };
}

export default async function WorkbenchPage() {
  const admin = await requireAdmin();
  const scope = admin.admin_language;
  const languages = scope && isLanguage(scope) ? [scope] : [...languageCodes];
  const sizes = await appSetting<Record<string, number>>("batch.sizes");
  const sections = await Promise.all(languages.map(async (language) => ({ language, ...(await languageRows(language, sizes)) })));

  return (
    <>
      <PageHeader title={t("admin.workbench.title")} lead={t("admin.workbench.lead")} />
      {sections.map(({ language, rows, empty }) => (
        <section key={language} aria-label={t(`common.languages.${language}`)} className="flex flex-col gap-3">
          {languages.length > 1 ? (
            <h2 className="text-ink text-[17px] font-extrabold">{t(`common.languages.${language}`)}</h2>
          ) : null}
          {empty ? (
            <EmptyLanguage language={language} />
          ) : rows.length === 0 ? (
            <p className="bg-surface text-ink-2 rounded-[22px] px-5 py-4 shadow-[var(--shadow-1)] sm:px-6">{t("admin.workbench.allDone")}</p>
          ) : (
            <ul className="bg-surface rounded-[22px] shadow-[var(--shadow-1)]">
              {rows.map((row, index) => (
                <li
                  key={row.key}
                  className="border-line flex flex-col gap-3 border-b px-5 py-4 last:border-b-0 sm:flex-row sm:items-center sm:gap-6 sm:px-6"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="text-ink text-[15.5px] font-bold">{isolateLatin(row.text)}</p>
                    {row.note ? <p className="text-ink-3 text-[13.5px]">{row.note}</p> : null}
                  </div>
                  {row.action ? <RowAction action={row.action} language={language} primary={index === 0} /> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}

function RowAction({ action, language, primary }: { action: Action; language: LanguageCode; primary: boolean }) {
  const variant = primary ? "default" : "secondary";
  if ("href" in action) {
    return (
      <Button asChild variant={variant} className="w-full shrink-0 sm:w-auto">
        <Link href={action.href}>
          {action.label}
          <ArrowLeft className="ltr:-scale-x-100" strokeWidth={1.75} aria-hidden />
        </Link>
      </Button>
    );
  }
  return (
    <form action={startBatch} className="shrink-0">
      <input type="hidden" name="kind" value={action.start} />
      <input type="hidden" name="language" value={language} />
      {action.level ? <input type="hidden" name="level" value={action.level} /> : null}
      <Button type="submit" variant={variant} className="w-full sm:w-auto">
        {action.label}
      </Button>
    </form>
  );
}

function EmptyLanguage({ language }: { language: LanguageCode }) {
  return (
    <div className="bg-surface flex flex-col items-start gap-4 rounded-[22px] p-6 shadow-[var(--shadow-1)] sm:p-8">
      <h3 className="text-ink text-lg font-extrabold">{t("admin.workbench.emptyTitle")}</h3>
      <p className="text-ink-2 max-w-[60ch]">{t("admin.workbench.emptyBody")}</p>
      <Button asChild>
        <Link href={`/admin/create?lang=${language}`}>
          <ClipboardPaste strokeWidth={1.75} aria-hidden />
          {t("admin.workbench.emptyAction")}
        </Link>
      </Button>
    </div>
  );
}

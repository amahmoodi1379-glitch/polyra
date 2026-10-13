import type { AdminLog, Prisma } from "@/generated/prisma/client";
import { formatNumber, t, type MessageKey } from "@/i18n";
import fa from "@/i18n/fa.json";
import { movedRows } from "@/lib/arrange";
import { isolateLatin } from "@/lib/bidi";
import { formatMobileFa } from "@/lib/phone";
import { wordDiff, type DiffPart } from "@/lib/text-diff";
import { db } from "@/server/db";
import { settingLog } from "@/server/settings/history";
import { appSetting } from "@/server/settings/read";
import { parseSlot } from "../audio/slots";
import { correctedText } from "../kinds/errorfix";
import { languageCodes } from "../languages";
import { orderEntity, type OrderList } from "../order";
import type { Voice } from "./list";
import { isSettingRow, latestRows, revertible, settingEntities } from "./revert";
import { entityOf, isLibrarySlug, librarySlugs, type LibrarySlug } from "./slugs";

/**
 * «لاگ تغییرها» (PRD §13.2): `admin_log`, newest first, each row in plain Persian: what item, what
 * kind of change, who and when, and each changed field before and after. Publishing, opening a level
 * and showing a language (`/admin/publish`) are logged too, but cannot be put back from here.
 */

export const LOG_PAGE_SIZE = 30;
export const logKinds = [...librarySlugs, "order", "publish", "settings"] as const;
export type LogKind = (typeof logKinds)[number];
export const isLogKind = (value: unknown): value is LogKind => logKinds.includes(value as LogKind);

export type Shown = { text: string; voice: Voice } | null;
export type ChangeLine = { key: string; label: string; before?: Shown; after?: Shown; note?: string; diff?: { parts: DiffPart[]; voice: Voice } };
export type LogItem = {
  id: number;
  ts: string;
  action: string;
  actionLabel: string;
  kindLabel: string;
  title: Shown;
  href: string | null;
  language: string | null;
  who: string;
  lines: ChangeLine[];
  /** «برگردان» shows only on the newest row of an item; older rows say why not. */
  revert: "ready" | "later" | "no";
};
export type LogPage = { items: LogItem[]; total: number; page: number; pages: number };

const slugOfEntity = Object.fromEntries(Object.entries(entityOf).map(([slug, entity]) => [entity, slug])) as Record<string, LibrarySlug>;
const orderListOf = Object.fromEntries(Object.entries(orderEntity).map(([list, entity]) => [entity, list])) as Record<string, OrderList>;
/** The rows `/admin/publish` writes: one per publish run, level opened or closed, language shown or hidden. */
const publishEntities = ["publish", "level_release", "language"];
const isPublishRow = (row: Pick<AdminLog, "entity">) => publishEntities.includes(row.entity);
const isOrderRow = (row: Pick<AdminLog, "entity" | "entity_id">) => !isPublishRow(row) && !isSettingRow(row) && !/^\d+$/.test(row.entity_id ?? "");
const isItemRow = (row: Pick<AdminLog, "entity" | "entity_id">) => !isPublishRow(row) && !isSettingRow(row) && !isOrderRow(row);

/** The `entity_id` values order rows can have: a language, or language and level. */
async function orderKeys() {
  const keys: string[] = [];
  for (const language of languageCodes) {
    keys.push(language);
    for (const level of await appSetting<string[]>(`levels.${language}`)) keys.push(`${language}:${level}`);
  }
  return keys;
}

async function whereOf(kind: LogKind | null): Promise<Prisma.AdminLogWhereInput> {
  if (!kind) return {};
  if (kind === "publish") return { entity: { in: publishEntities } };
  if (kind === "settings") return { entity: { in: settingEntities } };
  const keys = await orderKeys();
  if (kind === "order") return { entity: { in: Object.values(orderEntity) }, entity_id: { in: keys } };
  return { entity: entityOf[kind], NOT: { entity_id: { in: keys } } };
}

const arabicScript = /[؀-ۿ]/;
const voiceOf = (text: string): Voice => (arabicScript.test(text) ? "fa" : "target");
const shown = (text: string | null | undefined, voice?: Voice): Shown => (text === null || text === undefined || text === "" ? null : { text, voice: voice ?? voiceOf(text) });

/** The title of an item, from the row as it is now or as it was when deleted. */
function titleOf(entity: string, row: Record<string, unknown>): Shown {
  switch (entity) {
    case "word":
      return shown(row.lemma as string, "target");
    case "sentence":
      return shown(row.text as string, "target");
    case "grammar_unit":
      return shown(row.title_fa as string, "fa");
    case "conjugation_table":
      return shown([(row.word as { lemma?: string } | undefined)?.lemma, row.tense].filter(Boolean).join(" · "), "target");
    case "transform_item":
      return shown(row.source_sentence as string, "target");
    case "translate_item":
      return shown(row.prompt_fa as string, "fa");
    case "text":
      return shown(row.title as string, "target");
    case "dialogue":
      return shown(row.title_fa as string, "fa");
    case "errorfix_item":
      return shown(typeof row.marked_text === "string" ? correctedText(row.marked_text) : null, "target");
    case "writing_task":
      return shown(row.prompt_fa as string, "fa");
    case "phonics_lesson":
      return shown(row.sound_label as string, "fa");
    default:
      return null;
  }
}

type PublishAfter = { items?: Partial<Record<LibrarySlug, number[]>>; children?: { sentences?: number; questions?: number; targets?: number } };
const PUBLISH_TITLES = 3;

/** The items a page names: each item row's own item, and the first few items of each publish run. */
function itemKeys(rows: AdminLog[]) {
  return rows.flatMap((row) => {
    if (isItemRow(row)) return [{ entity: row.entity, id: Number(row.entity_id) }];
    if (row.entity !== "publish") return [];
    const items = (row.after as PublishAfter | null)?.items ?? {};
    return librarySlugs.flatMap((slug) => (items[slug] ?? []).slice(0, PUBLISH_TITLES).map((id) => ({ entity: entityOf[slug], id })));
  });
}

/** The items of a page, read in one query per table. */
async function itemsOf(keys: { entity: string; id: number }[]) {
  const ids = (entity: string) => [...new Set(keys.filter((key) => key.entity === entity).map((key) => key.id))];
  const pick = { id: true, language: true } as const;
  const found = await Promise.all([
    db.word.findMany({ where: { id: { in: ids("word") } }, select: { ...pick, lemma: true } }),
    db.sentence.findMany({ where: { id: { in: ids("sentence") } }, select: { ...pick, text: true } }),
    db.grammarUnit.findMany({ where: { id: { in: ids("grammar_unit") } }, select: { ...pick, title_fa: true } }),
    db.conjugationTable.findMany({ where: { id: { in: ids("conjugation_table") } }, select: { ...pick, tense: true, word: { select: { lemma: true } } } }),
    db.transformItem.findMany({ where: { id: { in: ids("transform_item") } }, select: { ...pick, source_sentence: true } }),
    db.translateItem.findMany({ where: { id: { in: ids("translate_item") } }, select: { ...pick, prompt_fa: true } }),
    db.text.findMany({ where: { id: { in: ids("text") } }, select: { ...pick, title: true } }),
    db.dialogue.findMany({ where: { id: { in: ids("dialogue") } }, select: { ...pick, title_fa: true } }),
    db.errorfixItem.findMany({ where: { id: { in: ids("errorfix_item") } }, select: { ...pick, marked_text: true } }),
    db.writingTask.findMany({ where: { id: { in: ids("writing_task") } }, select: { ...pick, prompt_fa: true } }),
    db.phonicsLesson.findMany({ where: { id: { in: ids("phonics_lesson") } }, select: { ...pick, sound_label: true } }),
  ]);
  const entities = [
    "word",
    "sentence",
    "grammar_unit",
    "conjugation_table",
    "transform_item",
    "translate_item",
    "text",
    "dialogue",
    "errorfix_item",
    "writing_task",
    "phonics_lesson",
  ];
  const map = new Map<string, Record<string, unknown>>();
  entities.forEach((entity, index) => {
    for (const item of found[index] as Record<string, unknown>[]) map.set(`${entity}:${item.id}`, item);
  });
  return map;
}

/** Titles of the items an order row moved, for «از جای ۲۱ به جای ۲». */
async function orderTitles(rows: AdminLog[]) {
  const wanted = (entity: string) =>
    rows.filter((row) => row.entity === entity && isOrderRow(row)).flatMap((row) => [...(((row.after as { order?: number[] } | null)?.order ?? []) as number[])]);
  const [words, units, lessons, texts] = await Promise.all([
    db.word.findMany({ where: { id: { in: wanted("word") } }, select: { id: true, lemma: true } }),
    db.grammarUnit.findMany({ where: { id: { in: wanted("grammar_unit") } }, select: { id: true, title_fa: true } }),
    db.phonicsLesson.findMany({ where: { id: { in: wanted("phonics_lesson") } }, select: { id: true, sound_label: true } }),
    db.text.findMany({ where: { id: { in: wanted("text") } }, select: { id: true, title: true } }),
  ]);
  return new Map<string, Shown>([
    ...words.map((row) => [`word:${row.id}`, shown(row.lemma, "target")] as const),
    ...units.map((row) => [`grammar_unit:${row.id}`, shown(row.title_fa, "fa")] as const),
    ...lessons.map((row) => [`phonics_lesson:${row.id}`, shown(row.sound_label, "fa")] as const),
    ...texts.map((row) => [`text:${row.id}`, shown(row.title, "target")] as const),
  ]);
}

const fieldKeys = new Set(Object.keys(fa.content.fields));
const logFieldKeys = new Set(Object.keys(fa.admin.log.fields));

function fieldLabel(key: string) {
  if (logFieldKeys.has(key)) return t(`admin.log.fields.${key}` as MessageKey);
  if (fieldKeys.has(key)) return t(`content.fields.${key}` as MessageKey);
  return t("admin.log.fields.other");
}

const optionKeys: Record<string, string> = { gender: "gender", number: "number", register: "register", mastery: "mastery" };

/** One value in plain Persian; null when there is nothing to show as text (lists and objects). */
function valueOf(key: string, value: unknown): Shown | undefined {
  if (value === null || value === undefined || value === "") return null;
  if (key === "status" && typeof value === "string") return shown(t(`admin.library.statuses.${value}` as MessageKey), "fa");
  if (key === "pos" && typeof value === "string") return shown(t(`content.pos.${value}` as MessageKey), "fa");
  if (optionKeys[key] && typeof value === "string") return shown(t(`admin.library.options.${optionKeys[key]}.${value}` as MessageKey), "fa");
  if (typeof value === "boolean") return shown(value ? t("admin.log.yes") : t("admin.log.no"), "fa");
  if (typeof value === "number") return shown(formatNumber(value), "fa");
  if (typeof value === "string") return shown(value);
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    if (value.length === 0) return null;
    const joined = (value as string[]).join(voiceOf(value.join("")) === "fa" ? "، " : " / ");
    return shown(joined);
  }
  return undefined;
}

const hidden = new Set(["text_hash"]);

const LONG_TEXT = 60;
const sameShown = (a: Shown, b: Shown) => (a?.text ?? "") === (b?.text ?? "");
const isFlatObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => typeof item === "string" || (Array.isArray(item) && item.every((entry) => typeof entry === "string")));
/** A form key such as `il_elle_on` as the table form shows it: «il / elle / on», kept left to right inside the Persian label. */
const subLabel = (key: string) => `\u2066${key.replaceAll("_", " / ")}\u2069`;

/** One changed field: before and after, a word diff for long text, or a short note for structures. */
function fieldLines(key: string, label: string, from: unknown, to: unknown): ChangeLine[] {
  // Child rows set to one status by a status change: «۵ مورد: کنارگذاشته».
  if (Array.isArray(to) && to.length > 0 && to.every((item) => item && typeof item === "object" && Object.keys(item).every((name) => name === "id" || name === "status"))) {
    const statuses = [...new Set(to.map((item) => (item as { status: string }).status))];
    return [
      { key, label, note: t("admin.log.childrenStatus", { count: to.length, status: statuses.map((status) => t(`admin.library.statuses.${status}` as MessageKey)).join("، ") }) },
    ];
  }
  // Conjugation forms and their variants: one line per pronoun that changed.
  if ((isFlatObject(from) || from === null) && (isFlatObject(to) || to === null) && (from || to)) {
    const a = (from ?? {}) as Record<string, unknown>;
    const b = (to ?? {}) as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((sub) => fieldLines(`${key}.${sub}`, `${label}: ${subLabel(sub)}`, a[sub] ?? null, b[sub] ?? null));
  }
  const before = valueOf(key, from);
  const after = valueOf(key, to);
  if (before !== undefined && after !== undefined && !["concept_id", "key_word_ids"].includes(key)) {
    if (sameShown(before, after)) return [];
    if (before && after && before.voice === after.voice && Math.max(before.text.length, after.text.length) > LONG_TEXT) {
      return [{ key, label, diff: { parts: wordDiff(before.text, after.text), voice: after.voice } }];
    }
    return [{ key, label, before, after }];
  }
  if (Array.isArray(from) && Array.isArray(to) && from.length !== to.length) return [{ key, label, note: t("admin.log.listChanged", { before: from.length, after: to.length }) }];
  return [{ key, label, note: t("admin.log.changed") }];
}

/** The changed fields of an edit, status change or revert. */
function changeLines(row: AdminLog): ChangeLine[] {
  const before = (row.before ?? {}) as Record<string, unknown>;
  const after = (row.after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !hidden.has(key));
  return keys.flatMap((key) => fieldLines(key, fieldLabel(key), before[key], after[key]));
}

/** An audio row: which recording of the item, and whether it was put in, replaced or taken out. */
function audioLines(row: AdminLog): ChangeLine[] {
  const before = (row.before ?? {}) as { slot?: string; which?: string; asset?: number | null; offsets?: number[] };
  const after = (row.after ?? {}) as { asset?: number | null };
  const slot = parseSlot(before.slot ?? "");
  const part = slot?.kind === "phonics" ? ` (${t(`admin.audio.parts.${slot.part}`, { number: slot.index + 1 })})` : "";
  const what = before.offsets ? "synced" : before.asset == null ? "added" : after.asset == null ? "removed" : "replaced";
  return [{ key: "audio", label: t(before.which === "human" ? "admin.log.audio.human" : "admin.log.audio.machine") + part, note: t(`admin.log.audio.${what}`) }];
}

/** What an order save moved: each moved row with its old and new place. */
function orderLines(row: AdminLog, titles: Map<string, Shown>): ChangeLine[] {
  const before = (row.before ?? {}) as { order?: number[]; manual?: boolean };
  const after = (row.after ?? {}) as { order?: number[]; manual?: boolean };
  const lines: ChangeLine[] = [];
  if (before.manual !== undefined && before.manual !== after.manual) {
    lines.push({ key: "manual", label: t("admin.log.actions.order"), note: t(after.manual ? "admin.log.becameManual" : "admin.log.becameAuto") });
  }
  const old = before.order ?? [];
  const next = after.order ?? [];
  // Only the rows the teacher moved; the rest just made room (a phrase that follows its word counts too).
  const moves = movedRows(old, next).map((id) => ({ id, from: old.indexOf(id), to: next.indexOf(id) }));
  for (const move of moves.slice(0, 3)) {
    const title = titles.get(`${row.entity}:${move.id}`);
    lines.push({
      key: `move-${move.id}`,
      label: title?.text ?? t("admin.log.unknownItem", { id: formatNumber(move.id) }),
      note: t("admin.log.moved", { from: move.from + 1, to: move.to + 1 }),
    });
  }
  if (moves.length > 3) lines.push({ key: "more", label: "", note: t("admin.log.movedMore", { count: moves.length - 3 }) });
  return lines;
}

const SHORT_TITLE = 40;
const shortTitle = (text: string) => (text.length > SHORT_TITLE ? `${text.slice(0, SHORT_TITLE - 1).trimEnd()}…` : text);

/** A publish run: how many of each type, with the first few by name, and the rows that went with them. */
function publishLines(row: AdminLog, items: Map<string, Record<string, unknown>>): ChangeLine[] {
  const after = (row.after ?? {}) as PublishAfter;
  const lines = librarySlugs.flatMap((slug): ChangeLine[] => {
    const ids = after.items?.[slug] ?? [];
    if (ids.length === 0) return [];
    const names = ids.slice(0, PUBLISH_TITLES).map((id) => {
      const item = items.get(`${entityOf[slug]}:${id}`);
      const title = item ? titleOf(entityOf[slug], item) : null;
      return title ? shortTitle(title.text) : t("admin.log.unknownItem", { id: formatNumber(id) });
    });
    const list = isolateLatin(names.join("، "));
    const more = ids.length - names.length;
    return [
      {
        key: slug,
        label: t(`admin.library.types.${slug}`),
        note: more > 0 ? t("admin.log.publish.itemsMore", { count: ids.length, list, more }) : t("admin.log.publish.items", { count: ids.length, list }),
      },
    ];
  });
  const children = after.children ?? {};
  const parts = (["sentences", "questions", "targets"] as const)
    .filter((key) => (children[key] ?? 0) > 0)
    .map((key) => t(`admin.log.publish.children.${key}`, { count: children[key]! }));
  if (parts.length > 0) lines.push({ key: "children", label: t("admin.log.publish.childrenLabel"), note: parts.join("، ") });
  return lines;
}

/** The title of a publish, level or language row. */
function publishTitle(row: AdminLog): string {
  const [language, level] = (row.entity_id ?? "").split(":");
  const name = t(`common.languages.${language === "de" ? "de" : "fr"}`);
  if (row.entity === "level_release") {
    const open = Boolean((row.after as { released?: unknown } | null)?.released);
    return t(open ? "admin.log.publish.levelOpened" : "admin.log.publish.levelClosed", { level });
  }
  if (row.entity === "language") return t((row.after as { live?: boolean } | null)?.live ? "admin.log.publish.shown" : "admin.log.publish.hidden", { language: name });
  const items = (row.after as PublishAfter | null)?.items ?? {};
  const count = librarySlugs.reduce((sum, slug) => sum + (items[slug]?.length ?? 0), 0);
  return count > 0 ? t("admin.log.publish.title", { count }) : t("admin.log.publish.titleChildren");
}

export async function listLog(kind: LogKind | null, page: number): Promise<LogPage> {
  const where = await whereOf(kind);
  const total = await db.adminLog.count({ where });
  const pages = Math.max(1, Math.ceil(total / LOG_PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const rows = await db.adminLog.findMany({ where, orderBy: { id: "desc" }, skip: (current - 1) * LOG_PAGE_SIZE, take: LOG_PAGE_SIZE });
  const [items, latest, titles, admins] = await Promise.all([
    itemsOf(itemKeys(rows)),
    latestRows(rows),
    orderTitles(rows),
    db.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.admin_id).filter((id): id is number => id !== null))] } }, select: { id: true, phone: true } }),
  ]);
  const phones = new Map(admins.map((admin) => [admin.id, admin.phone]));

  return {
    total,
    page: current,
    pages,
    items: rows.map((row): LogItem => {
      if (isPublishRow(row)) {
        const language = (row.entity_id ?? "").split(":")[0];
        const phone = row.admin_id !== null ? phones.get(row.admin_id) : null;
        return {
          id: row.id,
          ts: row.ts.toISOString(),
          action: row.action,
          actionLabel: t(`admin.log.actions.${row.action}` as MessageKey),
          kindLabel: language === "fr" || language === "de" ? t(`common.languages.${language}`) : language,
          title: shown(isolateLatin(publishTitle(row)), "fa"),
          href: `/admin/publish?${new URLSearchParams({ lang: language })}`,
          language,
          who: phone ? t("admin.log.by", { who: formatMobileFa(phone) }) : t("admin.log.byUnknown"),
          lines: row.entity === "publish" ? publishLines(row, items) : [],
          revert: "no",
        };
      }
      const setting = isSettingRow(row) ? settingLog(row) : null;
      if (setting) {
        const phone = row.admin_id !== null ? phones.get(row.admin_id) : null;
        return {
          id: row.id,
          ts: row.ts.toISOString(),
          action: row.action,
          actionLabel: t(`admin.log.actions.${row.action}` as MessageKey),
          ...setting,
          who: phone ? t("admin.log.by", { who: formatMobileFa(phone) }) : t("admin.log.byUnknown"),
          revert: !revertible(row) ? "no" : latest.has(row.id) ? "ready" : "later",
        };
      }
      const order = isOrderRow(row);
      const list = orderListOf[row.entity];
      const [orderLanguage, orderLevel] = (row.entity_id ?? "").split(":");
      const item = order ? null : items.get(`${row.entity}:${row.entity_id}`);
      const snapshot = row.action === "delete" ? ((row.before ?? {}) as Record<string, unknown>) : item;
      const slug = slugOfEntity[row.entity];
      const deletedSentences = ((row.before as { deleted_sentence_ids?: number[] } | null)?.deleted_sentence_ids ?? []).length;
      const phone = row.admin_id !== null ? phones.get(row.admin_id) : null;
      return {
        id: row.id,
        ts: row.ts.toISOString(),
        action: row.action,
        actionLabel: t(`admin.log.actions.${row.action}` as MessageKey),
        kindLabel: order && list ? t(`admin.order.lists.${list}`) : slug ? t(`admin.log.entities.${row.entity}` as MessageKey) : row.entity,
        title: order
          ? shown(
              orderLevel
                ? t("admin.log.orderTitleLevel", { list: t(`admin.order.lists.${list}`), level: orderLevel })
                : t("admin.log.orderTitle", { list: t(`admin.order.lists.${list}`) }),
              "fa",
            )
          : snapshot
            ? titleOf(row.entity, snapshot)
            : shown(t("admin.log.unknownItem", { id: formatNumber(Number(row.entity_id)) }), "fa"),
        href: order
          ? `/admin/order?${new URLSearchParams({ lang: orderLanguage, list, ...(orderLevel ? { level: orderLevel } : {}) })}`
          : item && isLibrarySlug(slug)
            ? `/admin/content/${slug}/${row.entity_id}`
            : null,
        language: order ? orderLanguage : ((snapshot?.language as string | undefined) ?? null),
        who: phone ? t("admin.log.by", { who: formatMobileFa(phone) }) : t("admin.log.byUnknown"),
        lines:
          row.action === "delete"
            ? [{ key: "deleted", label: "", note: deletedSentences ? t("admin.log.deletedWithSentences", { count: deletedSentences }) : t("admin.log.deleted") }]
            : row.action === "audio"
              ? audioLines(row)
              : order
                ? orderLines(row, titles)
                : changeLines(row),
        revert: !revertible(row) ? "no" : latest.has(row.id) ? "ready" : "later",
      };
    }),
  };
}

import { t } from "@/i18n";
import { arrange, type Anchored } from "@/lib/arrange";
import { db } from "@/server/db";
import { appSetting } from "@/server/settings/read";
import { levelWords, numberLevel } from "./intro-order";
import type { Tx } from "./kinds/types";
import { logChange } from "./library/log";
import type { LibrarySlug, ContentStatusValue } from "./library/slugs";
import type { Voice } from "./library/list";

/**
 * The panel's «ترتیب» (PRD §13.2, §13.6): the order learners meet words (per level, `intro_order`),
 * grammar units (per level, `order_no`), phonics lessons (`order_no`) and texts (per level,
 * `order_override` over `difficulty_score`, PRD §7.5). Each save writes one `admin_log` row with the
 * whole order before and after, so «برگردان» can put it back.
 */
export const orderLists = ["words", "units", "phonics", "texts"] as const;
export type OrderList = (typeof orderLists)[number];
export const isOrderList = (value: unknown): value is OrderList => orderLists.includes(value as OrderList);

/** Which lists are one per level; phonics is one list per language (all of it is A1, PRD §8.1). */
export const perLevel: Record<OrderList, boolean> = {
  words: true,
  units: true,
  phonics: false,
  texts: true,
};

export const orderEntity: Record<OrderList, string> = {
  words: "word",
  units: "grammar_unit",
  phonics: "phonics_lesson",
  texts: "text",
};

export type OrderRow = {
  id: number;
  title: string;
  voice: Voice;
  /** Small facts in Persian: part of speech, unit code, kind of text. */
  meta: string | null;
  sub: string | null;
  subVoice: Voice;
  status: ContentStatusValue;
  suspended: boolean;
  /** For a word that follows another one: that word, to say «خودکار بعد از …». */
  follows: string | null;
  slug: LibrarySlug;
};

export type OrderView = {
  list: OrderList;
  language: string;
  level: string | null;
  rows: OrderRow[];
  /** The order as stored, so a save can tell whether someone else changed it meanwhile. */
  base: number[];
  anchored: Anchored[];
  /** Texts only: arranged by hand, or by difficulty. */
  manual: boolean;
};

/** `admin_log.entity_id` of a list: its language and, for lists per level, the level. */
export const orderKey = (list: OrderList, language: string, level: string | null) => (perLevel[list] ? `${language}:${level}` : language);

export async function loadOrder(list: OrderList, language: string, level: string | null): Promise<OrderView> {
  const view = { list, language, level: perLevel[list] ? level : null };
  switch (list) {
    case "words": {
      const { rows: order, anchored } = await levelWords(db, language, level!);
      const words = await db.word.findMany({
        where: { id: { in: order.map((row) => row.id) } },
        select: {
          id: true,
          lemma: true,
          pos: true,
          gender: true,
          meaning_fa: true,
          status: true,
          suspended: true,
        },
      });
      const byId = new Map(words.map((word) => [word.id, word]));
      const base = order.map((row) => row.id);
      const ids = arrange(base, anchored);
      const lemma = (id: number) => byId.get(id)?.lemma ?? "";
      return {
        ...view,
        base,
        anchored,
        manual: true,
        rows: ids.map((id) => {
          const word = byId.get(id)!;
          const anchors = anchored.find((entry) => entry.id === id)?.after ?? [];
          const last = anchors.reduce<number | null>((found, anchor) => (found === null || ids.indexOf(anchor) > ids.indexOf(found) ? anchor : found), null);
          return {
            id,
            title: word.lemma,
            voice: "target",
            meta: [t(`content.pos.${word.pos}`), word.gender].filter(Boolean).join(" "),
            sub: word.meaning_fa,
            subVoice: "fa",
            status: word.status,
            suspended: word.suspended,
            follows: last === null ? null : lemma(last),
            slug: "words",
          };
        }),
      };
    }
    case "units": {
      const units = await db.grammarUnit.findMany({
        where: { language, level: level!, status: { not: "retired" } },
        orderBy: [{ order_no: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        select: {
          id: true,
          title_fa: true,
          unit_code: true,
          scope_fa: true,
          status: true,
          suspended: true,
        },
      });
      return {
        ...view,
        base: units.map((unit) => unit.id),
        anchored: [],
        manual: true,
        rows: units.map((unit) => ({
          id: unit.id,
          title: unit.title_fa,
          voice: "fa",
          meta: null,
          sub: unit.unit_code,
          subVoice: "target",
          status: unit.status,
          suspended: unit.suspended,
          follows: null,
          slug: "units",
        })),
      };
    }
    case "phonics": {
      const lessons = await db.phonicsLesson.findMany({
        where: { language, status: { not: "retired" } },
        orderBy: [{ order_no: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        select: {
          id: true,
          sound_label: true,
          kind: true,
          graphemes: true,
          status: true,
          suspended: true,
        },
      });
      return {
        ...view,
        base: lessons.map((lesson) => lesson.id),
        anchored: [],
        manual: true,
        rows: lessons.map((lesson) => ({
          id: lesson.id,
          title: lesson.sound_label,
          voice: "fa",
          meta: t(`admin.library.phonicsKind.${lesson.kind}`),
          sub: lesson.graphemes.join("  "),
          subVoice: "target",
          status: lesson.status,
          suspended: lesson.suspended,
          follows: null,
          slug: "phonics",
        })),
      };
    }
    case "texts": {
      const [texts, kinds] = await Promise.all([levelTexts(db, language, level!), appSetting<Record<string, { kind: string; name_fa: string }[]>>("prompt.text_kinds")]);
      const names = new Map(
        Object.values(kinds)
          .flat()
          .map((kind) => [kind.kind, kind.name_fa]),
      );
      return {
        ...view,
        base: texts.map((text) => text.id),
        anchored: [],
        manual: texts.some((text) => text.order_override !== null),
        rows: texts.map((text) => ({
          id: text.id,
          title: text.title,
          voice: "target",
          meta: t("admin.order.textMeta", {
            kind: names.get(text.kind) ?? text.kind,
            band: text.band,
          }),
          sub: [
            text.word_count ? t("admin.order.words", { count: text.word_count }) : null,
            text.difficulty_score !== null
              ? t("admin.order.difficulty", {
                  score: Math.round(text.difficulty_score * 100),
                })
              : t("admin.order.noDifficulty"),
          ]
            .filter(Boolean)
            .join("، "),
          subVoice: "fa",
          status: text.status,
          suspended: text.suspended,
          follows: null,
          slug: "texts",
        })),
      };
    }
  }
}

/**
 * Texts of a level in the order learners get them (PRD §7.5): by the teacher's number when the level
 * is arranged by hand (a text without one, at the end), else by difficulty, easiest first.
 */
async function levelTexts(tx: Tx, language: string, level: string) {
  const texts = await tx.text.findMany({
    where: { language, level, status: { not: "retired" } },
    select: {
      id: true,
      code: true,
      title: true,
      kind: true,
      band: true,
      word_count: true,
      difficulty_score: true,
      order_override: true,
      status: true,
      suspended: true,
    },
  });
  const last = Number.MAX_SAFE_INTEGER;
  return texts.sort(
    (a, b) => (a.order_override ?? last) - (b.order_override ?? last) || (a.difficulty_score ?? last) - (b.difficulty_score ?? last) || a.code.localeCompare(b.code),
  );
}

/** The ids of a list in its stored order, for saving and for «برگردان». */
async function storedOrder(tx: Tx, list: OrderList, language: string, level: string | null) {
  switch (list) {
    case "words":
      return (await levelWords(tx, language, level!)).rows.map((row) => row.id);
    case "units":
      return (
        await tx.grammarUnit.findMany({
          where: { language, level: level!, status: { not: "retired" } },
          orderBy: [{ order_no: { sort: "asc", nulls: "last" } }, { id: "asc" }],
          select: { id: true },
        })
      ).map((row) => row.id);
    case "phonics":
      return (
        await tx.phonicsLesson.findMany({
          where: { language, status: { not: "retired" } },
          orderBy: [{ order_no: { sort: "asc", nulls: "last" } }, { id: "asc" }],
          select: { id: true },
        })
      ).map((row) => row.id);
    case "texts":
      return (await levelTexts(tx, language, level!)).map((row) => row.id);
  }
}

/** The stored state of a list as the log keeps it: the order, and for texts whether it is by hand. */
export async function orderState(tx: Tx, list: OrderList, language: string, level: string | null) {
  const order = await storedOrder(tx, list, language, level);
  if (list !== "texts") return { order };
  const manual =
    (await tx.text.count({
      where: {
        language,
        level: level!,
        status: { not: "retired" },
        order_override: { not: null },
      },
    })) > 0;
  return { order, manual };
}

export type OrderState = Awaited<ReturnType<typeof orderState>>;

/** Writes a state: numbers 1..n in its order (texts by hand), or no numbers for texts by difficulty. */
export async function writeOrder(tx: Tx, list: OrderList, language: string, level: string | null, state: OrderState) {
  const { order } = state;
  switch (list) {
    case "words": {
      const { rows } = await levelWords(tx, language, level!);
      await numberLevel(tx, rows, order);
      return;
    }
    case "units":
      for (const [index, id] of order.entries())
        await tx.grammarUnit.update({
          where: { id },
          data: { order_no: index + 1 },
        });
      return;
    case "phonics":
      for (const [index, id] of order.entries())
        await tx.phonicsLesson.update({
          where: { id },
          data: { order_no: index + 1 },
        });
      return;
    case "texts":
      if ("manual" in state && state.manual === false) {
        await tx.text.updateMany({
          where: { id: { in: order } },
          data: { order_override: null },
        });
        return;
      }
      for (const [index, id] of order.entries())
        await tx.text.update({
          where: { id },
          data: { order_override: index + 1 },
        });
  }
}

const sameList = (a: number[], b: number[]) => a.length === b.length && a.every((id, index) => id === b[index]);
const sameSet = (a: number[], b: number[]) => a.length === b.length && new Set([...a, ...b]).size === a.length;

export type OrderResult = { state: "saved"; changed: boolean } | { state: "stale" } | { state: "invalid" };

/**
 * Saves a new order. `base` is the order the page started from: if the list changed meanwhile (a new
 * import, another teacher) nothing is saved and the page reloads. Texts become arranged by hand;
 * `manual: false` puts a text level back on difficulty order.
 */
export async function saveOrder(
  list: OrderList,
  language: string,
  level: string | null,
  base: number[],
  next: { order: number[]; manual?: boolean },
  adminId: number,
): Promise<OrderResult> {
  return db.$transaction(async (tx) => {
    const before = await orderState(tx, list, language, level);
    if (!sameList(before.order, base)) return { state: "stale" as const };
    if (!sameSet(before.order, next.order)) return { state: "invalid" as const };

    let order = next.order;
    if (list === "words") order = arrange(order, (await levelWords(tx, language, level!)).anchored);
    const after: OrderState = list === "texts" ? { order, manual: next.manual !== false } : { order };
    if (list === "texts" && after.manual === false) {
      // Back to difficulty order: the order is what the scores give, read after the numbers go.
      await writeOrder(tx, list, language, level, after);
      after.order = await storedOrder(tx, list, language, level);
    }
    const changed = !sameList(before.order, after.order) || ("manual" in before && before.manual !== (after as { manual?: boolean }).manual);
    if (!changed) return { state: "saved" as const, changed: false };
    if (!(list === "texts" && (after as { manual?: boolean }).manual === false)) await writeOrder(tx, list, language, level, after);
    await logChange(tx, adminId, {
      action: "order",
      entity: orderEntity[list],
      entityId: orderKey(list, language, level),
      before,
      after,
    });
    return { state: "saved" as const, changed: true };
  });
}

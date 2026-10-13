import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { phonicsSlots, type Slot } from "./slots";
import { viewsOf, type SlotView } from "./view";

/**
 * The lists of the «صدا» page (PRD §13.2): files nobody has heard yet, stale files waiting for a new
 * recording, and places without any file (the phone's voice reads them; a teacher may record them).
 */

export const audioTabs = ["listen", "stale", "none"] as const;
export type AudioTab = (typeof audioTabs)[number];
export const audioTypes = ["words", "sentences", "texts", "phonics"] as const;
export type AudioType = (typeof audioTypes)[number];

export const isAudioTab = (value: unknown): value is AudioTab => audioTabs.includes(value as AudioTab);
export const isAudioType = (value: unknown): value is AudioType => audioTypes.includes(value as AudioType);

const PAGE = 40;

const tables = { words: "word", sentences: "sentence", texts: "text" } as const;
const orders = { words: Prisma.sql`t.intro_order ASC NULLS LAST, t.id ASC`, sentences: Prisma.sql`t.id ASC`, texts: Prisma.sql`t.level ASC, t.code ASC` };

// h is the human file, m the machine one. A stale file never plays; the human one plays first.
const conditions: Record<AudioTab, Prisma.Sql> = {
  listen: Prisma.sql`((h.id IS NOT NULL AND NOT h.stale AND h.listened_at IS NULL) OR ((h.id IS NULL OR h.stale) AND m.id IS NOT NULL AND NOT m.stale AND m.listened_at IS NULL))`,
  stale: Prisma.sql`((h.stale OR m.stale) AND (h.id IS NULL OR h.stale) AND (m.id IS NULL OR m.stale))`,
  none: Prisma.sql`(h.id IS NULL AND m.id IS NULL)`,
};

const from = (type: Exclude<AudioType, "phonics">, language: string, tab: AudioTab) => Prisma.sql`
  FROM ${Prisma.raw(`"${tables[type]}"`)} t
  LEFT JOIN audio_asset h ON h.id = t.human_audio_id
  LEFT JOIN audio_asset m ON m.id = t.audio_id
  WHERE t.language = ${language} AND t.status <> 'retired' AND ${conditions[tab]}`;

type Entry = Record<string, unknown>;
type AssetState = { stale: boolean; heard: boolean };

/** Every slot of the language's phonics lessons that falls in a tab, in lesson order. */
async function phonicsIn(language: string, tab: AudioTab): Promise<Slot[]> {
  const lessons = await db.phonicsLesson.findMany({
    where: { language, status: { not: "retired" } },
    orderBy: [{ order_no: { sort: "asc", nulls: "last" } }, { id: "asc" }],
    select: { id: true, example_words: true, minimal_pairs: true, liaison_sentences: true },
  });
  const slots = lessons.flatMap(phonicsSlots);
  const ids = (slot: Slot, lesson: Entry) => {
    if (slot.kind !== "phonics") return [null, null] as const;
    const list = { word: "example_words", "pair-a": "minimal_pairs", "pair-b": "minimal_pairs", liaison: "liaison_sentences" }[slot.part];
    const prefix = slot.part === "pair-a" ? "a_" : slot.part === "pair-b" ? "b_" : "";
    const entry = ((lesson[list] as Entry[]) ?? [])[slot.index] ?? {};
    return [(entry[`${prefix}human_audio_id`] as number | null) ?? null, (entry[`${prefix}audio_id`] as number | null) ?? null] as const;
  };
  const byId = new Map(lessons.map((lesson) => [lesson.id, lesson as unknown as Entry]));
  const pairs = slots.map((slot) => ({ slot, ids: ids(slot, byId.get(slot.id)!) }));
  const assetIds = pairs.flatMap((pair) => pair.ids).filter((id): id is number => id !== null);
  const assets = new Map<number, AssetState>(
    (await db.audioAsset.findMany({ where: { id: { in: assetIds } }, select: { id: true, stale: true, listened_at: true } })).map((row) => [
      row.id,
      { stale: row.stale, heard: row.listened_at !== null },
    ]),
  );
  return pairs
    .filter(({ ids: [humanId, machineId] }) => {
      const human = humanId !== null ? assets.get(humanId) : undefined;
      const machine = machineId !== null ? assets.get(machineId) : undefined;
      const playing = human && !human.stale ? human : machine && !machine.stale ? machine : null;
      if (tab === "listen") return playing !== null && !playing.heard;
      if (tab === "stale") return !playing && Boolean(human?.stale || machine?.stale);
      return !human && !machine;
    })
    .map((pair) => pair.slot);
}

/** How many places each tab holds, by type. */
export async function audioCounts(language: string): Promise<Record<AudioTab, Record<AudioType, number>>> {
  const result = {} as Record<AudioTab, Record<AudioType, number>>;
  for (const tab of audioTabs) {
    const counts = {} as Record<AudioType, number>;
    for (const type of ["words", "sentences", "texts"] as const) {
      const [row] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count ${from(type, language, tab)}`;
      counts[type] = Number(row.count);
    }
    counts.phonics = (await phonicsIn(language, tab)).length;
    result[tab] = counts;
  }
  return result;
}

export type AudioList = { items: SlotView[]; total: number; page: number; pages: number };

/** One page of a tab's list for one type. */
export async function audioList(language: string, tab: AudioTab, type: AudioType, page = 1): Promise<AudioList> {
  let slots: Slot[];
  let total: number;
  const current = Math.max(1, Math.floor(page));
  if (type === "phonics") {
    const all = await phonicsIn(language, tab);
    total = all.length;
    slots = all.slice((current - 1) * PAGE, current * PAGE);
  } else {
    const [row] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) AS count ${from(type, language, tab)}`;
    total = Number(row.count);
    const ids = await db.$queryRaw<{ id: number }[]>`SELECT t.id ${from(type, language, tab)} ORDER BY ${orders[type]} LIMIT ${PAGE} OFFSET ${(current - 1) * PAGE}`;
    const kind = type === "words" ? "word" : type === "sentences" ? "sentence" : "text";
    slots = ids.map((item) => ({ kind, id: item.id }));
  }
  return {
    items: await viewsOf(slots),
    total,
    page: current,
    pages: Math.max(1, Math.ceil(total / PAGE)),
  };
}

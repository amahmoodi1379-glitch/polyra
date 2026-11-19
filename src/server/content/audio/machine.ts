import { Prisma, type ContentStatus } from "@/generated/prisma/client";
import { spokenLine, voiceFor, type VoiceRole } from "@/lib/audio/voices";
import { spokenWord } from "@/lib/spoken";
import { db } from "@/server/db";
import { levelRank } from "../languages";
import { phonicsSlots, slotKey, type PhonicsPart, type Slot } from "./slots";

/**
 * The machine voice's to-do list (DECISIONS.md, 18 Nov 2026): every word, sentence, text and phonics
 * item that is approved or published gets a file from our own Piper voices (scripts/audio). A slot is
 * made again when what it says (`made_from`) or its voice changed, or its file went stale; never when
 * a teacher took its machine file out and it still says the same (`audio_declined`). A human file is
 * never touched: it keeps playing first. A text's file is its sentences' files joined, made once every
 * sentence has a fresh one.
 */

export const LIVE: ContentStatus[] = ["approved", "published"];

export type AudioType = "words" | "sentences" | "texts" | "phonics";
export type Counts = Record<AudioType, number>;
const typeOf: Record<Slot["kind"], AudioType> = { word: "words", sentence: "sentences", text: "texts", phonics: "phonics" };
const kindRank: Record<Slot["kind"], number> = { word: 0, phonics: 1, sentence: 2, text: 3 };
export const emptyCounts = (): Counts => ({ words: 0, sentences: 0, texts: 0, phonics: 0 });

/** A slot's machine file as the plan sees it. `madeFrom` is null on a file someone uploaded as machine. */
export type MachineFile = { id: number; stale: boolean; madeFrom: string | null; voice: string | null };

export type PlanSlot = {
  slot: Slot;
  language: string;
  level: string | null;
  /** Its place among slots of its kind (a word's lesson order, a phonics item's lesson and position). */
  order: number;
  /** What the voice reads; for a text, unused (its sentences are read). */
  speak: string;
  role: VoiceRole;
  machine: MachineFile | null;
  /** A fresh human file plays for it: its machine file only waits in reserve, so it comes later. */
  humanPlays: boolean;
  /** `made_from` of the machine file a teacher took out, if any. */
  declined: string | null;
  /** A text's sentences, in order. */
  sentenceIds?: number[];
};

type TextSlot = { kind: "text"; id: number };
export type Job =
  | { kind: "say"; slot: Slot; key: string; language: string; voice: string; text: string }
  | { kind: "join"; slot: TextSlot; key: string; language: string; parts: number[]; madeFrom: string };

export type LanguageCounts = { waiting: Counts; made: Counts; declined: Counts };
export type MachinePlan = { jobs: Job[]; languages: Record<string, LanguageCounts> };

/** What a text's joined file is made of: its sentences' machine files, in order. */
export const joinSignature = (parts: number[]) => `join:${parts.join(",")}`;

/**
 * Which machine files to make, most needed first: places nothing plays for before places a teacher
 * recorded, then by level, words before phonics before sentences before texts, then lesson order.
 */
export function planMachineAudio(slots: PlanSlot[]): MachinePlan {
  const languages: Record<string, LanguageCounts> = {};
  const counts = (language: string) => (languages[language] ??= { waiting: emptyCounts(), made: emptyCounts(), declined: emptyCounts() });
  const wanted: { job: Job; slot: PlanSlot }[] = [];
  /** Sentence id → its fresh machine file, or whether it is about to get one or a teacher took it out. */
  const sentenceFile = new Map<number, number | "waiting" | "declined">();

  for (const item of slots) {
    if (item.slot.kind === "text") continue;
    const voice = voiceFor(item.language, item.role);
    const text = spokenLine(item.speak);
    if (!voice || !text) continue;
    const type = typeOf[item.slot.kind];
    const machine = item.machine;
    // A file made by our voices is fresh while it says the same in the same voice; an uploaded one while it is not stale.
    const fresh = machine !== null && !machine.stale && (machine.madeFrom === null || (machine.madeFrom === text && machine.voice === voice.id));
    let state: number | "waiting" | "declined";
    if (fresh) {
      counts(item.language).made[type]++;
      state = machine.id;
    } else if (item.declined === text) {
      counts(item.language).declined[type]++;
      state = "declined";
    } else {
      counts(item.language).waiting[type]++;
      wanted.push({ job: { kind: "say", slot: item.slot, key: slotKey(item.slot), language: item.language, voice: voice.id, text }, slot: item });
      state = "waiting";
    }
    if (item.slot.kind === "sentence") sentenceFile.set(item.slot.id, state);
  }

  for (const item of slots) {
    if (item.slot.kind !== "text") continue;
    const ids = item.sentenceIds ?? [];
    const parts = ids.map((id) => sentenceFile.get(id));
    // No sentences, or one that is not live, has nothing to say, or whose file a teacher took out: no joined file.
    if (parts.length === 0 || parts.some((part) => part === undefined || part === "declined")) continue;
    const ready = parts.every((part): part is number => typeof part === "number");
    const signature = ready ? joinSignature(parts) : null;
    const machine = item.machine;
    if (machine && !machine.stale && (machine.madeFrom === null || machine.madeFrom === signature)) {
      counts(item.language).made.texts++;
      continue;
    }
    if (signature !== null && item.declined === signature) {
      counts(item.language).declined.texts++;
      continue;
    }
    counts(item.language).waiting.texts++;
    if (signature !== null) {
      const slot: TextSlot = { kind: "text", id: item.slot.id };
      wanted.push({ job: { kind: "join", slot, key: slotKey(slot), language: item.language, parts: parts as number[], madeFrom: signature }, slot: item });
    }
  }

  // The alphabet lessons have no level; they are for beginners, so they count as A1.
  const levelOf = (item: PlanSlot) => (item.slot.kind === "phonics" ? "A1" : item.level);
  const rank = (item: PlanSlot) => [item.humanPlays ? 1 : 0, levelRank(levelOf(item)), kindRank[item.slot.kind], item.order, item.slot.id];
  wanted.sort((a, b) => {
    const left = rank(a.slot);
    const right = rank(b.slot);
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return left[i] - right[i];
    return a.job.key < b.job.key ? -1 : a.job.key > b.job.key ? 1 : 0;
  });
  return { jobs: wanted.map((item) => item.job), languages };
}

/** Which voice reads each sentence: the second speaker of a text with speakers, the other side of a dialogue. */
export function sentenceRoles(
  texts: { id: number; sentence_ids: number[]; speakers: unknown }[],
  dialogues: { id: number; turns: unknown }[],
): Map<number, VoiceRole> {
  const roles = new Map<number, VoiceRole>();
  for (const text of [...texts].sort((a, b) => a.id - b.id)) {
    if (!Array.isArray(text.speakers)) continue;
    const labels: string[] = [];
    text.sentence_ids.forEach((sentenceId, index) => {
      const label = String((text.speakers as unknown[])[index] ?? "").trim();
      if (!label || roles.has(sentenceId)) return;
      if (!labels.includes(label)) labels.push(label);
      roles.set(sentenceId, (labels.indexOf(label) % 2) as VoiceRole);
    });
  }
  for (const dialogue of [...dialogues].sort((a, b) => a.id - b.id)) {
    for (const turn of turnsOf(dialogue.turns)) {
      // The other person says the line; the learner's answers are in the first voice.
      if (typeof turn.sentence_id === "number" && !roles.has(turn.sentence_id)) roles.set(turn.sentence_id, 1);
      for (const choice of turn.choices ?? []) if (typeof choice.sentence_id === "number" && !roles.has(choice.sentence_id)) roles.set(choice.sentence_id, 0);
    }
  }
  return roles;
}

type Turn = { sentence_id?: unknown; choices?: { sentence_id?: unknown }[] };
const turnsOf = (turns: unknown): Turn[] => (Array.isArray(turns) ? (turns as Turn[]) : []);
const dialogueSentenceIds = (turns: unknown) =>
  turnsOf(turns).flatMap((turn) => [turn.sentence_id, ...(turn.choices ?? []).map((choice) => choice.sentence_id)]).filter((id): id is number => typeof id === "number");

type FileColumns = { m_id: number | null; m_stale: boolean | null; m_made_from: string | null; m_voice: string | null; human_plays: boolean };
const fileOf = (row: FileColumns): MachineFile | null =>
  row.m_id === null ? null : { id: row.m_id, stale: Boolean(row.m_stale), madeFrom: row.m_made_from, voice: row.m_voice };
const files = Prisma.sql`
  LEFT JOIN audio_asset m ON m.id = t.audio_id
  LEFT JOIN audio_asset h ON h.id = t.human_audio_id`;
const fileColumns = Prisma.sql`m.id AS m_id, m.stale AS m_stale, m.made_from AS m_made_from, m.voice AS m_voice, (h.id IS NOT NULL AND NOT h.stale) AS human_plays`;
const live = Prisma.sql`t.status IN ('approved', 'published')`;

/** Every slot the machine voice may fill, read in a few queries (the generator calls this every minute or two). */
export async function loadPlanSlots(): Promise<PlanSlot[]> {
  const declined = new Map((await db.audioDeclined.findMany({ select: { slot: true, made_from: true } })).map((row) => [row.slot, row.made_from]));
  const words = await db.$queryRaw<
    (FileColumns & { id: number; language: string; level: string; intro_order: number | null; lemma: string; pos: string; gender: string | null; number: string | null })[]
  >`SELECT t.id, t.language, t.level, t.intro_order, t.lemma, t.pos::text AS pos, t.gender::text AS gender, t."number"::text AS "number", ${fileColumns}
    FROM word t ${files} WHERE ${live}`;
  const texts = await db.$queryRaw<(FileColumns & { id: number; language: string; level: string; sentence_ids: number[]; speakers: unknown })[]>`
    SELECT t.id, t.language, t.level, t.sentence_ids, t.speakers, ${fileColumns}
    FROM "text" t ${files} WHERE ${live} AND t.media_type = 'audio'`;
  const dialogues = await db.dialogue.findMany({ where: { status: { in: LIVE } }, select: { id: true, turns: true } });
  const needed = [...new Set([...texts.flatMap((row) => row.sentence_ids), ...dialogues.flatMap((row) => dialogueSentenceIds(row.turns))])];
  const sentences = await db.$queryRaw<(FileColumns & { id: number; language: string; level: string | null; text: string; tts_text: string | null })[]>`
    SELECT t.id, t.language, t.level, t.text, t.tts_text, ${fileColumns}
    FROM sentence t ${files} WHERE ${live} OR t.id = ANY(${needed}::int[])`;
  const lessons = await db.phonicsLesson.findMany({ where: { status: { in: LIVE } } });

  const roles = sentenceRoles(texts, dialogues);
  const slots: PlanSlot[] = [];
  const declinedOf = (slot: Slot) => declined.get(slotKey(slot)) ?? null;
  for (const row of words) {
    const slot: Slot = { kind: "word", id: row.id };
    slots.push({ slot, language: row.language, level: row.level, order: row.intro_order ?? Number.MAX_SAFE_INTEGER, speak: spokenWord(row), role: 0, machine: fileOf(row), humanPlays: row.human_plays, declined: declinedOf(slot) });
  }
  for (const row of sentences) {
    const slot: Slot = { kind: "sentence", id: row.id };
    slots.push({
      slot,
      language: row.language,
      level: row.level,
      order: row.id,
      speak: row.tts_text?.trim() || row.text,
      role: roles.get(row.id) ?? 0,
      machine: fileOf(row),
      humanPlays: row.human_plays,
      declined: declinedOf(slot),
    });
  }
  for (const row of texts) {
    const slot: Slot = { kind: "text", id: row.id };
    slots.push({ slot, language: row.language, level: row.level, order: row.id, speak: "", role: 0, machine: fileOf(row), humanPlays: row.human_plays, declined: declinedOf(slot), sentenceIds: row.sentence_ids });
  }

  // Phonics items keep their file ids inside the lesson's lists.
  const phonics = lessons.flatMap((lesson) =>
    phonicsSlots(lesson).map((slot, index) => {
      const entry = phonicsEntry(lesson as unknown as Record<string, unknown>, slot as Extract<Slot, { kind: "phonics" }>);
      return { lesson, slot, index, ...entry };
    }),
  );
  const assetIds = phonics.flatMap((item) => [item.machineId, item.humanId]).filter((id): id is number => id !== null);
  const assets = new Map(
    (await db.audioAsset.findMany({ where: { id: { in: assetIds } }, select: { id: true, stale: true, made_from: true, voice: true } })).map((row) => [row.id, row]),
  );
  for (const item of phonics) {
    const machine = item.machineId !== null ? assets.get(item.machineId) : undefined;
    const human = item.humanId !== null ? assets.get(item.humanId) : undefined;
    slots.push({
      slot: item.slot,
      language: item.lesson.language,
      level: null,
      order: (item.lesson.order_no ?? 9999) * 1000 + item.index,
      speak: item.spoken,
      role: 0,
      machine: machine ? { id: machine.id, stale: machine.stale, madeFrom: machine.made_from, voice: machine.voice } : null,
      humanPlays: Boolean(human && !human.stale),
      declined: declinedOf(item.slot),
    });
  }
  return slots;
}

const listOf: Record<PhonicsPart, string> = { word: "example_words", "pair-a": "minimal_pairs", "pair-b": "minimal_pairs", liaison: "liaison_sentences" };
const prefixOf: Record<PhonicsPart, string> = { word: "", "pair-a": "a_", "pair-b": "b_", liaison: "" };

function phonicsEntry(lesson: Record<string, unknown>, slot: Extract<Slot, { kind: "phonics" }>) {
  const list = lesson[listOf[slot.part]];
  const entry = (Array.isArray(list) ? (list[slot.index] as Record<string, unknown>) : null) ?? {};
  const prefix = prefixOf[slot.part];
  const spoken = slot.part === "pair-a" ? entry.a : slot.part === "pair-b" ? entry.b : entry.text;
  const id = (value: unknown) => (typeof value === "number" ? value : null);
  return { spoken: String(spoken ?? ""), machineId: id(entry[`${prefix}audio_id`]), humanId: id(entry[`${prefix}human_audio_id`]) };
}

// ───────────────────────────── the generator's row ─────────────────────────────

/** What the generator last counted and did, for the «صدا» page. */
export type GeneratorState = {
  phase: "working" | "idle" | "unavailable";
  checkedAt: string;
  lastMadeAt: string | null;
  made: number;
  failed: number;
  languages: Record<string, LanguageCounts>;
  /** Voice models or the Piper program that were not found. */
  missing?: string[];
};

const ROW = 1;

/**
 * Takes or renews the right to work for `ms` milliseconds. Only one process works at a time (a new
 * container may start before the old one stops); a lease that ran out is free for anyone.
 */
export async function takeLease(owner: string, ms: number): Promise<boolean> {
  const until = new Date(Date.now() + ms);
  const changed = await db.$executeRaw`
    INSERT INTO audio_generator (id, owner, lease_until, state, updated_at) VALUES (${ROW}, ${owner}, ${until}, '{}', now())
    ON CONFLICT (id) DO UPDATE SET owner = EXCLUDED.owner, lease_until = EXCLUDED.lease_until
    WHERE audio_generator.owner = EXCLUDED.owner OR audio_generator.lease_until IS NULL OR audio_generator.lease_until < now()`;
  return changed > 0;
}

export async function releaseLease(owner: string) {
  await db.audioGenerator.updateMany({ where: { id: ROW, owner }, data: { lease_until: null } });
}

/** Writes what the generator counted, if it still holds the work. */
export async function saveGeneratorState(owner: string, state: GeneratorState) {
  await db.audioGenerator.updateMany({ where: { id: ROW, owner }, data: { state: state as unknown as Prisma.InputJsonValue, updated_at: new Date() } });
}

/** A generator that has not written for this long is not running. */
export const GENERATOR_SILENT_MS = 10 * 60_000;

export type MachineProgress = {
  /** working: making files; idle: nothing left; unavailable: Piper or a voice is missing; off: not running. */
  phase: GeneratorState["phase"] | "off";
  waiting: Counts;
  made: Counts;
  declined: Counts;
  checkedAt: Date | null;
  lastMadeAt: Date | null;
  failed: number;
};

/** The «صدا» page's line about the machine voice of one language. */
export async function machineProgress(language: string, now = new Date()): Promise<MachineProgress> {
  const row = await db.audioGenerator.findUnique({ where: { id: ROW } });
  const state = (row?.state ?? {}) as Partial<GeneratorState>;
  const counts = state.languages?.[language];
  const fresh = row !== null && now.getTime() - row.updated_at.getTime() < GENERATOR_SILENT_MS && Boolean(state.phase);
  return {
    phase: fresh ? state.phase! : "off",
    waiting: counts?.waiting ?? emptyCounts(),
    made: counts?.made ?? emptyCounts(),
    declined: counts?.declined ?? emptyCounts(),
    checkedAt: state.checkedAt ? new Date(state.checkedAt) : null,
    lastMadeAt: state.lastMadeAt ? new Date(state.lastMadeAt) : null,
    failed: state.failed ?? 0,
  };
}

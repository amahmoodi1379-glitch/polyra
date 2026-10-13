import { spokenWord } from "@/lib/spoken";
import { db } from "@/server/db";
import { parseSlot, slotKey, type PhonicsPart, type Slot } from "./slots";

/**
 * Bulk upload (PRD §13.8 «آپلود دسته‌ای»): each file name is matched to the place it is for. A name
 * can be what the recording says («une voiture.mp3», «Bonjour madame.wav»), a text's code
 * («fr-a1-t001.m4a») or a place's key («word-274.mp3», «phonics-3-pair-a-1.mp3»). When the name
 * fits one place exactly it is taken; otherwise the nearest places are offered to choose from.
 */

export type MatchTarget = { key: string; kind: Slot["kind"]; id: number; spoken: string; part: PhonicsPart | null; index: number | null };
export type FileMatch = { name: string; match: MatchTarget | null; candidates: MatchTarget[] };

/** Lower case, no accents, no punctuation, single spaces: «Bonjour, madame !» → «bonjour madame». */
export function normalizeName(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/['’`]/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const stem = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, "");

/** A place's key written in a file name, with - or _ for the colons. */
function keyIn(name: string): Slot | null {
  const text = stem(name)
    .trim()
    .toLowerCase()
    .replace(/[-_ ]+/g, ":");
  const pair = /^phonics:(\d+):pair:(a|b):(\d+)$/.exec(text);
  return parseSlot(pair ? `phonics:${pair[1]}:pair-${pair[2]}:${pair[3]}` : text);
}

/** Bigrams of a normalized text, for a likeness score that forgives a missing letter or word. */
function bigrams(text: string) {
  const padded = ` ${text} `;
  const out = new Map<string, number>();
  for (let i = 0; i < padded.length - 1; i++) {
    const gram = padded.slice(i, i + 2);
    out.set(gram, (out.get(gram) ?? 0) + 1);
  }
  return out;
}

function likeness(a: Map<string, number>, b: Map<string, number>, sizeA: number, sizeB: number) {
  let shared = 0;
  for (const [gram, count] of a) shared += Math.min(count, b.get(gram) ?? 0);
  return (2 * shared) / (sizeA + sizeB);
}

/** Below this likeness a place is not offered. */
const NEAR = 0.6;
const OFFERED = 4;

type Indexed = MatchTarget & { forms: string[] };

async function placesOf(language: string): Promise<Indexed[]> {
  const live = { not: "retired" as const };
  const [words, sentences, texts, lessons] = await Promise.all([
    db.word.findMany({ where: { language, status: live }, select: { id: true, language: true, lemma: true, pos: true, gender: true, number: true } }),
    db.sentence.findMany({ where: { language, status: live }, select: { id: true, text: true, tts_text: true } }),
    db.text.findMany({ where: { language, status: live }, select: { id: true, code: true, title: true } }),
    db.phonicsLesson.findMany({ where: { language, status: live }, select: { id: true, example_words: true, minimal_pairs: true, liaison_sentences: true } }),
  ]);
  const place = (slot: Slot, spoken: string, forms: string[]): Indexed => ({
    key: slotKey(slot),
    kind: slot.kind,
    id: slot.id,
    spoken,
    part: slot.kind === "phonics" ? slot.part : null,
    index: slot.kind === "phonics" ? slot.index : null,
    forms: [...new Set(forms.map(normalizeName).filter(Boolean))],
  });
  const list = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);
  return [
    ...words.map((word) => place({ kind: "word", id: word.id }, spokenWord(word), [word.lemma, spokenWord(word)])),
    ...sentences.map((sentence) => place({ kind: "sentence", id: sentence.id }, sentence.text, [sentence.text, sentence.tts_text ?? ""])),
    ...texts.map((text) => place({ kind: "text", id: text.id }, text.title, [text.code, text.title])),
    ...lessons.flatMap((lesson) => [
      ...list(lesson.example_words).map((entry, index) => place({ kind: "phonics", id: lesson.id, part: "word", index }, String(entry.text ?? ""), [String(entry.text ?? "")])),
      ...list(lesson.minimal_pairs).flatMap((entry, index) =>
        (["a", "b"] as const).map((side) =>
          place({ kind: "phonics", id: lesson.id, part: side === "a" ? "pair-a" : "pair-b", index }, String(entry[side] ?? ""), [String(entry[side] ?? "")]),
        ),
      ),
      ...list(lesson.liaison_sentences).map((entry, index) =>
        place({ kind: "phonics", id: lesson.id, part: "liaison", index }, String(entry.text ?? ""), [String(entry.text ?? "")]),
      ),
    ]),
  ];
}

const bare = ({ key, kind, id, spoken, part, index }: Indexed): MatchTarget => ({ key, kind, id, spoken, part, index });

export async function matchFiles(language: string, names: string[]): Promise<FileMatch[]> {
  const places = await placesOf(language);
  const byKey = new Map(places.map((place) => [place.key, place]));
  const grams = places.map((place) => place.forms.map((form) => ({ grams: bigrams(form), size: form.length + 1 })));

  return names.map((name) => {
    const key = keyIn(name);
    const keyed = key ? byKey.get(slotKey(key)) : undefined;
    if (keyed) return { name, match: bare(keyed), candidates: [] };

    const wanted = normalizeName(stem(name));
    if (!wanted) return { name, match: null, candidates: [] };
    const exact = places.filter((place) => place.forms.includes(wanted));
    if (exact.length === 1) return { name, match: bare(exact[0]), candidates: [] };
    if (exact.length > 1) return { name, match: null, candidates: exact.slice(0, OFFERED).map(bare) };

    const own = bigrams(wanted);
    const scored = places
      .map((place, index) => ({ place, score: Math.max(...grams[index].map((form) => likeness(own, form.grams, wanted.length + 1, form.size))) }))
      .filter((item) => item.score >= NEAR)
      .sort((a, b) => b.score - a.score)
      .slice(0, OFFERED);
    return { name, match: null, candidates: scored.map((item) => bare(item.place)) };
  });
}

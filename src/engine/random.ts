/**
 * Seeded random numbers (PRD §9: "مولد تصادفی با بذر مشخص"). The same seed, for example a
 * session id and an item id, always gives the same sequence, so tests and the client/server pair
 * reach the same choices.
 */
export type Rng = () => number;

function hash(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** mulberry32 seeded from a string. */
export function seeded(...parts: (string | number)[]): Rng {
  let a = hash(parts.join("|"));
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pickOne<T>(rng: Rng, list: readonly T[]): T {
  if (list.length === 0) throw new Error("pickOne from an empty list");
  return list[Math.floor(rng() * list.length)];
}

export function shuffle<T>(rng: Rng, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

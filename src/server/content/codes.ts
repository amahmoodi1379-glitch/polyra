/** Word codes are unique per language (PRD §4); these pick the first free one. */

/** For a new word: the lemma, else lemma-pos, else lemma-pos-2 ... */
export function freeCode(lemma: string, pos: string, taken: Set<string>) {
  const candidates = [lemma, `${lemma}-${pos}`];
  for (let n = 2; n < 50; n++) candidates.push(`${lemma}-${pos}-${n}`);
  const code = candidates.find((candidate) => !taken.has(candidate))!;
  taken.add(code);
  return code;
}

/** For a new sense of a word: lemma-2, lemma-3 ... (PRD §13.9, «glace-2»). */
export function senseCode(lemma: string, taken: Set<string>) {
  let n = 2;
  while (taken.has(`${lemma}-${n}`)) n++;
  const code = `${lemma}-${n}`;
  taken.add(code);
  return code;
}

/** The other way round, for a code a chatbot gave: "aller-verb-2" → aller and verb; "peut-être" stays whole. */
export function readCode(code: string, posValues: readonly string[]) {
  const match = /^(.+?)-([a-z]+)(?:-\d+)?$/.exec(code);
  if (match && posValues.includes(match[2])) return { lemma: match[1], pos: match[2] };
  return { lemma: code.replace(/-\d+$/, ""), pos: null };
}

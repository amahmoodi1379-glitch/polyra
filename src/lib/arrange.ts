/**
 * Moving one row of an ordered list (the panel's «ترتیب», PRD §13.2). Pure, so the page and the
 * server arrange a list the same way.
 */
export function moveTo<T>(list: T[], item: T, position: number): T[] {
  const rest = list.filter((entry) => entry !== item);
  const at = Math.min(Math.max(Math.round(position), 1), rest.length + 1) - 1;
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

/** A word whose place follows other words of the same list: a phrase its parts, a new sense its base. */
export type Anchored = { id: number; after: number[] };

/**
 * The introduction order with its automatic places (PRD §5.8): a phrase goes right after the last of
 * its parts and a new sense right after its base word, when those are in the same list. Every other
 * word keeps the place the teacher gave it; automatic words that follow the same word keep their
 * order among themselves.
 */
export function arrange(order: number[], anchored: Anchored[]): number[] {
  const inList = new Set(order);
  const anchors = new Map<number, number[]>();
  for (const entry of anchored) {
    const after = entry.after.filter((id) => id !== entry.id && inList.has(id));
    if (inList.has(entry.id) && after.length > 0) anchors.set(entry.id, after);
  }
  if (anchors.size === 0) return [...order];

  const list = order.filter((id) => !anchors.has(id));
  const placedAfter = new Map<number, number>();
  let waiting = order.filter((id) => anchors.has(id));
  while (waiting.length > 0) {
    const left = new Set(waiting);
    const ready = waiting.filter((id) => anchors.get(id)!.every((anchor) => !left.has(anchor)));
    if (ready.length === 0) break;
    for (const id of ready) {
      const anchor = anchors.get(id)!.reduce((last, candidate) => (list.indexOf(candidate) > list.indexOf(last) ? candidate : last));
      let at = list.indexOf(anchor) + 1;
      while (at < list.length && placedAfter.get(list[at]) === anchor) at++;
      list.splice(at, 0, id);
      placedAfter.set(id, anchor);
    }
    waiting = waiting.filter((id) => !ready.includes(id));
  }
  // Words that wait on each other in a circle keep the place they had.
  for (const id of waiting) list.splice(Math.min(order.indexOf(id), list.length), 0, id);
  return list;
}

/** The ids of the automatic words of a list: they are not dragged, they follow. */
export function automatic(order: number[], anchored: Anchored[]): Set<number> {
  const inList = new Set(order);
  return new Set(anchored.filter((entry) => inList.has(entry.id) && entry.after.some((id) => id !== entry.id && inList.has(id))).map((entry) => entry.id));
}

/**
 * The rows a reorder really moved: the fewest rows whose moving turns `before` into `after` (all rows
 * not on the longest run kept in order). The others only shifted to make room.
 */
export function movedRows(before: number[], after: number[]): number[] {
  const place = new Map(before.map((id, index) => [id, index]));
  const sequence = after.filter((id) => place.has(id));
  // Longest increasing run of old places, by patience sorting.
  const tails: number[] = [];
  const tailAt: number[] = [];
  const previous: number[] = new Array(sequence.length).fill(-1);
  sequence.forEach((id, index) => {
    const value = place.get(id)!;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tails[middle] < value) low = middle + 1;
      else high = middle;
    }
    tails[low] = value;
    tailAt[low] = index;
    previous[index] = low > 0 ? tailAt[low - 1] : -1;
  });
  const kept = new Set<number>();
  for (let index = tails.length ? tailAt[tails.length - 1] : -1; index >= 0; index = previous[index]) kept.add(sequence[index]);
  return sequence.filter((id) => !kept.has(id));
}

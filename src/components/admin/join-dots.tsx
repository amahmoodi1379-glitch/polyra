import type { ReactNode } from "react";

/** Pieces of a line apart by a small dot; a "·" character would read as a Persian zero. */
export function joinDots(parts: ReactNode[]) {
  return parts.map((part, index) => (
    <span key={index}>
      {index > 0 ? <span aria-hidden className="bg-line-2 mx-2 inline-block size-1 rounded-full align-middle" /> : null}
      {part}
    </span>
  ));
}

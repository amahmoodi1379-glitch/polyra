"use client";

import type { ReactNode } from "react";
import { Direction } from "radix-ui";

/** Menus, dialogs and selects follow the interface direction (Persian: right to left). */
export function DirectionProvider({ dir, children }: { dir: "rtl" | "ltr"; children: ReactNode }) {
  return <Direction.Provider dir={dir}>{children}</Direction.Provider>;
}

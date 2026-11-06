"use client";

import { useState, type ComponentProps } from "react";
import NextLink from "next/link";

/**
 * The panel's link. Next.js fetches every link on screen ahead of time; in the panel that is 30 to 40
 * requests after each page, which on a slow or far connection queue in front of the teacher's own
 * click and make every button wait. Here a link is fetched only when the pointer rests on it or a
 * finger touches it, which is still before the click. A link that sets `prefetch` keeps its own choice.
 */
export default function Link({ prefetch, onPointerEnter, onTouchStart, onFocus, ...props }: ComponentProps<typeof NextLink>) {
  const [wanted, setWanted] = useState(false);
  const want = () => setWanted(true);
  return (
    <NextLink
      {...props}
      prefetch={prefetch !== undefined ? prefetch : wanted ? null : false}
      onPointerEnter={(event) => {
        want();
        onPointerEnter?.(event);
      }}
      onTouchStart={(event) => {
        want();
        onTouchStart?.(event);
      }}
      onFocus={(event) => {
        want();
        onFocus?.(event);
      }}
    />
  );
}

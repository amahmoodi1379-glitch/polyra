"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * The guide's contents on wide screens: stays in view while reading and marks the part being read,
 * the last one whose heading has passed the upper third of the window. Phones get the same list as a
 * row of chips above the guide.
 */
export function GuideToc({ label, items }: { label: string; items: { id: string; name: string }[] }) {
  const [current, setCurrent] = useState(items[0]?.id);
  const clicked = useRef(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      // A jump from this list scrolls the page too; keep the part that was clicked.
      if (Date.now() - clicked.current < 600) return;
      const line = window.innerHeight / 3;
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let active = items[0]?.id;
      for (const item of items) {
        const top = document.getElementById(item.id)?.getBoundingClientRect().top;
        if (top !== undefined && (top <= line || atBottom)) active = item.id;
      }
      setCurrent(active);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [items]);

  return (
    <nav aria-label={label} className="sticky top-10 hidden max-h-[calc(100dvh-5rem)] flex-col gap-2 overflow-y-auto lg:flex">
      <p className="text-ink-3 px-3 text-[12.5px] font-bold">{label}</p>
      <ul className="flex flex-col gap-0.5">
        {items.map((item) => {
          const active = item.id === current;
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={active ? "location" : undefined}
                onClick={() => {
                  clicked.current = Date.now();
                  setCurrent(item.id);
                }}
                className={cn(
                  "flex min-h-8 items-center rounded-[10px] px-3 py-1 text-[13.5px] leading-6 font-bold transition-[background-color,color] duration-150",
                  active ? "bg-tint text-brand-text" : "text-ink-2 hover:text-ink",
                )}
              >
                {item.name}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

"use client";

import { Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/**
 * A thin bar at the top of the panel while a page or a change is on its way, so a click never looks
 * ignored. It starts on any click on a panel link (sidebar, tabs, filters, lists) and on `navStart()`
 * from code that waits on the server; it ends when the address changes or on `navDone()`.
 */

let running = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function navStart() {
  running += 1;
  emit();
}

export function navDone() {
  running = Math.max(0, running - 1);
  emit();
}

function navReset() {
  if (running === 0) return;
  running = 0;
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A same-tab click on a link to another panel address. */
function leadsElsewhere(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  const link = (event.target as Element | null)?.closest?.("a[href]");
  if (!(link instanceof HTMLAnchorElement)) return false;
  if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return false;
  const url = new URL(link.href, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith("/admin")) return false;
  return url.pathname !== location.pathname || url.search !== location.search;
}

function AddressWatch() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => navReset(), [pathname, search]);
  return null;
}

export function NavProgress() {
  const active = useSyncExternalStore(subscribe, () => running > 0, () => false);
  // Shown only after a short wait: a page that is already in the browser opens with no flash.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (leadsElsewhere(event)) navStart();
    };
    // Bubble phase, so a link whose own handler cancels the click (a menu, a dialog) is left alone.
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!active) {
      const hide = setTimeout(() => setVisible(false), 0);
      return () => clearTimeout(hide);
    }
    const show = setTimeout(() => setVisible(true), 90);
    // Never stuck: a navigation that went nowhere (an error, a cancelled change) clears itself.
    const giveUp = setTimeout(navReset, 20_000);
    return () => {
      clearTimeout(show);
      clearTimeout(giveUp);
    };
  }, [active]);

  return (
    <>
      <Suspense fallback={null}>
        <AddressWatch />
      </Suspense>
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px] overflow-hidden" data-nav-progress={visible ? "on" : "off"}>
        <div className="nav-progress-bar bg-brand h-full" />
      </div>
    </>
  );
}

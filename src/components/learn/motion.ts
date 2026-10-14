"use client";

import { useSyncExternalStore } from "react";

/**
 * The small responses of the learner app (DESIGN.md, «Motion»): a jelly squish on press, a shake on a
 * wrong answer, a pop for marks, and the spring of a rising sheet. All of them are skipped under
 * reduced motion; the state they decorate is already visible without them.
 */

export const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const run = (el: Element | null | undefined, frames: Keyframe[], options: KeyframeAnimationOptions) => {
  if (!el || reducedMotion() || typeof (el as HTMLElement).animate !== "function") return null;
  return (el as HTMLElement).animate(frames, options);
};

/** Wide and short, then tall and narrow, then settled: the press of anything jelly-like (520ms). */
export const squish = (el: Element | null | undefined) =>
  run(el, [{ transform: "scale(1)" }, { transform: "scale(1.05,.92)" }, { transform: "scale(.97,1.04)" }, { transform: "scale(1.01,.99)" }, { transform: "scale(1)" }], {
    duration: 520,
    easing: "ease-out",
  });

export const shake = (el: Element | null | undefined) =>
  run(
    el,
    [
      { transform: "translateX(0)" },
      { transform: "translateX(-8px) scale(1.02,.97)" },
      { transform: "translateX(6px)" },
      { transform: "translateX(-3px)" },
      { transform: "translateX(0)" },
    ],
    { duration: 380, easing: "ease-out" },
  );

export const pop = (el: Element | null | undefined) =>
  run(
    el,
    [
      { transform: "scale(.6,1.3)", opacity: 0 },
      { transform: "scale(1.15,.88)", opacity: 1, offset: 0.45 },
      { transform: "scale(.96,1.04)", offset: 0.72 },
      { transform: "none", opacity: 1 },
    ],
    { duration: 620, easing: "ease-out" },
  );

/** A sheet rising from the bottom edge with a small overshoot (0.45s, bounce 0.22 in the prototype). */
export const springIn = (el: Element | null | undefined) =>
  run(el, [{ transform: "translateY(100%)" }, { transform: "translateY(-2.5%)", offset: 0.7 }, { transform: "none" }], {
    duration: 560,
    easing: "cubic-bezier(.16,1,.3,1)",
  });

/** Content of a new card settling in. */
export const enter = (el: Element | null | undefined, delay = 0) =>
  run(el, [{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 420, delay, easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" });

/** The station drop at session end: falls in, squashes and settles (900ms). */
export const dropIn = (el: Element | null | undefined) =>
  run(
    el,
    [
      { transform: "translateY(-70px) scale(.7,1.2)", opacity: 0 },
      { transform: "translateY(0) scale(1.18,.8)", opacity: 1, offset: 0.42 },
      { transform: "scale(.92,1.1)", offset: 0.6 },
      { transform: "scale(1.05,.96)", offset: 0.78 },
      { transform: "none", opacity: 1 },
    ],
    { duration: 900, delay: 280, easing: "cubic-bezier(.3,0,.3,1)", fill: "backwards" },
  );

const motionQuery = "(prefers-reduced-motion: reduce)";
const subscribeMotion = (listener: () => void) => {
  const query = window.matchMedia(motionQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

/** Whether the phone asks for reduced motion, kept up to date. */
export function useReducedMotion() {
  return useSyncExternalStore(subscribeMotion, reducedMotion, () => false);
}

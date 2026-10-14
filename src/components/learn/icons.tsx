import type { SVGProps } from "react";
import { cn } from "@/lib/utils";

/**
 * The learner app's icons (DESIGN.md, «Shapes»): four duotone skill drawings on a 24-unit grid (a blush
 * body, a fine raspberry outline and one solid raspberry part) and 1.6px round line icons. The sprite is
 * rendered once by the learner layout; `Icon` points at a symbol in it.
 */

export type IconName =
  | "i-vocab"
  | "i-gram"
  | "i-listen"
  | "i-read"
  | "l-chain"
  | "l-snow"
  | "l-gear"
  | "l-chev"
  | "l-dots"
  | "l-x"
  | "l-mute"
  | "l-spk"
  | "l-spk1"
  | "l-tempo"
  | "l-mic"
  | "l-note"
  | "l-stack"
  | "l-type"
  | "l-back"
  | "l-fwd"
  | "l-flag"
  | "l-cal"
  | "l-check"
  | "l-search"
  | "l-book"
  | "l-offline"
  | "l-lock"
  | "l-logout"
  | "l-reset"
  | "l-panel"
  | "l-info"
  | "l-erase"
  | "l-shift"
  | "l-table"
  | "l-swap"
  | "l-stop";

export function Icon({ name, className, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  const duotone = name.startsWith("i-");
  return (
    <svg className={cn(duotone ? "ico" : "i", className)} aria-hidden="true" focusable="false" {...rest}>
      <use href={`#${name}`} />
    </svg>
  );
}

export function IconSprite() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
      <defs>
        <symbol id="i-vocab" viewBox="0 0 24 24">
          <path style={{ fill: "var(--ico-acc)" }} d="M9.4 3H18.6A2.4 2.4 0 0 1 21 5.4V14.6A2.4 2.4 0 0 1 18.6 17H18.2V5.8H7V5.4A2.4 2.4 0 0 1 9.4 3Z" />
          <path
            style={{ fill: "var(--ico-body)", stroke: "var(--ico-line)" }}
            strokeWidth="1.1"
            strokeLinejoin="round"
            fillRule="evenodd"
            d="M5.4 7H14.6A2.4 2.4 0 0 1 17 9.4V18.6A2.4 2.4 0 0 1 14.6 21H5.4A2.4 2.4 0 0 1 3 18.6V9.4A2.4 2.4 0 0 1 5.4 7ZM9.15 10.2H10.85L13.3 18.4H11.55L11.05 16.6H8.95L8.45 18.4H6.7ZM10 12.6L9.35 15.1H10.65Z"
          />
        </symbol>
        <symbol id="i-gram" viewBox="0 0 24 24">
          <rect style={{ fill: "var(--ico-acc)" }} x="9" y="2.5" width="6" height="6" rx="2" />
          <path style={{ fill: "var(--ico-acc)" }} d="M11.25 8.5H12.75V11.25H19.25V15.5H17.75V12.75H6.25V15.5H4.75V11.25H11.25Z" />
          <rect style={{ fill: "var(--ico-body)", stroke: "var(--ico-line)" }} strokeWidth="1.1" x="2.5" y="15.5" width="6" height="6" rx="2" />
          <rect style={{ fill: "var(--ico-body)", stroke: "var(--ico-line)" }} strokeWidth="1.1" x="15.5" y="15.5" width="6" height="6" rx="2" />
        </symbol>
        <symbol id="i-listen" viewBox="0 0 24 24">
          <path style={{ fill: "var(--ico-acc)" }} d="M3 13A9 9 0 0 1 21 13H19A7 7 0 0 0 5 13Z" />
          <rect style={{ fill: "var(--ico-body)", stroke: "var(--ico-line)" }} strokeWidth="1.1" x="2.5" y="12.3" width="5.6" height="9.2" rx="2.4" />
          <rect style={{ fill: "var(--ico-body)", stroke: "var(--ico-line)" }} strokeWidth="1.1" x="15.9" y="12.3" width="5.6" height="9.2" rx="2.4" />
        </symbol>
        <symbol id="i-read" viewBox="0 0 24 24">
          <path style={{ fill: "var(--ico-acc)" }} d="M11.2 6.2C8.8 4.6 5.7 4.1 2.5 4.6V18.8C5.7 18.3 8.8 18.8 11.2 20.4Z" />
          <path
            style={{ fill: "var(--ico-body)", stroke: "var(--ico-line)" }}
            strokeWidth="1.1"
            strokeLinejoin="round"
            fillRule="evenodd"
            d="M12.8 6.2C15.2 4.6 18.3 4.1 21.5 4.6V18.8C18.3 18.3 15.2 18.8 12.8 20.4ZM14.8 9.3V10.5L19.5 9.9V8.7ZM14.8 12.5V13.7L19.5 13.1V11.9Z"
          />
        </symbol>
        <symbol id="l-chain" viewBox="0 0 24 24">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </symbol>
        <symbol id="l-snow" viewBox="0 0 24 24">
          <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5" />
        </symbol>
        <symbol id="l-gear" viewBox="0 0 24 24">
          <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
          <circle cx="15" cy="7" r="2" />
          <circle cx="9" cy="17" r="2" />
        </symbol>
        <symbol id="l-chev" viewBox="0 0 24 24">
          <path d="M7 10l5 5 5-5" />
        </symbol>
        <symbol id="l-dots" viewBox="0 0 24 24">
          <path d="M6 12h.01M12 12h.01M18 12h.01" />
        </symbol>
        <symbol id="l-x" viewBox="0 0 24 24">
          <path d="M18 6 6 18M6 6l12 12" />
        </symbol>
        <symbol id="l-mute" viewBox="0 0 24 24">
          <path d="M11 5 6 9H2v6h4l5 4V5zM22 9l-6 6M16 9l6 6" />
        </symbol>
        <symbol id="l-spk" viewBox="0 0 24 24">
          <path d="M11 5 6 9H2v6h4l5 4V5z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
        </symbol>
        <symbol id="l-spk1" viewBox="0 0 24 24">
          <path d="M11 5 6 9H2v6h4l5 4V5z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
        </symbol>
        <symbol id="l-tempo" viewBox="0 0 24 24">
          <path d="M5 18.5a8.5 8.5 0 1 1 14 0" />
          <path d="M12 14.5 8.2 11" />
          <circle cx="12" cy="14.5" r="1.3" />
        </symbol>
        <symbol id="l-mic" viewBox="0 0 24 24">
          <rect x="9" y="2" width="6" height="12" rx="3" />
          <path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4" />
        </symbol>
        <symbol id="l-stop" viewBox="0 0 24 24">
          <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />
        </symbol>
        <symbol id="l-note" viewBox="0 0 24 24">
          <path d="M5 4h11l3 3v13H5z" />
          <path d="M9 10l6 6M15 10l-6 6" />
        </symbol>
        <symbol id="l-stack" viewBox="0 0 24 24">
          <path d="m12 3 9 5-9 5-9-5 9-5z" />
          <path d="m3 13 9 5 9-5" />
        </symbol>
        <symbol id="l-book" viewBox="0 0 24 24">
          <path d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5c-3.5-.5-6.5 0-8.5 1.5z" />
          <path d="M12 6.5v13" />
        </symbol>
        <symbol id="l-type" viewBox="0 0 24 24">
          <path d="M5 6V4h14v2M12 4v16M9 20h6" />
        </symbol>
        <symbol id="l-back" viewBox="0 0 24 24">
          <path d="M15 6l-6 6 6 6" />
        </symbol>
        <symbol id="l-fwd" viewBox="0 0 24 24">
          <path d="M9 6l6 6-6 6" />
        </symbol>
        <symbol id="l-flag" viewBox="0 0 24 24">
          <path d="M5 21V4h11l-1.5 4L16 12H5" />
        </symbol>
        <symbol id="l-cal" viewBox="0 0 24 24">
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </symbol>
        <symbol id="l-check" viewBox="0 0 24 24">
          <path d="M5 12.5l4.5 4.5L19 7" />
        </symbol>
        <symbol id="l-search" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.2-4.2" />
        </symbol>
        <symbol id="l-offline" viewBox="0 0 24 24">
          <path d="M3 3l18 18M8.6 16.4a5 5 0 0 1 6.8 0M5.2 13a10 10 0 0 1 4.3-2.6M18.8 13a10 10 0 0 0-2-1.6M2 9a15 15 0 0 1 4.2-2.8M22 9a15 15 0 0 0-10.5-4M12 20h.01" />
        </symbol>
        <symbol id="l-lock" viewBox="0 0 24 24">
          <rect x="5" y="11" width="14" height="10" rx="2.5" />
          <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
        </symbol>
        <symbol id="l-logout" viewBox="0 0 24 24">
          <path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 17l-5-5 5-5M5 12h11" />
        </symbol>
        <symbol id="l-reset" viewBox="0 0 24 24">
          <path d="M4 12a8 8 0 1 0 2.6-5.9L4 8.5" />
          <path d="M4 4v4.5h4.5" />
        </symbol>
        <symbol id="l-panel" viewBox="0 0 24 24">
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
          <path d="M9.5 4.5v15" />
        </symbol>
        <symbol id="l-info" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 11v5M12 8v.01" />
        </symbol>
        <symbol id="l-erase" viewBox="0 0 24 24">
          <path d="M20 5H9.5L3.5 12l6 7H20a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" />
          <path d="m16.5 9.5-5 5M11.5 9.5l5 5" />
        </symbol>
        <symbol id="l-shift" viewBox="0 0 24 24">
          <path d="M12 4 4.5 12H9v7h6v-7h4.5z" />
        </symbol>
        <symbol id="l-table" viewBox="0 0 24 24">
          <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
          <path d="M3.5 9.5h17M3.5 14.5h17M10 4v16" />
        </symbol>
        <symbol id="l-swap" viewBox="0 0 24 24">
          <path d="M5 8h13l-3.5-3.5M19 16H6l3.5 3.5" />
        </symbol>
        <radialGradient id="drop-g" cx="38%" cy="30%" r="75%">
          <stop offset="0" stopColor="#FF9BBB" />
          <stop offset=".3" stopColor="#F0527F" />
          <stop offset=".72" stopColor="#D81E5B" />
          <stop offset="1" stopColor="#A8134A" />
        </radialGradient>
      </defs>
    </svg>
  );
}

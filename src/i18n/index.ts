import { Fragment, createElement, type ReactNode } from "react";
import fa from "./fa.json";

/**
 * Interface text. Every Persian string lives in fa.json (PRD §15.6); other interface languages
 * get their own file with the same keys and an entry in `locales`.
 */
export const locales = {
  fa: { lang: "fa", dir: "rtl", numbers: "fa-IR", messages: fa },
} as const;

export type Locale = keyof typeof locales;
export const defaultLocale: Locale = "fa";

type Messages = typeof fa;
type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<Messages>;
export type MessageVars = Record<string, string | number>;

function lookup(messages: unknown, key: string): string | undefined {
  let node: unknown = messages;
  for (const part of key.split(".")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === "string" ? node : undefined;
}

/** Formats a number with the locale's digits (Persian digits for fa). */
export function formatNumber(value: number, locale: Locale = defaultLocale): string {
  return new Intl.NumberFormat(locales[locale].numbers).format(value);
}

/** Returns the text for `key`, filling {name} placeholders. Numbers use the locale's digits. */
export function t(key: MessageKey, vars?: MessageVars, locale: Locale = defaultLocale): string {
  const template = lookup(locales[locale].messages, key) ?? lookup(locales[defaultLocale].messages, key) ?? key;
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name];
    if (value === undefined) return match;
    return typeof value === "number" ? formatNumber(value, locale) : value;
  });
}

/**
 * Like t, but a placeholder can be a React node, such as a French word set in the Latin face inside a
 * Persian sentence. Returns the pieces in order, ready to render.
 */
export function tRich(key: MessageKey, vars: Record<string, ReactNode>, locale: Locale = defaultLocale): ReactNode[] {
  const template = lookup(locales[locale].messages, key) ?? lookup(locales[defaultLocale].messages, key) ?? key;
  return template.split(/(\{\w+\})/).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    if (!name || !(name in vars)) return part;
    const value = vars[name];
    return createElement(Fragment, { key: index }, typeof value === "number" ? formatNumber(value, locale) : value);
  });
}

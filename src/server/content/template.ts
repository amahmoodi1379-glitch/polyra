import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Prompt templates live in prompts/<version> (PRD §14). Places to fill are written ⟦name⟧, because
 * {{ }} already means "a blank" inside the prompts themselves (PRD §14.1 rule 7).
 */
export const PROMPT_VERSION = "v1";

const placeholder = /⟦([a-z_]+)⟧/g;

/** Fills every ⟦name⟧. A missing value is a programming error, never a half-filled prompt. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  const missing = new Set<string>();
  const filled = template.replace(placeholder, (_, name: string) => {
    const value = values[name];
    if (value === undefined) missing.add(name);
    return value ?? "";
  });
  if (missing.size > 0) throw new Error(`Prompt values missing: ${[...missing].join(", ")}`);
  return filled;
}

const cache = new Map<string, string>();

/** Reads prompts/<version>/<name>; templates are part of the app and never change while it runs. */
export function readTemplate(name: string, version = PROMPT_VERSION): string {
  const key = `${version}/${name}`;
  let text = cache.get(key);
  if (text === undefined) {
    text = readFileSync(join(process.cwd(), "prompts", version, name), "utf8").trim();
    cache.set(key, text);
  }
  return text;
}

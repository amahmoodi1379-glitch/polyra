/** Each error goes once per page load; asking again gives the same code back. */
const sent = new Map<string, Promise<string | null>>();

/** Errors that say nothing about our code: browser extensions, cross-site scripts, layout loops. */
const NOISE = [/^Script error\.?$/, /ResizeObserver loop/, /chrome-extension:\/\//, /moz-extension:\/\//, /safari-(web-)?extension:\/\//];

/**
 * Sends an error that happened in this browser to `error_log` (PRD §15.9) and returns its short code,
 * or null when it was not sent.
 */
export function reportError(error: unknown, where = window.location.pathname): Promise<string | null> {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error ?? null);
  const stack = error instanceof Error ? (error.stack ?? "") : "";
  if (!message || NOISE.some((pattern) => pattern.test(message) || pattern.test(stack))) return Promise.resolve(null);
  const key = `${where}|${message}`;
  const pending = sent.get(key) ?? send(message, stack, where);
  sent.set(key, pending);
  return pending;
}

async function send(message: string, stack: string, where: string): Promise<string | null> {
  try {
    const response = await fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, stack, where }),
      keepalive: true,
    });
    if (!response.ok) return null;
    return ((await response.json()) as { code?: string }).code ?? null;
  } catch {
    return null;
  }
}

/** Where an error came from: «browser …» rows were sent by a page, every other row by the server. */
export const errorKinds = ["server", "browser"] as const;
export type ErrorKind = (typeof errorKinds)[number];

export const isErrorKind = (value: unknown): value is ErrorKind => errorKinds.includes(value as ErrorKind);
export const kindOfWhere = (where: string): ErrorKind => (where.startsWith("browser ") ? "browser" : "server");

/** One error and its repeats, as the «خطاها» page lists it. */
export type ErrorGroup = {
  code: string;
  kind: ErrorKind;
  count: number;
  users: number;
  first: Date;
  last: Date;
  where: string;
  message: string;
  stack: string | null;
  requestId: string | null;
  phone: string | null;
};

/**
 * The text «کپی برای Claude Code» copies (PRD §15.9): one line saying what to do, then everything
 * known about the error, so the owner can paste it as it is.
 */
export function errorReport(group: ErrorGroup): string {
  const seen = group.count === 1 ? `once, ${group.last.toISOString()}` : `${group.count} times, first ${group.first.toISOString()}, last ${group.last.toISOString()}`;
  const lines = [
    "This error happened in Polyra. Find the cause and fix it.",
    "",
    `Code: ${group.code}`,
    `Seen: ${seen}${group.users > 0 ? `, signed-in users: ${group.users}` : ""}`,
    `Where: ${group.kind === "browser" ? `${group.where.slice("browser ".length)} (in the browser)` : `${group.where} (on the server)`}`,
    `Message: ${group.message}`,
  ];
  if (group.requestId) lines.push(`Digest: ${group.requestId}`);
  if (group.stack) lines.push("Stack:", group.stack);
  return lines.join("\n");
}

import type { ErrorKind } from "@/server/error-report";

export type ErrorsState = { kind: ErrorKind | null; q: string; page?: number };

export function errorsHref({ kind, q, page = 1 }: ErrorsState) {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/errors?${query}` : "/admin/errors";
}

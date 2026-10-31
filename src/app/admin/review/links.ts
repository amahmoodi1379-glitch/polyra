import type { LibrarySlug } from "@/server/content/library/slugs";

export type ReviewState = { language: string; batch?: number | null; type?: LibrarySlug | null; at?: { slug: LibrarySlug; id: number } | null };

/** «بازبینی» for a language, one batch or one type, opened at an item (`at=words-12`). */
export function reviewHref(state: ReviewState) {
  const params = new URLSearchParams({ lang: state.language });
  if (state.batch) params.set("batch", String(state.batch));
  if (state.type) params.set("type", state.type);
  if (state.at) params.set("at", `${state.at.slug}-${state.at.id}`);
  return `/admin/review?${params}`;
}

import type { StatusFilter } from "@/server/content/library/list";
import type { LibrarySlug } from "@/server/content/library/slugs";

export type LibraryState = {
  language: string;
  type: LibrarySlug;
  level?: string | null;
  status?: StatusFilter;
  incomplete?: boolean;
  q?: string;
  page?: number;
};

/** The list's address for a set of filters; defaults are left out so links stay short. */
export function libraryHref(state: LibraryState) {
  const params = new URLSearchParams({ lang: state.language, type: state.type });
  if (state.level) params.set("level", state.level);
  if (state.status) params.set("status", state.status);
  if (state.incomplete) params.set("missing", "1");
  if (state.q) params.set("q", state.q);
  if (state.page && state.page > 1) params.set("page", String(state.page));
  return `/admin/content?${params}`;
}

/** An item's edit page. */
export const itemHref = (type: LibrarySlug, id: number) => `/admin/content/${type}/${id}`;

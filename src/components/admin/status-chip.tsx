import { Pause } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ContentStatusValue } from "@/server/content/library/slugs";

/**
 * An item's status as a small chip, from quiet to strong along the path draft → published. Teal is
 * kept for right answers (DESIGN.md), so approval is ink on tint and publishing is the brand fill.
 */
const look: Record<ContentStatusValue, string> = {
  draft: "border border-line-2 text-ink-3",
  needs_review: "bg-tint text-brand-text",
  approved: "bg-tint-2 text-ink",
  published: "bg-brand text-on-brand",
  retired: "border border-dashed border-line-2 text-ink-3",
};

export function StatusChip({ status, suspended, className }: { status: ContentStatusValue; suspended?: boolean; className?: string }) {
  return (
    <span className={cn("flex items-center gap-1.5", className)}>
      <span className={cn("flex h-7 items-center rounded-[9px] px-2.5 text-[12.5px] font-bold whitespace-nowrap", look[status])}>
        {t(`admin.library.statuses.${status}`)}
      </span>
      {suspended ? (
        <span className="bg-idk-soft text-idk flex h-7 items-center gap-1 rounded-[9px] px-2 text-[12.5px] font-bold whitespace-nowrap">
          <Pause className="size-3" strokeWidth={2.5} aria-hidden />
          {t("admin.library.statuses.suspended")}
        </span>
      ) : null}
    </span>
  );
}

/** A CEFR level, set in the Latin face (DESIGN.md «Level»). */
export function LevelChip({ level }: { level: string }) {
  return (
    <bdi className="lat bg-tint text-brand-text flex h-7 items-center rounded-[9px] px-2 text-[14px] font-semibold">{level}</bdi>
  );
}

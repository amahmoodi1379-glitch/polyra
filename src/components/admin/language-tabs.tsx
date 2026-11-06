"use client";

import { useState } from "react";
import Link from "@/components/admin/link";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { LanguageCode } from "@/server/content/languages";

const codes: readonly LanguageCode[] = ["fr", "de"];

/**
 * French or German, for panel pages an admin who works in both languages opens. The other language's
 * page is fetched in full as soon as the tabs are on screen, so the switch is instant; the tapped tab
 * lights up at once either way.
 */
export function LanguageTabs({ current, path }: { current: LanguageCode; path: string }) {
  const [picked, setPicked] = useState<{ code: LanguageCode; from: LanguageCode } | null>(null);
  if (picked && picked.from !== current) setPicked(null);
  const shown = picked?.code ?? current;

  return (
    <nav aria-label={t("admin.create.language")} className="bg-tint grid grid-cols-2 gap-1 rounded-[16px] p-1">
      {codes.map((code) => (
        <Link
          key={code}
          href={`${path}${path.includes("?") ? "&" : "?"}lang=${code}`}
          prefetch={code === current ? false : true}
          scroll={false}
          onClick={() => code !== current && setPicked({ code, from: current })}
          aria-current={code === shown ? "page" : undefined}
          className={cn(
            "flex h-9 min-w-24 items-center justify-center rounded-[12px] px-4 text-[13.5px] font-bold transition-[background-color,color,box-shadow] duration-150",
            code === shown ? "bg-surface dark:bg-tint-2 text-brand-text shadow-[var(--shadow-1)]" : "text-ink-2 hover:text-ink",
          )}
        >
          {t(`common.languages.${code}`)}
        </Link>
      ))}
    </nav>
  );
}

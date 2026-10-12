import Link from "next/link";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { languageCodes, type LanguageCode } from "@/server/content/languages";

/** French or German, for panel pages an admin who works in both languages opens. */
export function LanguageTabs({ current, path }: { current: LanguageCode; path: string }) {
  return (
    <nav aria-label={t("admin.create.language")} className="bg-tint grid grid-cols-2 gap-1 rounded-[16px] p-1">
      {languageCodes.map((code) => (
        <Link
          key={code}
          href={`${path}?lang=${code}`}
          aria-current={code === current ? "page" : undefined}
          className={cn(
            "flex h-9 min-w-24 items-center justify-center rounded-[12px] px-4 text-[13.5px] font-bold transition-[background-color,color,box-shadow] duration-150",
            code === current ? "bg-surface dark:bg-tint-2 text-brand-text shadow-[var(--shadow-1)]" : "text-ink-2 hover:text-ink",
          )}
        >
          {t(`common.languages.${code}`)}
        </Link>
      ))}
    </nav>
  );
}

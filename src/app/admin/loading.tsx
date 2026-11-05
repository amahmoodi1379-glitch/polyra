import { t } from "@/i18n";

/**
 * What a panel page shows the moment it is clicked, while its data comes from the server. The side
 * menu stays put; only the page area turns into this quiet outline of a header and a few cards. Having
 * this file also lets Next.js fetch every panel page's frame ahead of the click.
 */
export default function AdminLoading() {
  return (
    <>
      <p role="status" className="sr-only">
        {t("common.loading")}
      </p>
      <div aria-hidden className="admin-skeleton flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <span className="bg-tint h-7 w-48 rounded-[10px]" />
          <span className="bg-tint/70 h-4 w-full max-w-[420px] rounded-[8px]" />
        </div>
        <div className="bg-surface flex flex-col gap-5 rounded-[22px] p-6 shadow-[var(--shadow-1)]">
          {[72, 56, 64].map((width) => (
            <div key={width} className="flex items-center gap-4">
              <span className="bg-tint size-10 shrink-0 rounded-full" />
              <div className="flex flex-1 flex-col gap-2">
                <span className="bg-tint h-4 rounded-[8px]" style={{ width: `${width}%` }} />
                <span className="bg-tint/60 h-3 w-1/3 rounded-[6px]" />
              </div>
            </div>
          ))}
        </div>
        <div className="bg-surface h-40 rounded-[22px] shadow-[var(--shadow-1)]" />
      </div>
    </>
  );
}

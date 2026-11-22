import { AudioLines } from "lucide-react";
import { formatNumber, t } from "@/i18n";
import { formatAgoFa } from "@/lib/format";
import { cn } from "@/lib/utils";
import { machineProgress, type AudioType } from "@/server/content/audio/machine";

const types: AudioType[] = ["words", "sentences", "texts", "phonics"];
const sum = (counts: Record<AudioType, number>) => types.reduce((total, type) => total + counts[type], 0);

const chips = {
  working: "bg-tint text-brand-text",
  idle: "bg-ok-soft text-ok",
  unavailable: "bg-bad-soft text-bad",
  off: "bg-idk-soft text-idk",
} as const;

/**
 * The machine voice on the «صدا» page (DECISIONS.md, 18 Nov 2026): whether it is working, how many
 * places have a file and how many still wait, by type, as the generator last counted them.
 */
export async function GeneratorCard({ language }: { language: string }) {
  const progress = await machineProgress(language);
  const now = new Date();
  const made = sum(progress.made);
  const waiting = sum(progress.waiting);
  const declined = sum(progress.declined);
  const share = made + waiting > 0 ? made / (made + waiting) : 0;
  const percent = Math.round(share * 100);
  const waitingTypes = types.filter((type) => progress.waiting[type] > 0);

  return (
    <section aria-labelledby="machine-voice" className="bg-surface flex flex-col gap-3.5 rounded-[22px] px-5 py-5 shadow-[var(--shadow-1)] sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="machine-voice" className="text-ink flex items-center gap-2 text-[15px] font-extrabold">
          <AudioLines className="text-brand-text size-[18px]" strokeWidth={2.25} aria-hidden />
          {t("admin.audio.page.generator.title")}
        </h2>
        <span className={cn("flex h-7 items-center gap-1.5 rounded-[9px] px-2.5 text-[12.5px] font-bold whitespace-nowrap", chips[progress.phase])}>
          {progress.phase === "working" ? <span className="bg-brand size-1.5 rounded-full motion-safe:animate-pulse" aria-hidden /> : null}
          {t(`admin.audio.page.generator.states.${progress.phase}`)}
        </span>
      </div>
      <p className="text-ink-2 max-w-[68ch] text-[14px] leading-6">{t(`admin.audio.page.generator.${progress.phase}`)}</p>

      {made + waiting > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-ink text-[14px] font-bold tabular-nums">
            {t("admin.audio.page.generator.progress", { made: formatNumber(made), waiting: formatNumber(waiting) })}
          </p>
          <div
            role="progressbar"
            aria-label={t("admin.audio.page.generator.title")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="bg-tint h-2 overflow-hidden rounded-full"
          >
            <div className="bg-brand h-full rounded-full" style={{ width: `${percent}%` }} />
          </div>
          {waitingTypes.length > 0 ? (
            <ul className="text-ink-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular-nums">
              {waitingTypes.map((type) => (
                <li key={type}>
                  {t("admin.audio.page.generator.waitingOf", { type: t(`admin.audio.page.types.${type}`), count: formatNumber(progress.waiting[type]) })}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {progress.lastMadeAt || progress.failed > 0 || declined > 0 ? (
        <div className="text-ink-3 flex flex-col gap-0.5 text-[13px] leading-6">
          {progress.lastMadeAt ? <p>{t("admin.audio.page.generator.lastMade", { ago: formatAgoFa(progress.lastMadeAt, now) })}</p> : null}
          {declined > 0 ? <p>{t("admin.audio.page.generator.declined", { count: formatNumber(declined) })}</p> : null}
          {progress.failed > 0 ? <p className="text-bad">{t("admin.audio.page.generator.failed", { count: formatNumber(progress.failed) })}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

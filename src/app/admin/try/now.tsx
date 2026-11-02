import type { ReactNode } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { formatNumber, t } from "@/i18n";
import { isolateLatin } from "@/lib/bidi";
import type { HomeData } from "@/server/learn/home";
import type { NextLine, ProductionOverview, TextLine, TrackOverview } from "@/server/learn/rehearse";
import { itemHref } from "../content/links";

/** Step 2: the account today, as its home screen counts it, and the way into the app. */
export function NowCard({ language, home }: { language: string; home: HomeData | null }) {
  return (
    <section aria-labelledby="now" className="flex flex-col gap-3">
      <h2 id="now" className="text-ink text-[19px] font-extrabold">
        {t("admin.rehearse.nowTitle")}
      </h2>
      {home ? (
        <div className="bg-surface flex flex-col gap-4 rounded-[22px] px-5 py-5 shadow-[var(--shadow-1)]">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
            <Fact label={t("admin.rehearse.streak")} value={home.streak.count} />
            <Fact label={t("admin.rehearse.words")} value={home.skills.find((tile) => tile.skill === "vocab")?.introduced ?? 0} />
            <Fact label={t("admin.rehearse.lessons")} value={home.skills.find((tile) => tile.skill === "grammar")?.introduced ?? 0} />
            <Fact label={t("admin.rehearse.due")} value={home.skills.reduce((sum, tile) => sum + tile.due, 0)} />
            <Fact label={t("admin.rehearse.notebook")} value={home.links.notebook} />
          </dl>
          <p className="text-ink-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
            <span className="font-bold">{t("admin.rehearse.levels")}:</span>
            {home.skills.map((tile) => (
              <span key={tile.skill}>
                {t(`admin.rehearse.skills.${tile.skill}`)} <bdi className="lat">{isolateLatin(tile.level)}</bdi>
              </span>
            ))}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link
              href={`/learn/${language}`}
              target="_blank"
              className="bg-brand text-on-brand flex h-11 items-center gap-2 rounded-[14px] px-5 text-[15px] font-bold shadow-[var(--btn-glow)]"
            >
              <ExternalLink className="size-4.5" strokeWidth={1.75} aria-hidden />
              {t("admin.rehearse.open")}
            </Link>
            <p className="text-ink-3 max-w-[56ch] text-[13px] leading-6">{t("admin.rehearse.openHint")}</p>
          </div>
        </div>
      ) : (
        <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-8 text-center shadow-[var(--shadow-1)]">{t("admin.rehearse.notStarted")}</p>
      )}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-ink-3 text-[12.5px]">{label}</dt>
      <dd className="text-ink text-[22px] font-extrabold tabular-nums">{formatNumber(value)}</dd>
    </div>
  );
}

/** Step 3: what «شروع» would bring now, item by item. */
export function NextList({ language, next }: { language: string; next: { minutes: number; empty: boolean; lines: NextLine[] } | null }) {
  return (
    <section aria-labelledby="next" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="next" className="text-ink text-[19px] font-extrabold">
          {t("admin.rehearse.nextTitle")}
        </h2>
        <p className="text-ink-2 max-w-[68ch] text-[14.5px] leading-7">{t("admin.rehearse.nextLead")}</p>
      </div>
      {!next || next.empty ? (
        <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-6 shadow-[var(--shadow-1)]">{t("admin.rehearse.nextEmpty")}</p>
      ) : (
        <ol className="bg-surface rounded-[22px] shadow-[var(--shadow-1)]">
          {next.lines.map((line, index) => (
            <li key={index} className="border-line grid grid-cols-[2rem_9.5rem_minmax(0,1fr)_auto] items-center gap-x-3 border-b px-5 py-2.5 last:border-b-0">
              <span className="text-ink-3 text-[12.5px] tabular-nums">{formatNumber(index + 1)}</span>
              <span className="text-ink-2 text-[13.5px] font-bold">{t(`admin.rehearse.kinds.${line.kind}`)}</span>
              <span className="text-ink min-w-0 truncate text-[15px]">
                {line.kind === "notebook" || line.kind === "newUnit" || line.kind === "unit" || line.kind === "phonics" || line.kind === "text" || line.kind === "dialogue" ? (
                  line.name
                ) : (
                  <bdi lang={language} dir="ltr" className="lat">
                    {line.name}
                  </bdi>
                )}
              </span>
              <span className="text-ink-3 text-[12.5px] tabular-nums">{line.count > 1 ? t("admin.rehearse.times", { n: line.count }) : null}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const share = (value: number) => `${formatNumber(Math.round(value * 100))}٪`;
const day = (iso: string) => new Intl.DateTimeFormat("fa-IR", { month: "long", day: "numeric", timeZone: "Asia/Tehran" }).format(new Date(iso));

/** Step 3b: the texts as the engine sees them (PRD §7.4, §7.5): each track, then every text started. */
export function TextsCard({ overview }: { overview: { tracks: TrackOverview[]; texts: TextLine[]; available: number } | null }) {
  if (!overview) return null;
  return (
    <section aria-labelledby="texts" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="texts" className="text-ink text-[19px] font-extrabold">
          {t("admin.rehearse.textsTitle")}
        </h2>
        <p className="text-ink-2 max-w-[68ch] text-[14.5px] leading-7">{t("admin.rehearse.textsLead")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {overview.tracks.map((track) => (
          <div key={track.track} className="bg-surface flex flex-col gap-1.5 rounded-[22px] px-5 py-4 shadow-[var(--shadow-1)]" data-track={track.track}>
            <h3 className="text-ink text-[16px] font-extrabold">{t(`admin.rehearse.tracks.${track.track}`)}</h3>
            <p className="text-ink-2 text-[14px]">
              {t("admin.rehearse.trackLine", { level: track.level, done: formatNumber(track.firstRounds), need: formatNumber(track.need) })}
            </p>
            <p className="text-ink-2 text-[14px]">{track.score === null ? t("admin.rehearse.trackNoScore") : t("admin.rehearse.trackScore", { score: share(track.score) })}</p>
            <p className="text-ink-2 text-[14px]">{t(`admin.rehearse.waiting.${track.waiting ?? "none"}`)}</p>
            <p className="text-ink-3 text-[13px]">
              {track.nextNew ? (
                <>
                  {t("admin.rehearse.nextNew", { title: "" })}
                  <bdi dir="ltr" className="lat">
                    {track.nextNew}
                  </bdi>
                </>
              ) : (
                t("admin.rehearse.noNextNew")
              )}
            </p>
          </div>
        ))}
      </div>
      {overview.texts.length === 0 ? (
        <p className="bg-surface text-ink-2 rounded-[22px] px-6 py-6 shadow-[var(--shadow-1)]">{t("admin.rehearse.textsNone", { n: formatNumber(overview.available) })}</p>
      ) : (
        <ul className="bg-surface rounded-[22px] shadow-[var(--shadow-1)]">
          {overview.texts.map((text, index) => (
            <li key={index} className="border-line flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-5 py-2.5 text-[14px] last:border-b-0">
              <bdi dir="ltr" className="lat text-ink min-w-[10rem] font-bold">
                {text.title}
              </bdi>
              <span className="text-ink-2">{t(`admin.rehearse.tracks.${text.track}`)}</span>
              <span className="text-ink-2">{t("admin.rehearse.textAttempts", { done: formatNumber(text.attemptsDone), total: formatNumber(text.attempts) })}</span>
              {text.firstScore !== null ? <span className="text-ink-2">{t("admin.rehearse.textFirst", { score: share(text.firstScore) })}</span> : null}
              {text.partial ? <span className="text-brand font-bold">{t("admin.rehearse.textPartial")}</span> : null}
              {text.borrowed ? <span className="text-ink-3">{t("admin.rehearse.textBorrowed")}</span> : null}
              <span className="text-ink-3">
                {text.nextAt ? t("admin.rehearse.textNext", { date: day(text.nextAt) }) : text.attemptsDone >= text.attempts ? t("admin.rehearse.textDone") : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const box = "bg-surface flex flex-col gap-1.5 rounded-[22px] px-5 py-4 shadow-[var(--shadow-1)]";
const linkClass = "text-brand-text font-bold underline-offset-4 hover:underline";

function Part({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={box}>
      <h3 className="text-ink text-[16px] font-extrabold">{title}</h3>
      {children}
    </div>
  );
}

const Line = ({ children, dim = false }: { children: ReactNode; dim?: boolean }) => <p className={dim ? "text-ink-3 text-[13px] leading-6" : "text-ink-2 text-[14px] leading-6"}>{children}</p>;

/** An attempt line: how many of the two attempts are done, their results and when the next comes. */
function Tried({ attemptsDone, results, nextAt }: { attemptsDone: number; results: string[]; nextAt: string | null }) {
  return (
    <span>
      {" · "}
      {t("admin.rehearse.prod.attempts", { done: formatNumber(attemptsDone), total: formatNumber(2) })}
      {results.length > 0 ? ` · ${t("admin.rehearse.prod.scores", { list: results.join("، ") })}` : null}
      {" · "}
      {nextAt ? t("admin.rehearse.prod.nextAt", { date: day(nextAt) }) : t("admin.rehearse.prod.over")}
    </span>
  );
}

/**
 * Step 3c: speaking and writing (PRD §8b): each part's gate and what comes next, linked to the item's
 * page where its learner screens can be tried, and every writing task to write in the app.
 */
export function ProductionCard({ language, overview }: { language: string; overview: ProductionOverview | null }) {
  if (!overview) return null;
  const { speak, dialogue, errorfix, writing } = overview;
  const gate = (value: { need: number; left: number } | null) => (value ? <Line>{t("admin.rehearse.prod.gate", { left: formatNumber(value.left), need: formatNumber(value.need) })}</Line> : null);
  const latin = (text: string) => (
    <bdi lang={language} dir="ltr" className="lat">
      {text}
    </bdi>
  );
  return (
    <section aria-labelledby="prod" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="prod" className="text-ink text-[19px] font-extrabold">
          {t("admin.rehearse.prod.title")}
        </h2>
        <p className="text-ink-2 max-w-[68ch] text-[14.5px] leading-7">{t("admin.rehearse.prod.lead")}</p>
        <p className="text-ink-3 text-[13px]">{t("admin.rehearse.prod.words", { n: formatNumber(overview.words) })}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Part title={t("admin.rehearse.prod.speak")}>
          {gate(speak.gate) ?? <Line>{t("admin.rehearse.prod.speakLine", { seen: formatNumber(speak.seen), finished: formatNumber(speak.finished), ready: formatNumber(speak.ready) })}</Line>}
        </Part>
        <Part title={t("admin.rehearse.prod.dialogue")}>
          {gate(dialogue.gate) ??
            (dialogue.next ? (
              <Line>
                {t("admin.rehearse.prod.next", { n: formatNumber(dialogue.next.attempt) })}{" "}
                <Link className={linkClass} href={`${itemHref("dialogues", dialogue.next.id)}#learner`}>
                  {dialogue.next.title}
                </Link>
              </Line>
            ) : (
              <Line>{t("admin.rehearse.prod.dialogueNone", { n: formatNumber(dialogue.available) })}</Line>
            ))}
          {dialogue.tried.map((item) => (
            <Line key={item.id} dim>
              <Link className={linkClass} href={`${itemHref("dialogues", item.id)}#learner`}>
                {item.title}
              </Link>
              <Tried attemptsDone={item.attemptsDone} results={item.scores.map(share)} nextAt={item.nextAt} />
            </Line>
          ))}
        </Part>
        <Part title={t("admin.rehearse.prod.errorfix")}>
          {!errorfix.open ? (
            <Line>{t("admin.rehearse.prod.closedLevel", { level: errorfix.level, from: errorfix.from })}</Line>
          ) : errorfix.next ? (
            <Line>
              {t("admin.rehearse.prod.next", { n: formatNumber(errorfix.next.attempt) })}{" "}
              <Link className={linkClass} href={`${itemHref("errorfix", errorfix.next.id)}#learner`}>
                {latin(errorfix.next.name)}
              </Link>
            </Line>
          ) : (
            <Line>{t("admin.rehearse.prod.errorfixNone", { n: formatNumber(errorfix.available) })}</Line>
          )}
          {errorfix.tried.map((item) => (
            <Line key={item.id} dim>
              <Link className={linkClass} href={`${itemHref("errorfix", item.id)}#learner`}>
                {latin(item.name)}
              </Link>
              <Tried attemptsDone={item.attemptsDone} results={item.ok.map((ok) => t(ok ? "admin.rehearse.prod.right" : "admin.rehearse.prod.wrong"))} nextAt={item.nextAt} />
            </Line>
          ))}
        </Part>
        <Part title={t("admin.rehearse.prod.writing")}>
          {writing.card.state === "closed" ? (
            <Line>{t("admin.rehearse.prod.writingClosed", { level: writing.card.level })}</Line>
          ) : writing.card.state === "done" ? (
            <Line>{t("admin.rehearse.prod.writingDone")}</Line>
          ) : writing.card.state === "none" ? (
            <Line>{t("admin.rehearse.prod.writingNone", { level: writing.card.level })}</Line>
          ) : (
            <Line>
              {t("admin.rehearse.prod.writingOpen", { prompt: writing.card.task.promptFa })}{" "}
              <Link className={linkClass} href={`/learn/${language}/writing`} target="_blank">
                {t("admin.rehearse.prod.writingOpenLink")}
              </Link>
            </Line>
          )}
        </Part>
      </div>
      <div className={box}>
        <h3 className="text-ink text-[16px] font-extrabold">{t("admin.rehearse.prod.tasksTitle")}</h3>
        <Line dim>{t("admin.rehearse.prod.tasksHint")}</Line>
        {writing.tasks.length === 0 ? (
          <Line>{t("admin.rehearse.prod.noTasks")}</Line>
        ) : (
          <ul className="flex flex-col">
            {writing.tasks.map((task) => (
              <li key={task.id} className="border-line flex items-center gap-3 border-b py-2 text-[14px] last:border-b-0">
                <bdi className="lat text-ink-3 w-8 shrink-0">{task.level}</bdi>
                <span className="text-ink min-w-0 flex-1 truncate">{task.promptFa}</span>
                <Link className={`${linkClass} flex shrink-0 items-center gap-1`} href={`/learn/${language}/writing?task=${task.id}`} target="_blank">
                  <ExternalLink className="size-4" strokeWidth={1.75} aria-hidden />
                  {t("admin.rehearse.prod.writingOpenLink")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

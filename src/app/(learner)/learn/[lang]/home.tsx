"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { Icon, type IconName } from "@/components/learn/icons";
import { Jelly } from "@/components/learn/jelly";
import { Mixed } from "@/components/learn/mixed";
import { useReducedMotion } from "@/components/learn/motion";
import { prefs, usePrefs, type Theme } from "@/components/learn/prefs";
import { buzz, sfx } from "@/components/learn/sfx";
import { Sheet } from "@/components/learn/sheet";
import { useToast } from "@/components/learn/toast";
import { formatNumber, t, tRich } from "@/i18n";
import type { SkillName } from "@/engine/state";
import { TRAVEL_DAYS } from "@/lib/travel";
import { cn } from "@/lib/utils";
import type { HomeData, PlanLine, SkillTile } from "@/server/learn/home";
import { changeSessionLength, moveMyTime, resetMyProgress, signOutLearner } from "../../actions";

type Props = {
  data: HomeData;
  languageName: string;
  languages: { code: string; name: string; enrolled: boolean }[];
  account: { admin: boolean; tester: boolean; sessionLength: number };
  lengths: number[];
  freeze: { max: number; minutes: number };
  /** The home's one notice bar (PRD §3.11): «حق با تو بود» after a report a teacher agreed with. */
  notice?: "report_fixed" | null;
};

type Scope = "mixed" | "quick" | "vocab" | "grammar" | "listening" | "reading" | "extra";
type Open = null | "level" | "streak" | "settings" | "lang" | SkillName;

const skillIcon: Record<SkillName, IconName> = { vocab: "i-vocab", grammar: "i-gram", listening: "i-listen", reading: "i-read" };
const playable = (tile: SkillTile) => !tile.lock;
const percent = (value: number) => ({ "--p": `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }) as CSSProperties;
const monogram = (code: string) => code.charAt(0).toUpperCase() + code.slice(1);
const lat = (text: string) => <span className="lat">{text}</span>;

/** «۵ روز مانده · تمدید» from this many days left (PRD §3.8). */
const RENEW_DAYS = 7;

function planText(plan: PlanLine): string | null {
  switch (plan.kind) {
    case "tester":
      return t("learn.home.tester");
    case "trialNotStarted":
      return t("learn.home.trialNotStarted");
    case "trial": {
      const days = Math.floor(plan.hours / 24);
      const hours = plan.hours % 24;
      if (days === 0) return t("learn.home.trialHours", { hours });
      return hours === 0 ? t("learn.home.trialDays", { days }) : t("learn.home.trialLeft", { days, hours });
    }
    case "subscription":
      return plan.days > RENEW_DAYS ? t("learn.home.subscription", { n: plan.days }) : t("learn.home.subscriptionSoon", { n: plan.days });
    case "none":
      return t("learn.home.noAccess");
  }
}

function startLine(data: HomeData): string {
  const { start } = data;
  if (data.locked) return t("learn.home.subLocked");
  if (start.resume) return t("learn.home.subResume", { minutes: start.minutes });
  if (start.empty) return t("learn.home.subEmpty");
  // «۱۵ دقیقه · ادامه متن و ۱۲ مرور» when a text left half-way leads the session (PRD §3.2).
  const parts = [
    start.resumeText ? t("learn.home.subResumeText") : null,
    start.reviews > 0 ? t("learn.home.subReviews", { n: start.reviews }) : null,
    start.newItems > 0 ? t("learn.home.subNew", { n: start.newItems }) : null,
  ].filter(Boolean);
  if (parts.length === 0) return t("learn.start.minutes", { n: start.minutes });
  return t("learn.home.sub", { minutes: start.minutes, parts: parts.join(t("learn.home.and")) });
}

function lockText(tile: SkillTile) {
  if (tile.lock?.kind === "words") return t("learn.home.lockWords", { n: tile.lock.left });
  return t("learn.home.lockMore");
}

/** «یک متن منتظر توست», or «ادامه متن» for one left half-way (PRD §10.4). */
const waitingText = (tile: SkillTile) => (tile.text === "resume" ? t("learn.home.textResume") : tile.text ? t("learn.home.textWaiting") : null);

export function Home({ data, languageName, languages, account, lengths, freeze, notice = null }: Props) {
  const router = useRouter();
  const toast = useToast();
  const device = usePrefs();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState<Open>(null);
  const close = () => setOpen(null);
  const lang = data.language;
  const session = (scope: Scope) => `/learn/${lang}/session?scope=${scope}`;

  useEffect(() => {
    // The app opens on this language next time (src/server/learn/guard.ts).
    document.cookie = `polyra_lang=${lang}; path=/; max-age=31536000; samesite=lax`;
    router.prefetch(session("mixed"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // A locked language sends every start to the lock page (PRD §3.8).
  const go = (scope: Scope) => router.push(data.locked ? `/learn/${lang}/plans` : session(scope));
  const show = (which: Open) => {
    sfx("press", 0.4);
    setOpen(which);
  };

  const [bar, setBar] = useState(notice);
  const plan = planText(data.plan);
  const idle = data.start.empty && !data.locked;
  const links = data.links;
  // The skill sheet keeps its content while it slides away.
  const [lastSkill, setLastSkill] = useState<SkillName | null>(null);
  const opened = data.skills.find((item) => item.skill === open);
  if (opened && opened.skill !== lastSkill) setLastSkill(opened.skill);
  const tile = data.skills.find((item) => item.skill === lastSkill);

  return (
    <main className="app">
      <section className="screen" aria-label={languageName}>
        <header className="tb">
          <div className="tb-s">
            {languages.length > 1 ? (
              <button type="button" className="lang" aria-label={t("learn.home.langSwitch", { language: languageName })} onClick={() => show("lang")}>
                <span className="monogram lat">{monogram(lang)}</span>
                {languageName}
                <Icon name="l-chev" className="i chev" />
              </button>
            ) : (
              <span className="lang">
                <span className="monogram lat">{monogram(lang)}</span>
                {languageName}
              </span>
            )}
            <button type="button" className="lvl" aria-label={t("learn.home.level", { level: data.overall })} onClick={() => show("level")}>
              <b className="lat">{data.overall}</b>
            </button>
          </div>
          <div className="tb-e">
            <button
              type="button"
              className={cn("stat str num", !data.streak.today && "faint")}
              aria-label={data.streak.today ? t("learn.home.streak", { n: data.streak.count }) : t("learn.home.streakNotToday", { n: data.streak.count })}
              onClick={() => show("streak")}
            >
              <Icon name="l-chain" />
              {formatNumber(data.streak.count)}
            </button>
            <button type="button" className="stat frz num" aria-label={t("learn.home.freezes", { n: data.streak.freezes })} onClick={() => show("streak")}>
              <Icon name="l-snow" />
              {formatNumber(data.streak.freezes)}
            </button>
            <button type="button" className="tb-btn" aria-label={t("learn.home.settings")} onClick={() => show("settings")}>
              <Icon name="l-gear" />
            </button>
          </div>
        </header>
        {plan ? (
          data.plan.kind === "tester" ? (
            <p className="plan num">{plan}</p>
          ) : (
            <Link className="plan num" href={`/learn/${lang}/plans`} data-plan-line={data.plan.kind} onClick={() => sfx("press", 0.4)}>
              {plan}
            </Link>
          )
        ) : null}
        {bar === "report_fixed" ? (
          <button
            type="button"
            className="notice-bar"
            data-notice="report_fixed"
            aria-label={`${t("learn.report.fixed")} · ${t("learn.report.close")}`}
            onClick={() => {
              sfx("release", 0.35);
              setBar(null);
            }}
          >
            <Icon name="l-check" className="i" />
            <span>{t("learn.report.fixed")}</span>
          </button>
        ) : null}

        <div className="hero">
          <Jelly
            label={t("learn.home.startLabel")}
            describedBy="start-sub"
            mode={idle ? "poke" : "launch"}
            onActivate={() => {
              if (idle) {
                toast(t("learn.home.emptyToast"));
                return;
              }
              if (!device.started) prefs.set({ started: true });
              go("mixed");
            }}
          />
          <span className="sub num" id="start-sub">
            {startLine(data)}
          </span>
          {!device.started && !idle && !data.locked ? <span className="hint">{t("learn.home.hint")}</span> : null}
          {reduced ? <span className="rm">{t("learn.home.reducedMotion")}</span> : null}
          {data.pathDone ? (
            <span className="path-done" data-path-done>
              {t("learn.home.pathDone")}
              {data.comingSoon ? ` ${data.comingSoon}` : ""}
            </span>
          ) : null}
        </div>
        {data.locked ? (
          <Link className="quick" href={`/learn/${lang}/plans`} data-lock-link>
            {t("learn.home.buy")}
          </Link>
        ) : idle && data.extra ? (
          <button type="button" className="quick" onClick={() => (sfx("press", 0.4), go("extra"))}>
            {t("learn.home.extra")}
          </button>
        ) : data.quick && !idle ? (
          <button type="button" className="quick" onClick={() => (sfx("press", 0.4), go("quick"))}>
            {t("learn.home.quick")}
          </button>
        ) : null}

        <div className="skills" role="group" aria-label={t("learn.home.skillsLabel")}>
          {data.skills.map((item) => {
            const name = t(`learn.skill.${item.skill}`);
            return (
              <div key={item.skill} className={cn("sk", item.lock && "off")}>
                <button
                  type="button"
                  className="sk-main"
                  aria-label={
                    item.lock
                      ? t("learn.home.skillOff", { skill: name, why: lockText(item) })
                      : [t("learn.home.skillSession", { skill: name, level: item.level }), waitingText(item)].filter(Boolean).join("، ")
                  }
                  onClick={() => {
                    if (playable(item)) {
                      sfx("press", 0.4);
                      go(item.skill as Scope);
                    } else show(item.skill);
                  }}
                >
                  <Icon name={skillIcon[item.skill]} />
                  <span className="nm">{name}</span>
                  {item.lock ? (
                    <span className="lock num">{lockText(item)}</span>
                  ) : (
                    <>
                      <span className="lv lat">{item.level}</span>
                      <span className="bar" style={percent(item.progress)} aria-hidden="true">
                        <i />
                      </span>
                      {item.text ? (
                        <span className="wait" aria-hidden="true">
                          {waitingText(item)}
                        </span>
                      ) : null}
                    </>
                  )}
                </button>
                <button type="button" className="more" aria-label={t("learn.home.skillDetails", { skill: name })} onClick={() => show(item.skill)}>
                  <Icon name="l-dots" />
                </button>
              </div>
            );
          })}
        </div>

        {data.writing && !data.locked ? (
          <nav className="links" aria-label={t("learn.writing.title")}>
            <Link href={`/learn/${lang}/writing`} onClick={() => sfx("press", 0.4)}>
              <Icon name="l-text" />
              <span className="t">{t("learn.writing.homeCard")}</span>
              <span className="cnt num">{t("learn.writing.homeSub", { min: data.writing.min, max: data.writing.max })}</span>
              <Icon name="l-back" className="i s fwd" />
            </Link>
          </nav>
        ) : null}

        {links.notebook + links.words + links.lessons + links.texts + links.writings > 0 || links.phonics ? (
          <nav className="links" aria-label={t("learn.home.linksLabel")}>
            {links.notebook > 0 ? (
              <Link href={`/learn/${lang}/notebook`} onClick={() => sfx("press", 0.4)}>
                <Icon name="l-note" />
                <span className="t">{t("learn.home.notebook")}</span>
                <b className="badge num">{formatNumber(links.notebook)}</b>
                <Icon name="l-back" className="i s fwd" />
              </Link>
            ) : null}
            {links.words > 0 ? (
              <Link href={`/learn/${lang}/words`} onClick={() => sfx("press", 0.4)}>
                <Icon name="l-stack" />
                <span className="t">{t("learn.home.words")}</span>
                <span className="cnt num">{t("learn.home.wordsCount", { n: links.words })}</span>
                <Icon name="l-back" className="i s fwd" />
              </Link>
            ) : null}
            {links.lessons > 0 ? (
              <Link href={`/learn/${lang}/lessons`} onClick={() => sfx("press", 0.4)}>
                <Icon name="l-book" />
                <span className="t">{t("learn.home.lessons")}</span>
                <span className="cnt num">{t("learn.home.lessonsCount", { n: links.lessons })}</span>
                <Icon name="l-back" className="i s fwd" />
              </Link>
            ) : null}
            {links.texts > 0 ? (
              <Link href={`/learn/${lang}/texts`} onClick={() => sfx("press", 0.4)}>
                <Icon name="l-text" />
                <span className="t">{t("learn.home.texts")}</span>
                <span className="cnt num">{t("learn.home.textsCount", { n: links.texts })}</span>
                <Icon name="l-back" className="i s fwd" />
              </Link>
            ) : null}
            {links.writings > 0 ? (
              <Link href={`/learn/${lang}/writings`} onClick={() => sfx("press", 0.4)}>
                <Icon name="l-text" />
                <span className="t">{t("learn.home.writings")}</span>
                <span className="cnt num">{t("learn.home.writingsCount", { n: links.writings })}</span>
                <Icon name="l-back" className="i s fwd" />
              </Link>
            ) : null}
            {links.phonics ? (
              <Link href={`/learn/${lang}/phonics`} onClick={() => sfx("press", 0.4)}>
                <Icon name="l-spk1" />
                <span className="t">{t("learn.home.phonics")}</span>
                <span className="cnt num">
                  {links.phonics.done ? t("learn.home.phonicsDone", { n: links.phonics.total }) : t("learn.home.phonicsCount", { index: links.phonics.index, total: links.phonics.total })}
                </span>
                <Icon name="l-back" className="i s fwd" />
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>

      <Sheet open={open === "level"} onClose={close} labelledBy="level-title">
        <h2 id="level-title">{tRich("learn.levelSheet.title", { level: lat(data.overall) })}</h2>
        <p className="lead">{t("learn.levelSheet.lead")}</p>
        <dl className="ledger">
          {data.skills.map((item) => (
            <div key={item.skill}>
              <dt>
                <Icon name={skillIcon[item.skill]} />
                {t(`learn.skill.${item.skill}`)}
              </dt>
              <dd>
                {item.lock ? (
                  <span className="muted">{t("learn.levelSheet.notOpen")}</span>
                ) : (
                  <>
                    <span className="bar" style={percent(item.progress)} aria-hidden="true">
                      <i />
                    </span>
                    <span className="lat">{item.level}</span>
                  </>
                )}
              </dd>
            </div>
          ))}
        </dl>
        <button type="button" className="ghost" onClick={close}>
          {t("learn.levelSheet.close")}
        </button>
      </Sheet>

      <Sheet open={open === "streak"} onClose={close} labelledBy="streak-title">
        <h2 id="streak-title" className="num">
          {t("learn.streakSheet.title", { n: data.streak.count })}
        </h2>
        <p className="lead">{data.streak.today ? t("learn.streakSheet.today") : t("learn.streakSheet.notToday")}</p>
        <dl className="ledger num">
          <div>
            <dt>
              <Icon name="l-chain" className="i str-i" />
              {t("learn.streakSheet.days")}
            </dt>
            <dd>{formatNumber(data.streak.count)}</dd>
          </div>
          <div>
            <dt>
              <Icon name="l-snow" className="i frz-i" />
              {t("learn.streakSheet.freezes")}
            </dt>
            <dd>{t("learn.streakSheet.freezesValue", { n: data.streak.freezes, max: freeze.max })}</dd>
          </div>
        </dl>
        <p className="soon num">{t("learn.streakSheet.how", { min: freeze.minutes })}</p>
        <button type="button" className="ghost" onClick={close}>
          {t("learn.streakSheet.close")}
        </button>
      </Sheet>

      <Sheet open={!!opened} onClose={close} labelledBy="skill-title">
        {tile ? <SkillDetails tile={tile} language={lang} comingSoon={data.comingSoon} locked={data.locked} onPractice={(scope) => go(scope)} onClose={close} /> : null}
      </Sheet>

      <Sheet open={open === "lang"} onClose={close} labelledBy="lang-title">
        <h2 id="lang-title">{t("learn.home.langTitle")}</h2>
        <nav className="choices">
          {languages.map((item) => (
            <Link
              key={item.code}
              className="choice"
              href={item.enrolled ? `/learn/${item.code}` : `/start/${item.code}`}
              aria-current={item.code === lang ? "page" : undefined}
              onClick={() => (item.code === lang ? close() : sfx("page", 0.4))}
            >
              <span className="monogram lat">{monogram(item.code)}</span>
              <span>
                {item.name}
                <small>{item.enrolled ? t("learn.home.learning") : t("learn.home.otherLanguage")}</small>
              </span>
              {item.code === lang ? <Icon name="l-check" className="i on" /> : <Icon name="l-back" className="i s fwd" />}
            </Link>
          ))}
        </nav>
      </Sheet>

      <Sheet open={open === "settings"} onClose={close} labelledBy="settings-title">
        <Settings language={lang} languageName={languageName} account={account} lengths={lengths} />
        <button type="button" className="primary jelly-press" onClick={close}>
          {t("learn.settings.close")}
        </button>
      </Sheet>
    </main>
  );
}

function SkillDetails({
  tile,
  language,
  comingSoon,
  locked,
  onPractice,
  onClose,
}: {
  tile: SkillTile;
  language: string;
  comingSoon: string | null;
  locked: boolean;
  onPractice: (scope: Scope) => void;
  onClose: () => void;
}) {
  const name = t(`learn.skill.${tile.skill}`);
  // Listening counts heard sentences beside its texts (PRD §7.6); reading has only texts.
  const ledger = tile.skill === "vocab" ? "words" : tile.skill === "grammar" ? "units" : tile.skill === "listening" ? "sentences" : null;
  return (
    <>
      <div className="ss-head">
        <Icon name={skillIcon[tile.skill]} />
        <h2 id="skill-title">{name}</h2>
        <span className="lv lat">{tile.level}</span>
      </div>
      {tile.lock ? (
        <p className="soon num">
          {tile.lock.kind === "words"
            ? t("learn.skillSheet.lockedWords", { skill: name, need: tile.lock.need, left: tile.lock.left })
            : tile.skill === "reading"
              ? t("learn.skillSheet.lockedReading")
              : t("learn.skillSheet.lockedMore")}
        </p>
      ) : (
        <dl className="ledger num">
          {tile.stations > 0 ? (
            <div>
              <dt>{t("learn.skillSheet.station")}</dt>
              <dd>{t("learn.skillSheet.stationValue", { n: Math.min(tile.station + 1, tile.stations), total: tile.stations })}</dd>
            </div>
          ) : null}
          {ledger ? (
            <>
              <div>
                <dt>{t(`learn.skillSheet.${ledger}.introduced`)}</dt>
                <dd>{formatNumber(tile.introduced)}</dd>
              </div>
              <div>
                <dt>{t(`learn.skillSheet.${ledger}.stable`)}</dt>
                <dd>{formatNumber(tile.stable)}</dd>
              </div>
            </>
          ) : null}
          {tile.texts ? (
            <>
              <div>
                <dt>{t("learn.skillSheet.texts.started")}</dt>
                <dd>{formatNumber(tile.texts.started)}</dd>
              </div>
              <div>
                <dt>{t("learn.skillSheet.texts.finished")}</dt>
                <dd>{formatNumber(tile.texts.finished)}</dd>
              </div>
            </>
          ) : null}
          {tile.texts || ledger === "words" || ledger === "units" ? (
            <div>
              <dt>{t(tile.texts ? "learn.skillSheet.texts.due" : ledger === "words" ? "learn.skillSheet.words.due" : "learn.skillSheet.units.due")}</dt>
              <dd>{formatNumber(tile.due)}</dd>
            </div>
          ) : null}
        </dl>
      )}
      {tile.texts?.wordsFor ? <p className="soon num">{t("learn.skillSheet.texts.wordsFor", { skill: name, level: tile.texts.wordsFor })}</p> : null}
      {tile.exam?.kind === "soon" ? <p className="soon num" data-exam="soon">{comingSoon ?? t("learn.skillSheet.nextSoon")}</p> : null}
      {tile.exam?.kind === "wait" ? (
        <p className="soon num" data-exam="wait">
          {t("learn.skillSheet.exam.wait", { level: tile.exam.next, date: tile.exam.until })}
        </p>
      ) : null}
      <div className="ss-foot">
        {playable(tile) && !locked ? (
          <button
            type="button"
            className="primary jelly-press"
            onClick={() => {
              sfx("release", 0.45);
              onPractice(tile.skill as Scope);
            }}
          >
            {t("learn.skillSheet.practice", { skill: name })}
          </button>
        ) : null}
        {(tile.exam?.kind === "ready" || tile.exam?.kind === "running") && !locked ? (
          <Link className="secondary" href={`/learn/${language}/exam/${tile.skill}`} data-exam={tile.exam.kind} onClick={() => sfx("page", 0.4)}>
            {tile.exam.kind === "running" ? t("learn.skillSheet.exam.resume") : t("learn.skillSheet.exam.skip", { level: tile.exam.next })}
          </Link>
        ) : null}
        <button type="button" className="ghost" onClick={onClose}>
          {t("learn.skillSheet.close")}
        </button>
      </div>
    </>
  );
}

function Settings({ language, languageName, account, lengths }: { language: string; languageName: string; account: Props["account"]; lengths: number[] }) {
  const device = usePrefs();
  const toast = useToast();
  const [length, setLength] = useState(account.sessionLength);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const themes: [Theme, string][] = [
    ["auto", t("learn.settings.themeAuto")],
    ["light", t("learn.settings.themeLight")],
    ["dark", t("learn.settings.themeDark")],
  ];

  return (
    <>
      <h2 id="settings-title">{t("learn.settings.title")}</h2>
      <div className="field">
        <span id="theme-label">{t("learn.settings.theme")}</span>
        <div className="seg" role="radiogroup" aria-labelledby="theme-label">
          {themes.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={device.theme === value}
              onClick={() => {
                prefs.set({ theme: value });
                sfx("toggle", 0.4);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span id="length-label">{t("learn.settings.length")}</span>
        <div className="seg num" role="radiogroup" aria-labelledby="length-label" style={{ "--n": lengths.length } as CSSProperties}>
          {lengths.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={length === value}
              aria-label={t("learn.start.minutes", { n: value })}
              disabled={pending}
              onClick={() => {
                if (value === length) return;
                setLength(value);
                sfx("toggle", 0.4);
                startTransition(async () => {
                  await changeSessionLength(value);
                  toast(t("learn.settings.lengthSaved", { n: value }));
                });
              }}
            >
              {t("learn.settings.lengthMinutes", { n: value })}
            </button>
          ))}
        </div>
      </div>
      {account.tester ? (
        <div className="field">
          <span id="travel-label">
            {t("learn.settings.travel")}
            <small>{t("learn.settings.travelHint")}</small>
          </span>
          <div className="seg num" role="group" aria-labelledby="travel-label" style={{ "--n": TRAVEL_DAYS.length } as CSSProperties}>
            {TRAVEL_DAYS.map((days) => (
              <button
                key={days}
                type="button"
                disabled={pending}
                aria-label={t("learn.settings.travelDays", { n: days })}
                onClick={() => {
                  sfx("toggle", 0.4);
                  startTransition(async () => {
                    await moveMyTime(language, days);
                    toast(t("learn.settings.travelDone", { n: days }));
                  });
                }}
              >
                {t("learn.settings.travelShort", { n: days })}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div>
        <label className="toggle-row">
          <span>
            {t("learn.settings.sound")}
            <small>{t("learn.settings.soundHint")}</small>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              checked={device.sound}
              onChange={(event) => {
                prefs.set({ sound: event.target.checked });
                sfx("toggle", 0.4);
              }}
            />
            <i />
          </span>
        </label>
        <label className="toggle-row">
          <span>
            {t("learn.settings.haptics")}
            <small>{t("learn.settings.hapticsHint")}</small>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              checked={device.haptics}
              onChange={(event) => {
                prefs.set({ haptics: event.target.checked });
                buzz(10);
              }}
            />
            <i />
          </span>
        </label>
      </div>
      <nav className="menu">
        {account.admin ? (
          <Link href="/admin">
            <Icon name="l-panel" />
            {t("learn.settings.panel")}
          </Link>
        ) : null}
        <Link href={`/learn/${language}/subscription`}>
          <Icon name="l-cal" />
          {t("learn.settings.subscription")}
        </Link>
        <Link href={`/learn/${language}/phone`}>
          <Icon name="l-swap" />
          {t("learn.settings.phone")}
        </Link>
        <Link href={`/learn/${language}/support`}>
          <Icon name="l-note" />
          {t("learn.settings.support")}
        </Link>
        <Link href="/terms">
          <Icon name="l-book" />
          {t("learn.settings.terms")}
        </Link>
        <Link href="/about">
          <Icon name="l-info" />
          <Mixed text={t("learn.settings.about")} />
        </Link>
        {account.tester ? (
          <button type="button" className="danger" aria-expanded={confirming} onClick={() => setConfirming((value) => !value)}>
            <Icon name="l-reset" />
            {t("learn.settings.reset")}
          </button>
        ) : null}
        <button type="button" disabled={pending} onClick={() => startTransition(() => signOutLearner())}>
          <Icon name="l-logout" />
          {t("learn.settings.logout")}
        </button>
        <Link className="danger" href={`/learn/${language}/delete`}>
          <Icon name="l-erase" />
          {t("learn.settings.delete")}
        </Link>
      </nav>
      {confirming ? (
        <div className="confirm" role="alert">
          <span>{t("learn.settings.resetConfirm", { language: languageName })}</span>
          <div className="row">
            <button type="button" className="secondary danger" disabled={pending} onClick={() => startTransition(() => resetMyProgress(language))}>
              {t("learn.settings.resetYes")}
            </button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>
              {t("learn.settings.resetNo")}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

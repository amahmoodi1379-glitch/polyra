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
import { cn } from "@/lib/utils";
import type { HomeData, PlanLine, SkillTile } from "@/server/learn/home";
import { changeSessionLength, resetMyProgress, signOutLearner } from "../../actions";

type Props = {
  data: HomeData;
  languageName: string;
  languages: { code: string; name: string; enrolled: boolean }[];
  account: { admin: boolean; tester: boolean; sessionLength: number };
  lengths: number[];
  freeze: { max: number; minutes: number };
};

type Scope = "mixed" | "quick" | "vocab" | "grammar" | "extra";
type Open = null | "level" | "streak" | "settings" | "lang" | SkillName;

const skillIcon: Record<SkillName, IconName> = { vocab: "i-vocab", grammar: "i-gram", listening: "i-listen", reading: "i-read" };
const playable = (tile: SkillTile) => !tile.lock && (tile.skill === "vocab" || tile.skill === "grammar");
const percent = (value: number) => ({ "--p": `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }) as CSSProperties;
const monogram = (code: string) => code.charAt(0).toUpperCase() + code.slice(1);
const lat = (text: string) => <span className="lat">{text}</span>;

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
      return t("learn.home.subscription", { n: plan.days });
    case "none":
      return t("learn.home.noAccess");
  }
}

function startLine(data: HomeData): string {
  const { start } = data;
  if (data.locked) return t("learn.home.subLocked");
  if (start.resume) return t("learn.home.subResume", { minutes: start.minutes });
  if (start.empty) return t("learn.home.subEmpty");
  const parts = [start.reviews > 0 ? t("learn.home.subReviews", { n: start.reviews }) : null, start.newItems > 0 ? t("learn.home.subNew", { n: start.newItems }) : null].filter(
    Boolean,
  );
  if (parts.length === 0) return t("learn.start.minutes", { n: start.minutes });
  return t("learn.home.sub", { minutes: start.minutes, parts: parts.join(t("learn.home.and")) });
}

function lockText(tile: SkillTile) {
  if (tile.lock?.kind === "words") return t("learn.home.lockWords", { n: tile.lock.left });
  return t("learn.home.lockLater");
}

export function Home({ data, languageName, languages, account, lengths, freeze }: Props) {
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

  const go = (scope: Scope) => router.push(session(scope));
  const show = (which: Open) => {
    sfx("press", 0.4);
    setOpen(which);
  };

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
        {plan ? <p className="plan num">{plan}</p> : null}

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
        </div>
        {data.locked ? null : idle && data.extra ? (
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
                  aria-label={item.lock ? t("learn.home.skillOff", { skill: name, why: lockText(item) }) : t("learn.home.skillSession", { skill: name, level: item.level })}
                  onClick={() => {
                    if (playable(item) && !data.locked) {
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

        {links.notebook + links.words + links.lessons > 0 ? (
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
        {tile ? <SkillDetails tile={tile} locked={data.locked} onPractice={(scope) => go(scope)} onClose={close} /> : null}
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

function SkillDetails({ tile, locked, onPractice, onClose }: { tile: SkillTile; locked: boolean; onPractice: (scope: Scope) => void; onClose: () => void }) {
  const name = t(`learn.skill.${tile.skill}`);
  const words = tile.skill === "vocab";
  return (
    <>
      <div className="ss-head">
        <Icon name={skillIcon[tile.skill]} />
        <h2 id="skill-title">{name}</h2>
        <span className="lv lat">{tile.level}</span>
      </div>
      {tile.lock ? (
        <p className="soon num">{tile.lock.kind === "words" ? t("learn.skillSheet.lockedWords", { need: tile.lock.need, left: tile.lock.left }) : t("learn.skillSheet.later")}</p>
      ) : (
        <dl className="ledger num">
          {tile.stations > 0 ? (
            <div>
              <dt>{t("learn.skillSheet.station")}</dt>
              <dd>{t("learn.skillSheet.stationValue", { n: Math.min(tile.station + 1, tile.stations), total: tile.stations })}</dd>
            </div>
          ) : null}
          <div>
            <dt>{words ? t("learn.skillSheet.introducedWords") : t("learn.skillSheet.introducedUnits")}</dt>
            <dd>{formatNumber(tile.introduced)}</dd>
          </div>
          <div>
            <dt>{words ? t("learn.skillSheet.stableWords") : t("learn.skillSheet.stableUnits")}</dt>
            <dd>{formatNumber(tile.stable)}</dd>
          </div>
          <div>
            <dt>{t("learn.skillSheet.due")}</dt>
            <dd>{formatNumber(tile.due)}</dd>
          </div>
        </dl>
      )}
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

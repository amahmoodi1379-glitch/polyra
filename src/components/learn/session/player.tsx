"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Icon } from "@/components/learn/icons";
import { enter, squish } from "@/components/learn/motion";
import { buzz, sfx } from "@/components/learn/sfx";
import { hush, needsVoice, useDeviceVoice } from "@/components/learn/speak";
import { useToast } from "@/components/learn/toast";
import type { Gloss, RawAnswer } from "@/engine/ex";
import { needsSound, onlySoundLeft, playCard, shownEx, wantsAlt, type Card, type PlayResult, type Scope, type SessionPlan } from "@/engine/session";
import { num } from "@/engine/settings";
import type { Lang } from "@/engine/text";
import { tehranDate } from "@/engine/time";
import { t } from "@/i18n";
import { reportError } from "@/lib/report-error";
import { cn } from "@/lib/utils";
import type { Bundle, EndSummary } from "@/server/learn/session";
import { ConfusionFace, LessonFace, PhonicsFace, TableFace, WordFace } from "./cards";
import { EndScreen } from "./end";
import { Exercise, type Retry } from "./exercise";
import { Feedback } from "./feedback";
import { ReportSheet } from "./report";
import { installState, keepSessionSound } from "@/components/learn/install";
import { flush, listenOutbox, send, useOffline, waiting } from "./outbox";
import { DialogueStage, ErrorfixStage, SpeakStage } from "./speaking";
import { TextReview, TextStage, TextWordsFace, type TextProgressNote } from "./text";
import type { Answers } from "./text-questions";

/**
 * A session on the learner's device (PRD §3.4, §15.4). The browser runs the same engine as the
 * server: it grades, shows feedback and moves to the next card at once, and every finished card goes
 * to the outbox. The server grades again and writes; when the two disagree, the server's copy wins.
 */

type Phase =
  | { k: "loading" }
  | { k: "cap"; learned: number; canMore: boolean }
  /** «پیش از جلسه متن» (PRD §10.11): the text is longer than the session. */
  | { k: "textAsk"; minutes: number }
  | { k: "state"; which: "nothingLeft" | "emptyNotebook" | "locked" | "gone" | "failed" | "needsAudio" | "phonicsNone" }
  | { k: "play" }
  | { k: "end" };

type Done = Extract<PlayResult, { done: true }>;

/** A random id; `crypto.randomUUID` exists only on secure pages. */
function uuid(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const stored = {
  get(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // This visit only.
    }
  },
};

/** Whether any sound of a phonics round, its lesson's or its questions', has no file and needs the phone's voice. */
function roundNeedsVoice(plan: SessionPlan, card: Card): boolean {
  const view = plan.phonics?.view;
  const lesson = [...(view?.words ?? []), ...(view?.samples ?? [])].map((sound) => sound.speak);
  const asked = plan.queue
    .filter((other) => other.block === card.block)
    .flatMap(({ ex }) => (ex ? [ex.listen, ex.after, ...(ex.q.sounds ?? []).map((sound) => sound.speak), ...(ex.a.kind === "choice" ? ex.a.options.map((option) => option.speak) : [])] : []));
  return [...lesson, ...asked].some(needsVoice);
}

const hasSound = (plan: SessionPlan, card: Card, alt: boolean) => {
  if (card.t === "intro") return true;
  const ex = shownEx(plan, card, alt);
  return !!ex?.listen;
};

export function Player({ language, languageName, scope: firstScope }: { language: Lang; languageName: string; scope: Scope }) {
  const router = useRouter();
  const toast = useToast();
  const offline = useOffline();
  const voice = useDeviceVoice(language);
  const [scope, setScope] = useState(firstScope);
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [summary, setSummary] = useState<EndSummary | null>(null);
  const [muted, setMuted] = useState(false);
  /** A phonics session whose round left for want of sound: its end says why instead of a score. */
  const [dropped, setDropped] = useState<"muted" | "noVoice" | null>(null);
  const [tipIds, setTipIds] = useState<string[]>([]);
  // Cards whose sound file did not arrive in time, with the seconds waited (PRD §10.12).
  const [waited, setWaited] = useState<Record<string, number>>({});
  // The answers of a text stage, for its review page (PRD §7.4).
  // «گزارش اشکال» on the feedback sheet: the id of the answer just sent, and whether its sheet is open (PRD §13.10).
  const [lastAnswer, setLastAnswer] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);
  const [given, setGiven] = useState<{ answers: Answers; timedOut: boolean } | null>(null);
  // The answer to «امروز {n} کلمه گرفتی» stays when «پیش از جلسه متن» asks next.
  const capAnswer = useRef<"more" | "none" | null>(null);
  // «یک جلسه بی‌صدا برایت ساختم» (PRD §10.12, T92): the next build is without sound; the one after has it again.
  const silentNext = useRef(false);
  // A drop is said once a session, whatever the number of cards it takes out.
  const dropSaid = useRef<string | null>(null);
  const seq = useRef(0);
  const elapsed = useRef(0);
  const shownAt = useRef(0);
  const tapped = useRef(new Set<number>());
  const voiceWarned = useRef(false);
  const screen = useRef<HTMLDivElement>(null);
  const live = useRef<string | null>(null);

  const lexicon = useMemo(() => new Map(bundle?.lexicon ?? []), [bundle]);

  const load = useCallback((next: Bundle) => {
    live.current = next.id;
    silentNext.current = false;
    setBundle(next);
    // The session's sound files are fetched ahead while the connection is there (PRD §15.6).
    keepSessionSound(next.plan);
    setPlan(next.plan);
    setDone(null);
    setSummary(null);
    seq.current = next.nextSeq;
    elapsed.current = Number(stored.get(`polyra.elapsed.${next.id}`) ?? 0) || 0;
    setMuted(stored.get(`polyra.mute.${next.id}`) === "1");
    setPhase(next.plan.queue.length > 0 ? { k: "play" } : { k: "end" });
  }, []);

  const start = useCallback(
    async (which: Scope, cap: "more" | "none" | null = null, text: "confirmed" | "later" | null = null, replace = false) => {
      // Answers from before go first, so the server builds on them.
      await Promise.race([flush(), new Promise((resolve) => window.setTimeout(resolve, 4000))]);
      try {
        const response = await fetch("/api/learn/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ language, scope: which, noAudio: silentNext.current, cap, text, replace }),
        });
        if (response.status === 401) {
          window.location.assign(`/login?next=${encodeURIComponent(`/learn/${language}/session?scope=${which}`)}`);
          return;
        }
        const data = await response.json();
        switch (data.kind) {
          case "session":
            load(data.bundle as Bundle);
            sfx("ready", 0.4);
            return;
          case "ask_word_cap":
            setPhase({ k: "cap", learned: data.learned, canMore: data.canMore });
            return;
          case "ask_text_session":
            setPhase({ k: "textAsk", minutes: data.minutes });
            return;
          case "nothing_left":
            setPhase({ k: "state", which: which === "phonics" ? "phonicsNone" : "nothingLeft" });
            return;
          case "needs_audio":
            setPhase({ k: "state", which: "needsAudio" });
            return;
          case "empty_notebook":
            setPhase({ k: "state", which: "emptyNotebook" });
            return;
          case "locked":
            setPhase({ k: "state", which: "locked" });
            return;
          case "not_enrolled":
            router.replace(`/start/${language}`);
            return;
        }
        setPhase({ k: "state", which: "failed" });
      } catch {
        setPhase({ k: "state", which: "failed" });
      }
    },
    [language, load, router],
  );

  useEffect(() => {
    // A tick later, so a remount in development asks the server once.
    const timer = window.setTimeout(() => void start(firstScope), 0);
    return () => window.clearTimeout(timer);
  }, [start, firstScope]);
  const restart = (which: Scope, cap: "more" | "none" | null = null, text: "confirmed" | "later" | null = null, replace = false) => {
    capAnswer.current = cap;
    setDropped(null);
    setPhase({ k: "loading" });
    void start(which, cap, text, replace);
  };

  // What the server says about the answers of this session.
  useEffect(
    () =>
      listenOutbox({
        onResult(sessionId, response) {
          if (sessionId !== live.current) return;
          if (response.kind === "ok") {
            if (response.end) setSummary(response.end);
          } else if (response.kind === "resync") {
            load(response.bundle);
          } else {
            setPhase({ k: "state", which: "gone" });
          }
        },
      }),
    [load],
  );

  const card = phase.k === "play" && plan ? (plan.queue[0] ?? null) : null;
  // The version without sound: the learner cannot listen now, or this phone has no voice for the language (PRD §10.12).
  const altFor = (target: Card) =>
    !!plan && !!bundle && wantsAlt(plan, target, { muted, noVoice: voice === false && needsVoice(target.ex?.listen), waitedSec: waited[target.id] ?? null }, bundle.settings);
  const alt = card ? altFor(card) : false;
  const ex = card && plan && card.t !== "intro" && card.t !== "lesson" && card.t !== "table" && card.t !== "confusion" ? shownEx(plan, card, alt) : null;

  // The sound tip under the first three cards with sound of the learner's first session (PRD §3.5).
  if (card && plan && bundle?.soundTip && !muted && tipIds.length < 3 && !tipIds.includes(card.id) && hasSound(plan, card, alt)) setTipIds([...tipIds, card.id]);
  const tip = !!card && tipIds.includes(card.id);

  useEffect(() => {
    if (!card) return;
    shownAt.current = performance.now();
    enter(screen.current);
    window.scrollTo({ top: 0 });
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // A sound file not ready `audio.wait_sec` after its card appeared: the version without sound comes instead (T63).
  const soundUrl = card?.alt && plan && !plan.noAudio && !muted ? (card.ex?.listen?.url ?? null) : null;
  useEffect(() => {
    if (!card || !soundUrl || !bundle) return;
    const id = card.id;
    const wait = num(bundle.settings, "audio.wait_sec");
    let settled = false;
    const audio = new Audio();
    const late = () => {
      if (settled) return;
      settled = true;
      setWaited((all) => ({ ...all, [id]: wait }));
    };
    const timer = window.setTimeout(late, wait * 1000);
    audio.preload = "auto";
    audio.addEventListener("canplaythrough", () => {
      settled = true;
      window.clearTimeout(timer);
    });
    audio.addEventListener("error", late);
    audio.src = soundUrl;
    return () => {
      settled = true;
      window.clearTimeout(timer);
      audio.removeAttribute("src");
    };
  }, [card?.id, soundUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (voice !== false || voiceWarned.current || !plan || plan.noAudio || scope === "phonics") return;
    if (!plan.queue.some((item) => needsVoice(item.ex?.listen))) return;
    voiceWarned.current = true;
    toast(t("learn.session.noVoice", { language: languageName }));
  }, [voice, plan, toast, languageName, scope]);

  // End of session: wait for the outbox, then ask the server if its summary has not come with the last answer.
  useEffect(() => {
    if (phase.k !== "end" || summary || !bundle) return;
    let stop = false;
    void (async () => {
      await flush();
      if (stop || waiting(bundle.id) > 0) return;
      try {
        const response = await fetch(`/api/learn/session/${bundle.id}`);
        const data = await response.json();
        if (!stop && data.kind === "end") setSummary(data.end as EndSummary);
      } catch {
        // The offline line stays; the outbox tries again.
      }
    })();
    return () => {
      stop = true;
    };
  }, [phase.k, summary, bundle, offline]);

  const advance = (result: Done) => {
    setDone(null);
    setGiven(null);
    setPlan(result.advanced.plan);
    if (result.advanced.finished) {
      hush();
      setPhase({ k: "end" });
    }
  };

  const submit = (raw: RawAnswer): Retry | null => {
    setReporting(false);
    if (!bundle || !plan || !card || done) return null;
    const latencyMs = Math.max(0, Math.round(performance.now() - shownAt.current));
    const elapsedSec = elapsed.current + latencyMs / 1000;
    const at = new Date();
    let result: PlayResult;
    try {
      result = playCard(
        plan,
        card.id,
        raw,
        { latencyMs, elapsedSec, alt },
        { ctx: { settings: bundle.settings, now: at, today: tehranDate(at), latency: plan.latency }, language, wordsWithLemma: (lemma) => lexicon.get(lemma) ?? [] },
      );
    } catch (error) {
      // The session on the server is untouched: «دوباره امتحان کن» picks it up from the last saved answer.
      void reportError(error);
      setPhase({ k: "state", which: "failed" });
      return null;
    }
    if (!result.done) return result.outcome;
    elapsed.current = elapsedSec;
    stored.set(`polyra.elapsed.${bundle.id}`, String(elapsedSec));
    const answerId = uuid();
    setLastAnswer(answerId);
    send({
      sessionId: bundle.id,
      answerId,
      seq: seq.current++,
      cardId: card.id,
      answer: raw as Record<string, unknown>,
      latencyMs,
      elapsedSec,
      at: at.toISOString(),
      shown: result.graded?.result ?? "seen",
      ...(alt ? { alt: true } : {}),
      // Whether this phone can be offered «نصب» at the end of the session (PRD §3.11 row 7).
      device: installState(),
    });
    // After each attempt of a text its review page comes; the first round without help shows nothing yet (PRD §7.4).
    if (result.text && result.text.stage !== "first" && "answers" in raw) {
      sfx("page", 0.4);
      setGiven({ answers: raw.answers as Answers, timedOut: !!raw.timedOut });
      setDone(result);
      return null;
    }
    if (!result.graded) {
      sfx("page", 0.4);
      advance(result);
      return null;
    }
    hush();
    const verdict = result.graded.result;
    if (verdict === "correct") {
      sfx("success", 0.55);
      buzz(12);
    } else if (verdict === "near") {
      sfx("success", 0.4);
      buzz(8);
    } else if (verdict === "wrong") {
      sfx("error", 0.5);
      buzz([18, 60, 18]);
    } else sfx("droplet", 0.45);
    setDone(result);
    return null;
  };

  const tap = (gloss: Gloss) => {
    // A touched word may come as a new word later (PRD §5.9); the server checks the conditions.
    if (gloss.kind !== "word" || !gloss.wordId || tapped.current.has(gloss.wordId) || plan?.words[gloss.wordId]) return;
    tapped.current.add(gloss.wordId);
    void fetch("/api/learn/tap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language, wordId: gloss.wordId }) }).catch(() => {});
  };

  // Whether this phone cannot say a card that needs sound: no file, and no voice for the language (PRD §10.12).
  const soundless = (target: Card): boolean => {
    if (voice !== false || !plan) return false;
    if (target.t === "phonics" || target.t === "phonicsq") return roundNeedsVoice(plan, target);
    if (target.t === "drill") return needsVoice(target.ex?.listen);
    if (target.prod?.kind === "speak") return needsVoice(target.prod.view.sentence.speak);
    const textId = target.text?.textId ?? (target.t === "textwords" ? Number(target.item.slice(2)) : null);
    const view = textId === null ? null : plan.texts[textId];
    return !!view && !view.audio && view.sentences.some((sentence) => needsVoice(sentence.speak));
  };

  // Cards that need sound (PRD §8.4, §10.12, T62): with sound off, or a sound this phone cannot say, a
  // sentence drill, a listening text (with its key words) or the rest of a phonics round leaves the
  // session at once, unscored and still due. In a session of the round alone, its end says why. When
  // «الان نمی‌توانم گوش بدهم» leaves nothing but such cards, a session without sound replaces this one
  // (T92); a listening session cannot go on without sound at all.
  useEffect(() => {
    if (!card || !plan || !bundle || done || !needsSound(plan, card)) return;
    const silent = muted || plan.noAudio;
    if (!silent && !soundless(card)) return;
    const phonics = card.t === "phonics" || card.t === "phonicsq";
    const timer = window.setTimeout(() => {
      if (scope === "phonics" && phonics) {
        setDropped(silent ? "muted" : "noVoice");
        submit({ skip: "drop" });
        return;
      }
      if (silent && scope === "listening") {
        hush();
        stored.set(`polyra.mute.${bundle.id}`, "0");
        setPhase({ k: "state", which: "needsAudio" });
        return;
      }
      if (muted && !plan.noAudio && onlySoundLeft(plan)) {
        hush();
        toast(t("learn.session.silentRebuilt"));
        silentNext.current = true;
        restart("mixed", null, null, true);
        return;
      }
      const said = `${bundle.id}:${phonics ? "p" : "l"}`;
      if (dropSaid.current !== said) {
        dropSaid.current = said;
        if (phonics) toast(silent ? t("learn.phonics.dropped") : t("learn.phonics.noVoice", { language: languageName }));
        else toast(silent ? t("learn.session.listenDropped") : t("learn.session.listenNoVoice", { language: languageName }));
      }
      hush();
      submit({ skip: "drop" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [card?.id, muted, voice, done]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where a text stage stands; a lost note costs nothing but the place (PRD §7.4).
  const textProgress = (note: TextProgressNote) => {
    if (!bundle || !card) return;
    void fetch("/api/learn/text-progress", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ sessionId: bundle.id, cardId: card.id, ...note }),
    }).catch(() => {});
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (bundle) stored.set(`polyra.mute.${bundle.id}`, next ? "1" : "0");
    hush();
    sfx("toggle", 0.4);
    toast(next ? t("learn.session.muteOn") : t("learn.session.muteOff"));
  };

  const home = () => {
    hush();
    router.push(`/learn/${language}`);
  };
  const again = () => {
    silentNext.current = false;
    setScope("mixed");
    restart("mixed");
  };

  const bar = (progress: number | null) => (
    <>
      <div className="sbar">
        <button type="button" className="icon-btn" aria-label={t("learn.session.close")} onClick={home}>
          <Icon name="l-x" />
        </button>
        {progress === null ? (
          <div className="track" aria-hidden="true" />
        ) : (
          <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span style={{ "--p": `${Math.round(progress * 100)}%` } as CSSProperties} />
          </div>
        )}
        {phase.k === "play" ? (
          <button type="button" className="icon-btn" aria-pressed={muted} aria-label={t("learn.session.mute")} onClick={toggleMute}>
            <Icon name="l-mute" />
          </button>
        ) : (
          <span className="icon-btn" aria-hidden="true" />
        )}
      </div>
      {offline ? (
        <p className="offline" role="status">
          <Icon name="l-offline" className="i s" />
          {t("learn.session.offline")}
        </p>
      ) : null}
    </>
  );

  if (phase.k === "loading") {
    return (
      <Frame>
        {bar(null)}
        <div className="loading" role="status" aria-live="polite">
          <span className="blob-fallback" aria-hidden="true" />
          <p>{t("learn.session.loading")}</p>
        </div>
      </Frame>
    );
  }

  if (phase.k === "cap") {
    return (
      <Frame>
        {bar(null)}
        <div className="calm">
          <span className="mark">
            <Icon name="i-vocab" />
          </span>
          <h1 className="num">{t("learn.cap.title", { n: phase.learned })}</h1>
          <p>{t("learn.cap.body")}</p>
        </div>
        <div className="cta">
          <button type="button" className="primary jelly-press" onPointerDown={(event) => squish(event.currentTarget)} onClick={() => restart(scope, "none")}>
            {t("learn.cap.none")}
          </button>
          {phase.canMore ? (
            <button type="button" className="ghost" onClick={() => restart(scope, "more")}>
              {t("learn.cap.more")}
            </button>
          ) : null}
        </div>
      </Frame>
    );
  }

  if (phase.k === "textAsk") {
    return (
      <Frame>
        {bar(null)}
        <div className="calm">
          <span className="mark">
            <Icon name="i-read" />
          </span>
          <h1>{t("learn.textAsk.title", { n: phase.minutes })}</h1>
          <p>{t("learn.textAsk.body")}</p>
        </div>
        <div className="cta">
          <button type="button" className="primary jelly-press" onPointerDown={(event) => squish(event.currentTarget)} onClick={() => restart(scope, capAnswer.current, "confirmed")}>
            {t("learn.textAsk.start")}
          </button>
          <button type="button" className="ghost" onClick={() => restart(scope, capAnswer.current, "later")}>
            {t("learn.textAsk.later")}
          </button>
        </div>
      </Frame>
    );
  }

  if (phase.k === "state") {
    const icon =
      phase.which === "locked" ? "l-lock" : phase.which === "failed" ? "l-offline" : phase.which === "emptyNotebook" ? "l-note" : phase.which === "needsAudio" ? "l-mute" : "l-check";
    return (
      <Frame>
        {bar(null)}
        <div className="calm">
          <span className="mark">
            <Icon name={icon} />
          </span>
          <h1>{t(`learn.states.${phase.which}.title`)}</h1>
          <p>{t(`learn.states.${phase.which}.body`)}</p>
        </div>
        <div className="cta">
          {phase.which === "failed" || phase.which === "gone" ? (
            <button type="button" className="primary jelly-press" onClick={() => restart(scope)}>
              {t("learn.states.retry")}
            </button>
          ) : null}
          {phase.which === "locked" ? (
            <Link className="primary" href={`/learn/${language}/plans`}>
              {t("learn.home.buy")}
            </Link>
          ) : null}
          <Link className={phase.which === "failed" || phase.which === "gone" || phase.which === "locked" ? "ghost" : "primary"} href={`/learn/${language}`}>
            {t("learn.states.home")}
          </Link>
        </div>
      </Frame>
    );
  }

  if (phase.k === "end" && dropped) {
    return (
      <Frame>
        {bar(null)}
        <div className="calm">
          <span className="mark">
            <Icon name="l-mute" />
          </span>
          <h1>{t("learn.phonics.droppedTitle")}</h1>
          <p>{dropped === "muted" ? t("learn.phonics.droppedMuted") : t("learn.phonics.droppedNoVoice", { language: languageName })}</p>
        </div>
        <div className="cta">
          {dropped === "muted" ? (
            <button type="button" className="primary jelly-press" onClick={() => restart("phonics")}>
              {t("learn.phonics.droppedAgain")}
            </button>
          ) : null}
          <Link className={dropped === "muted" ? "ghost" : "primary"} href={`/learn/${language}/phonics`}>
            {t("learn.phonicsPage.title")}
          </Link>
        </div>
      </Frame>
    );
  }

  if (phase.k === "end" || !plan || !bundle || !card) {
    const counters = plan?.counters ?? { correct: 0, wrong: 0 };
    return (
      <Frame>
        {bar(1)}
        <EndScreen
          summary={summary}
          local={{ correct: counters.correct, wrong: counters.wrong }}
          languageName={languageName}
          language={language}
          sessionId={bundle?.id ?? null}
          minutes={Math.max(1, Math.round((plan?.budgetSec ?? 0) / 60))}
          waiting={summary ? null : offline ? "offline" : "sending"}
          onAgain={again}
          onBack={home}
        />
      </Frame>
    );
  }

  const progress = plan.doneCount / Math.max(1, plan.doneCount + plan.queue.length);
  const verdict = done?.graded ?? null;
  let body: ReactNode;
  let cta: ReactNode = null;
  // «این را بلدم» beside the button on a new word's intro card and a new unit's lesson, while today's presses last (PRD §11.5).
  const iknowLeft = (card.t === "intro" || card.t === "lesson") && card.probationStep ? (plan.counters.iknowLeft ?? 0) : 0;
  const seen = (label: string) => (
    <div className="cta">
      <button
        type="button"
        className="primary jelly-press"
        onPointerDown={(event) => squish(event.currentTarget)}
        onClick={() => {
          sfx("release", 0.45);
          submit({ seen: true });
        }}
      >
        {label}
      </button>
      {iknowLeft > 0 ? (
        <button
          type="button"
          className="ghost"
          data-iknow
          title={iknowLeft === 1 ? t("learn.session.iknowLast") : t("learn.session.iknowLeft", { n: iknowLeft - 1 })}
          onClick={() => {
            sfx("release", 0.3);
            submit({ iknow: true });
          }}
        >
          {t("learn.session.iknow")}
        </button>
      ) : null}
    </div>
  );

  // A text draws its own screen: the stage with its questions, then its review page.
  if (card.t === "text" && card.text && plan.texts[card.text.textId]) {
    return (
      <Frame>
        {bar(progress)}
        {done?.text && given ? (
          <TextReview
            key={`r:${card.id}`}
            view={plan.texts[card.text.textId]}
            outcome={done.text}
            answers={given.answers}
            timedOut={given.timedOut}
            language={language}
            onTap={tap}
            onContinue={() => advance(done)}
          />
        ) : (
          <TextStage
            key={card.id}
            id={card.id}
            view={plan.texts[card.text.textId]}
            info={card.text}
            prefill={(card.text.resume?.answers ?? (card.text.stage === "help" ? plan.textStates[card.item]?.partial?.answers : null) ?? {}) as Answers}
            language={language}
            submit={submit}
            onTap={tap}
            onProgress={textProgress}
          />
        )}
      </Frame>
    );
  }

  // Speaking (PRD §8b): each screen runs its own steps and hands its answer over on its last «ادامه».
  if (card.prod) {
    const { prod } = card;
    const finish = (raw: RawAnswer) => void submit(raw);
    return (
      <Frame>
        {bar(progress)}
        {prod.kind === "speak" ? (
          <SpeakStage key={card.id} id={card.id} view={prod.view} languageName={languageName} muted={muted} onFinish={finish} />
        ) : prod.kind === "dialogue" ? (
          <DialogueStage key={card.id} id={card.id} view={prod.view} attempt={prod.attempt} sound={!muted && !plan.noAudio && voice !== false} onFinish={finish} />
        ) : (
          <ErrorfixStage key={card.id} id={card.id} view={prod.view} language={language} onFinish={finish} />
        )}
      </Frame>
    );
  }

  if (card.t === "textwords") {
    body = <TextWordsFace id={card.id} view={plan.texts[Number(card.item.slice(2))]} words={(card.words ?? []).map((id) => plan.words[id]).filter(Boolean)} />;
    cta = seen(t("learn.session.continue"));
  } else if (card.t === "intro") {
    const word = plan.words[Number(card.item.slice(2))];
    body = word ? (
      <>
        <WordFace id={card.id} card={word} muted={muted} autoplay animate />
        {tip ? (
          <p className="tip">
            <Icon name="l-spk1" />
            {t("learn.session.soundTip")}
          </p>
        ) : null}
      </>
    ) : null;
    cta = seen(t("learn.session.learned"));
  } else if (card.t === "lesson") {
    const lesson = plan.lessons[Number(card.item.slice(2))];
    body = lesson ? <LessonFace id={card.id} lesson={lesson} /> : null;
    cta = seen(t("learn.session.understood"));
  } else if (card.t === "table") {
    const table = plan.tables[Number(card.item.slice(2))];
    body = table ? <TableFace id={card.id} table={table} muted={muted} /> : null;
    cta = seen(t("learn.session.gotIt"));
  } else if (card.t === "phonics" && plan.phonics) {
    const round = plan.phonics;
    const { view } = round;
    const kicker =
      view.round === 1 ? t("learn.phonics.kicker", { index: view.index, total: view.total }) : t(view.repeat ? "learn.phonics.kickerRepeat" : "learn.phonics.kickerRound2", { index: view.index });
    body = <PhonicsFace id={card.id} view={view} kicker={kicker} note={t(view.round === 1 ? "learn.phonics.questions" : "learn.phonics.questionsAgain", { n: view.questions })} />;
    cta = (
      <div className="cta">
        <button
          type="button"
          className="primary jelly-press"
          onPointerDown={(event) => squish(event.currentTarget)}
          onClick={() => {
            sfx("release", 0.45);
            submit({ seen: true });
          }}
        >
          {t("learn.phonics.start")}
        </button>
        {round.auto ? (
          <button type="button" className="ghost" onClick={() => submit({ skip: "later" })}>
            {t("learn.phonics.later")}
          </button>
        ) : null}
      </div>
    );
  } else if (card.t === "confusion" && card.pair) {
    const pair = [plan.words[card.pair[0]], plan.words[card.pair[1]]];
    body = pair[0] && pair[1] ? <ConfusionFace id={card.id} words={[pair[0], pair[1]]} /> : null;
    cta = seen(t("learn.session.gotIt"));
  } else if (ex) {
    body = (
      <>
        {card.t === "pretest" && !verdict ? <p className="pretest-note">{t("learn.session.pretest")}</p> : null}
        <Exercise
          key={`${card.id}:${ex.id}`}
          id={card.id}
          ex={ex}
          language={language}
          languageName={languageName}
          verdict={verdict}
          submit={submit}
          muted={muted}
          tip={tip}
          onTap={tap}
          pretest={card.t === "pretest"}
        />
      </>
    );
  }
  if (!body) {
    // A card this device cannot draw is passed without a score.
    body = null;
    cta = seen(t("learn.session.continue"));
  }

  return (
    <Frame>
      {bar(progress)}
      <div className={cn("screen-body", verdict && "answered")} ref={screen} key={card.id} data-card={card.id}>
        {body}
      </div>
      {cta}
      {done && verdict && ex ? (
        <Feedback
          verdict={verdict}
          ex={ex}
          card={card}
          plan={plan}
          language={language}
          muted={muted}
          pretest={card.t === "pretest"}
          onContinue={() => advance(done)}
          onReport={card.t === "pretest" ? undefined : () => setReporting(true)}
        />
      ) : null}
      {done && verdict && ex ? <ReportSheet key={lastAnswer ?? ""} open={reporting} onClose={() => setReporting(false)} answerId={lastAnswer} ex={ex} result={verdict.result} /> : null}
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <main className="app">
      <div className="screen fill">{children}</div>
    </main>
  );
}

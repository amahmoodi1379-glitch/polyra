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
import { playCard, shownEx, type Card, type PlayResult, type Scope, type SessionPlan } from "@/engine/session";
import type { Lang } from "@/engine/text";
import { tehranDate } from "@/engine/time";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { Bundle, EndSummary } from "@/server/learn/session";
import { ConfusionFace, LessonFace, TableFace, WordFace } from "./cards";
import { EndScreen } from "./end";
import { Exercise, type Retry } from "./exercise";
import { Feedback } from "./feedback";
import { flush, listenOutbox, send, useOffline, waiting } from "./outbox";

/**
 * A session on the learner's device (PRD §3.4, §15.4). The browser runs the same engine as the
 * server: it grades, shows feedback and moves to the next card at once, and every finished card goes
 * to the outbox. The server grades again and writes; when the two disagree, the server's copy wins.
 */

type Phase =
  | { k: "loading" }
  | { k: "cap"; learned: number; canMore: boolean }
  | { k: "state"; which: "nothingLeft" | "emptyNotebook" | "locked" | "gone" | "failed" }
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
  const [tipIds, setTipIds] = useState<string[]>([]);
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
    setBundle(next);
    setPlan(next.plan);
    setDone(null);
    setSummary(null);
    seq.current = next.nextSeq;
    elapsed.current = Number(stored.get(`polyra.elapsed.${next.id}`) ?? 0) || 0;
    setMuted(stored.get(`polyra.mute.${next.id}`) === "1");
    setPhase(next.plan.queue.length > 0 ? { k: "play" } : { k: "end" });
  }, []);

  const start = useCallback(
    async (which: Scope, cap: "more" | "none" | null = null) => {
      // Answers from before go first, so the server builds on them.
      await Promise.race([flush(), new Promise((resolve) => window.setTimeout(resolve, 4000))]);
      try {
        const response = await fetch("/api/learn/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ language, scope: which, noAudio: false, cap }),
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
          case "nothing_left":
            setPhase({ k: "state", which: "nothingLeft" });
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
  const restart = (which: Scope, cap: "more" | "none" | null = null) => {
    setPhase({ k: "loading" });
    void start(which, cap);
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
  const altFor = (target: Card) => !!target.alt && !!plan && (plan.noAudio || muted || (voice === false && needsVoice(target.ex?.listen)));
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

  useEffect(() => {
    if (voice !== false || voiceWarned.current || !plan || plan.noAudio) return;
    if (!plan.queue.some((item) => needsVoice(item.ex?.listen))) return;
    voiceWarned.current = true;
    toast(t("learn.session.noVoice", { language: languageName }));
  }, [voice, plan, toast, languageName]);

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
    setPlan(result.advanced.plan);
    if (result.advanced.finished) {
      hush();
      setPhase({ k: "end" });
    }
  };

  const submit = (raw: RawAnswer): Retry | null => {
    if (!bundle || !plan || !card || done) return null;
    const latencyMs = Math.max(0, Math.round(performance.now() - shownAt.current));
    const elapsedSec = elapsed.current + latencyMs / 1000;
    const at = new Date();
    const result = playCard(
      plan,
      card.id,
      raw,
      { latencyMs, elapsedSec, alt },
      { ctx: { settings: bundle.settings, now: at, today: tehranDate(at), latency: plan.latency }, language, wordsWithLemma: (lemma) => lexicon.get(lemma) ?? [] },
    );
    if (!result.done) return result.outcome;
    elapsed.current = elapsedSec;
    stored.set(`polyra.elapsed.${bundle.id}`, String(elapsedSec));
    send({
      sessionId: bundle.id,
      answerId: uuid(),
      seq: seq.current++,
      cardId: card.id,
      answer: raw as Record<string, unknown>,
      latencyMs,
      elapsedSec,
      at: at.toISOString(),
      shown: result.graded?.result ?? "seen",
      ...(alt ? { alt: true } : {}),
    });
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
    setScope("mixed");
    restart("mixed");
  };

  const bar = (progress: number | null) => (
    <>
      <div className="sbar">
        <button type="button" className="icon-btn" aria-label={t("learn.session.close")} onClick={home}>
          <Icon name="l-x" />
        </button>
        {progress === null ? <div className="track" aria-hidden="true" /> : (
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

  if (phase.k === "state") {
    const icon = phase.which === "locked" ? "l-lock" : phase.which === "failed" ? "l-offline" : phase.which === "emptyNotebook" ? "l-note" : "l-check";
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
          <Link className={phase.which === "failed" || phase.which === "gone" ? "ghost" : "primary"} href={`/learn/${language}`}>
            {t("learn.states.home")}
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
    </div>
  );

  if (card.t === "intro") {
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
  } else if (card.t === "confusion" && card.pair) {
    const pair = [plan.words[card.pair[0]], plan.words[card.pair[1]]];
    body = pair[0] && pair[1] ? <ConfusionFace id={card.id} words={[pair[0], pair[1]]} /> : null;
    cta = seen(t("learn.session.gotIt"));
  } else if (ex) {
    body = (
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
      />
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
      <div className={cn("screen-body", verdict && "answered")} ref={screen} key={card.id}>
        {body}
      </div>
      {cta}
      {done && verdict && ex ? <Feedback verdict={verdict} ex={ex} card={card} plan={plan} language={language} muted={muted} onContinue={() => advance(done)} /> : null}
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

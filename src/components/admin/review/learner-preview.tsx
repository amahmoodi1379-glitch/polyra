"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { IconSprite } from "@/components/learn/icons";
import { squish } from "@/components/learn/motion";
import { sfx } from "@/components/learn/sfx";
import { hush } from "@/components/learn/speak";
import { Example, LessonFace, PhonicsFace, TableFace, WordFace } from "@/components/learn/session/cards";
import { Exercise, type Retry } from "@/components/learn/session/exercise";
import { Feedback } from "@/components/learn/session/feedback";
import { DialogueStage, ErrorfixStage } from "@/components/learn/session/speaking";
import { TextReview, TextStage, TextWordsFace } from "@/components/learn/session/text";
import type { Answers } from "@/components/learn/session/text-questions";
import { WritingEditor } from "@/components/learn/writing";
import { Button } from "@/components/ui/button";
import type { RawAnswer } from "@/engine/ex";
import { grade, type Graded } from "@/engine/grade";
import { dictSource, gradeQuestion, type GradedQuestion } from "@/engine/questions";
import { defaultLocale, locales, t, type MessageKey } from "@/i18n";
import type { Preview, Screen } from "@/server/content/review/preview";

type Ready = Extract<Preview, { state: "ready" }>;

function askOf(screen: Screen, languageName: string): string {
  if (screen.kind === "exercise") return t(`learn.ask.${screen.ex.code}` as MessageKey, { language: languageName });
  if (screen.kind === "text") {
    const { track, attempt, stage } = screen.info;
    return t("admin.review.screens.text", {
      track: track === "listening" ? t("learn.text.listening") : t("learn.text.reading"),
      attempt: stage === "help" ? t("learn.text.attemptHelp", { n: attempt }) : stage === "first" ? t("admin.review.screens.attemptFirst", { n: attempt }) : t("admin.review.screens.attempt", { n: attempt }),
    });
  }
  if (screen.kind === "dialogue") return t("admin.review.screens.dialogue", { n: screen.attempt });
  return t(`admin.review.screens.${screen.kind}`);
}

type TextDone = { answers: Answers; timedOut: boolean; graded: GradedQuestion[] };

/**
 * The item's learner screens, one at a time, in a phone-sized frame of the learner app (PRD §13.9
 * step 4): the card, then every exercise built from it. The teacher can answer each one; the engine
 * grades it in the browser exactly as in a session, and nothing is saved.
 */
export function LearnerPreview({ preview, languageName, itemKey }: { preview: Ready; languageName: string; itemKey: string }) {
  const [at, setAt] = useState(0);
  const [verdict, setVerdict] = useState<Graded | null>(null);
  const [textDone, setTextDone] = useState<TextDone | null>(null);
  const locale = locales[defaultLocale];
  const screens = preview.screens;
  const screen = screens[Math.min(at, screens.length - 1)];
  const id = `${itemKey}:${at}`;

  const go = (next: number) => {
    hush();
    setVerdict(null);
    setTextDone(null);
    setAt(Math.max(0, Math.min(screens.length - 1, next)));
  };

  // A text stage is graded as in a session (PRD §7.4) and its review page follows.
  const submitText = (raw: RawAnswer) => {
    if (screen.kind !== "text" || !("answers" in raw)) return;
    const questions = screen.view.questions[screen.info.set];
    const graded = questions.map((question) =>
      gradeQuestion(question, raw.answers[String(question.id)], {
        lang: preview.language,
        sentence: question.type === "dict" && screen.view.sentences[question.sentence] ? dictSource(screen.view.sentences[question.sentence]) : undefined,
        timedOut: raw.timedOut,
      }),
    );
    sfx("page", 0.4);
    setTextDone({ answers: raw.answers as Answers, timedOut: !!raw.timedOut, graded });
  };

  const submit = (raw: RawAnswer): Retry | null => {
    if (screen.kind !== "exercise" || verdict) return null;
    const outcome = grade(screen.ex, raw, { language: preview.language });
    if (outcome.result === "synonym" || outcome.result === "persian") return outcome;
    sfx(outcome.result === "wrong" ? "error" : outcome.result === "idk" ? "droplet" : "success", 0.45);
    setVerdict(outcome);
    return null;
  };

  const seen = (label: string) => (
    <div className="cta">
      <button type="button" className="primary jelly-press" onPointerDown={(event) => squish(event.currentTarget)} onClick={() => go(at + 1)} disabled={at === screens.length - 1}>
        {label}
      </button>
    </div>
  );

  let body: ReactNode;
  let cta: ReactNode = null;
  let whole: ReactNode = null;
  switch (screen.kind) {
    case "textwords":
      body = <TextWordsFace id={id} view={screen.view} words={screen.words.map((wordId) => preview.words[wordId]).filter(Boolean)} />;
      cta = seen(t("learn.session.continue"));
      break;
    case "text":
      whole = textDone ? (
        <TextReview
          key={`r:${id}`}
          view={screen.view}
          outcome={{ attempt: screen.info.attempt, questions: screen.view.questions[screen.info.set], graded: textDone.graded, state: null }}
          answers={textDone.answers}
          timedOut={textDone.timedOut}
          language={preview.language}
          preview
          onContinue={() => go(at + 1)}
        />
      ) : (
        <TextStage key={id} id={id} view={screen.view} info={screen.info} prefill={{}} language={preview.language} submit={submitText} />
      );
      break;
    case "word":
      body = <WordFace id={id} card={screen.card} muted={false} autoplay={false} animate />;
      cta = seen(t("learn.session.learned"));
      break;
    case "lesson":
      body = <LessonFace id={id} lesson={screen.lesson} />;
      cta = seen(t("learn.session.understood"));
      break;
    case "table":
      body = <TableFace id={id} table={screen.table} muted={false} />;
      cta = seen(t("learn.session.gotIt"));
      break;
    case "sentence":
      body = <Example id={id} sentence={screen.sentence} label={t("admin.review.screens.sentence")} />;
      cta = seen(t("learn.session.continue"));
      break;
    case "phonics": {
      const { view } = screen;
      body = (
        <PhonicsFace
          id={id}
          view={view}
          kicker={view.round === 1 ? t("learn.phonics.kicker", { index: view.index, total: view.total }) : t("learn.phonics.kickerRound2", { index: view.index })}
          note={t(view.round === 1 ? "learn.phonics.questions" : "learn.phonics.questionsAgain", { n: view.questions })}
        />
      );
      cta = seen(t("learn.phonics.start"));
      break;
    }
    case "dialogue":
      whole = <DialogueStage key={id} id={id} view={screen.view} attempt={screen.attempt} sound onFinish={() => go(at + 1)} />;
      break;
    case "errorfix":
      whole = <ErrorfixStage key={id} id={id} view={screen.view} language={preview.language} onFinish={() => go(at + 1)} />;
      break;
    case "writing":
      whole = <WritingEditor key={id} language={preview.language} task={screen.task} minToFinish={screen.minToFinish} trying={false} preview />;
      break;
    case "exercise":
      body = (
        <Exercise
          key={id}
          id={id}
          ex={screen.ex}
          language={preview.language}
          languageName={languageName}
          verdict={verdict}
          submit={submit}
          muted={false}
          tip={false}
        />
      );
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="lx phone" dir={locale.dir} lang={locale.lang} data-phone>
        <IconSprite />
        <div className="phone-scroll">
          <main className="app">
            <div className="screen fill">
              <div className="sbar">
                <span className="icon-btn" aria-hidden="true" />
                <div className="track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(((at + 1) / screens.length) * 100)}>
                  <span style={{ "--p": `${Math.round(((at + 1) / screens.length) * 100)}%` } as CSSProperties} />
                </div>
                <span className="icon-btn" aria-hidden="true" />
              </div>
              {whole ?? (
                <div className={verdict ? "screen-body answered" : "screen-body"} key={id} data-card={id}>
                  {body}
                </div>
              )}
              {cta}
              {verdict && screen.kind === "exercise" ? (
                <Feedback verdict={verdict} ex={screen.ex} card={{ id }} plan={preview} language={preview.language} muted={false} onContinue={() => go(at + 1)} />
              ) : null}
            </div>
          </main>
        </div>
      </div>

      <nav aria-label={t("admin.review.preview.nav")} className="flex w-full max-w-[420px] items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="icon" disabled={at === 0} onClick={() => go(at - 1)} aria-label={t("admin.review.preview.previous")}>
          <ChevronRight strokeWidth={2} className="ltr:rotate-180" aria-hidden />
        </Button>
        <p className="text-ink-2 min-w-0 flex-1 text-center text-[13.5px] leading-6" aria-live="polite">
          <span className="text-ink num font-extrabold">{t("admin.review.preview.position", { n: at + 1, total: screens.length })}</span>
          <span className="block truncate">{askOf(screen, languageName)}</span>
        </p>
        <Button type="button" variant="secondary" size="icon" disabled={at === screens.length - 1} onClick={() => go(at + 1)} aria-label={t("admin.review.preview.next")}>
          <ChevronLeft strokeWidth={2} className="ltr:rotate-180" aria-hidden />
        </Button>
      </nav>
    </div>
  );
}

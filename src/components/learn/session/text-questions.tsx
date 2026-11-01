"use client";

import { useState, type ReactNode } from "react";
import { Icon } from "@/components/learn/icons";
import { Mixed } from "@/components/learn/mixed";
import { squish } from "@/components/learn/motion";
import { sfx } from "@/components/learn/sfx";
import type { QuestionC } from "@/engine/content";
import { dictationOf, dictSource, type GradedQuestion, type QuestionAnswer } from "@/engine/questions";
import { seeded, shuffle } from "@/engine/random";
import type { TextView } from "@/engine/session";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * The questions of a text (PRD §7.3), all on one screen (DECISIONS.md): each kind's answer control,
 * and on the review page the learner's answer next to the right one with its explanation.
 */

export type Answers = Record<string, QuestionAnswer>;

/** Whether a question has a finished answer: every item ordered, every pair joined, every gap filled. */
export function complete(question: QuestionC, answer: QuestionAnswer | undefined): boolean {
  if (!answer) return false;
  if ("idk" in answer) return true;
  switch (question.type) {
    case "order":
      return "order" in answer && answer.order.length === question.items.length;
    case "match":
      return "pairs" in answer && answer.pairs.length === question.left.length;
    case "cloze":
      return "fills" in answer && answer.fills.length === question.answers.length && answer.fills.every((fill) => fill !== "");
    case "num":
    case "dict":
      return "text" in answer && answer.text.trim() !== "";
    default:
      return true;
  }
}

/** Band 1 and 2 ask in Persian; band 3 and 4 in the language itself (PRD §7.3). */
export const asksInPersian = (band: number) => band <= 2;

const Tick = () => (
  <span className="tick" aria-hidden="true">
    <svg viewBox="0 0 24 24">
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  </span>
);

/** A question's own words: Persian with Latin pieces, or a line of the language. */
function Words({ text, fa, language }: { text: string; fa: boolean; language: string }) {
  return fa ? (
    <Mixed text={text} />
  ) : (
    <span className="lat" lang={language} dir="ltr">
      {text}
    </span>
  );
}

const persianLetters = /\p{Script=Arabic}/u;

/**
 * The order options and items are shown in: mixed, the same every time for one question, so a
 * writer's habit (the right option first, items already in order) never gives the answer away.
 */
const shown = (question: QuestionC, count: number) => shuffle(seeded("text-q", question.id), [...Array(count).keys()]);

export type Typing = { touch: boolean; active: boolean; focus: () => void };

export type QuestionProps = {
  question: QuestionC;
  index: number;
  answer: QuestionAnswer | undefined;
  band: number;
  /** The Persian translation of a question in the language may open (attempt 1, PRD §7.3). */
  canTranslate: boolean;
  language: string;
  set: (answer: QuestionAnswer | undefined) => void;
  /** Plays one sentence of the text (Q-dict). */
  playSentence: (index: number) => void;
  typing: Typing;
  /** Q-find: the text is waiting for a touch; `start` puts it there. */
  find: { active: boolean; start: () => void; sentence: (index: number) => string };
};

export function QuestionBlock(props: QuestionProps) {
  const { question, index, band, canTranslate, language } = props;
  const [fa, setFa] = useState(false);
  const persian = asksInPersian(band);
  const prompt = question.prompt || (question.type === "dict" ? t("learn.text.dictPrompt") : question.type === "ctx" ? t("learn.text.ctxPrompt", { word: question.word }) : "");
  return (
    <li className="tx-q" id={`tq-${question.id}`}>
      <div className="tx-q-h">
        <span className="n num" aria-hidden="true">
          {formatNumber(index + 1)}
        </span>
        <p className="tx-prompt">{question.prompt ? <Words text={prompt} fa={persian} language={language} /> : prompt}</p>
      </div>
      {!persian && canTranslate && question.promptFa ? (
        fa ? (
          <p className="tx-prompt-fa">{question.promptFa}</p>
        ) : (
          <button type="button" className="tx-tr" onClick={() => setFa(true)}>
            {t("learn.text.promptFa")}
          </button>
        )
      ) : null}
      <AnswerControl {...props} persian={persian} />
    </li>
  );
}

function AnswerControl(props: QuestionProps & { persian: boolean }) {
  const { question, answer, set, language, persian } = props;
  const press = (event: { currentTarget: HTMLElement }) => squish(event.currentTarget);
  switch (question.type) {
    case "mcq":
    case "ctx": {
      const chosen = answer && "choice" in answer ? answer.choice : null;
      return (
        <div className="opts stack tx-opts" role="group">
          {shown(question, question.options.length).map((i) => (
            <button
              key={i}
              type="button"
              className={cn("opt jelly-press", persian ? "fa" : "lat", chosen === i && "sel")}
              lang={persian ? undefined : language}
              dir={persian ? undefined : "ltr"}
              aria-pressed={chosen === i}
              onPointerDown={press}
              onClick={() => {
                sfx("toggle", 0.3);
                set({ choice: i });
              }}
            >
              {persian ? <Mixed text={question.options[i]} /> : question.options[i]}
              <Tick />
            </button>
          ))}
        </div>
      );
    }
    case "tf": {
      const value = answer && "value" in answer ? answer.value : null;
      return (
        <div className="opts tx-opts" role="group">
          {[true, false].map((option) => (
            <button
              key={String(option)}
              type="button"
              className={cn("opt fa jelly-press", value === option && "sel")}
              aria-pressed={value === option}
              onPointerDown={press}
              onClick={() => {
                sfx("toggle", 0.3);
                set({ value: option });
              }}
            >
              {option ? t("learn.text.true") : t("learn.text.false")}
              <Tick />
            </button>
          ))}
        </div>
      );
    }
    case "order":
      return <OrderControl {...props} />;
    case "match":
      return <MatchControl {...props} />;
    case "cloze":
      return <ClozeControl {...props} />;
    case "find": {
      const chosen = answer && "sentence" in answer ? answer.sentence : null;
      return (
        <div className="tx-find">
          {chosen !== null ? (
            <p className="tx-found lat" lang={language} dir="ltr">
              {props.find.sentence(chosen)}
            </p>
          ) : null}
          <button type="button" className={cn("act", props.find.active && "on")} aria-pressed={props.find.active} onClick={props.find.start}>
            <Icon name="l-search" className="i s" />
            {props.find.active ? t("learn.text.findNow") : chosen === null ? t("learn.text.find") : t("learn.text.findOther")}
          </button>
        </div>
      );
    }
    case "num":
    case "dict": {
      const text = answer && "text" in answer ? answer.text : "";
      const Field = question.type === "dict" ? "textarea" : "input";
      const typing = props.typing;
      return (
        <div className="tx-typed">
          {question.type === "dict" ? (
            <button type="button" className="act" onClick={() => props.playSentence(question.sentence)}>
              <Icon name="l-spk1" className="i s" />
              {t("learn.text.playDict")}
            </button>
          ) : null}
          <Field
            id={`tf-${question.id}`}
            className={cn("answer-field tx-field lat", typing.active && "active")}
            lang={language}
            dir="ltr"
            rows={question.type === "dict" ? 2 : undefined}
            value={text}
            readOnly={typing.touch}
            inputMode={typing.touch ? "none" : "text"}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={t("learn.session.typeHere")}
            aria-label={question.type === "dict" ? t("learn.text.dictPrompt") : props.question.prompt}
            onFocus={typing.focus}
            onClick={typing.focus}
            onChange={(event) => set(event.target.value === "" ? undefined : { text: event.target.value })}
          />
          {question.type === "dict" && persianLetters.test(text) ? (
            <p className="msg" role="alert">
              {t("learn.session.persian")}
            </p>
          ) : null}
        </div>
      );
    }
  }
}

function OrderControl({ question, answer, set, language, persian }: QuestionProps & { persian: boolean }) {
  if (question.type !== "order") return null;
  const placed = answer && "order" in answer ? answer.order : [];
  const put = (next: number[]) => set(next.length === 0 ? undefined : { order: next });
  return (
    <div className="tx-order">
      <p className="tx-hint">{t("learn.text.orderHint")}</p>
      {placed.length > 0 ? (
        <ol className="tx-placed">
          {placed.map((item, position) => (
            <li key={item}>
              <button type="button" className="chip sel" aria-label={t("learn.text.takeBack", { n: formatNumber(position + 1) })} onClick={() => put(placed.filter((other) => other !== item))}>
                <span className="num">{formatNumber(position + 1)}</span>
                <Words text={question.items[item]} fa={persian} language={language} />
              </button>
            </li>
          ))}
        </ol>
      ) : null}
      <div className="tx-bank">
        {shown(question, question.items.length).map((item) =>
          placed.includes(item) ? null : (
            <button
              key={item}
              type="button"
              className="chip"
              onClick={() => {
                sfx("tick", 0.3);
                put([...placed, item]);
              }}
            >
              <Words text={question.items[item]} fa={persian} language={language} />
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function MatchControl({ question, answer, set, language, persian }: QuestionProps & { persian: boolean }) {
  if (question.type !== "match") return null;
  const pairs = answer && "pairs" in answer ? answer.pairs : [];
  const of = (left: number) => pairs.find(([item]) => item === left)?.[1] ?? null;
  const rights = shown(question, question.right.length);
  const join = (left: number, right: number) => {
    const rest = pairs.filter(([l, r]) => l !== left && r !== right);
    const next = of(left) === right ? rest : [...rest, [left, right] as [number, number]];
    next.sort((a, b) => a[0] - b[0]);
    sfx("tick", 0.3);
    set(next.length === 0 ? undefined : { pairs: next });
  };
  return (
    <div className="tx-match">
      <ol className="tx-right">
        {rights.map((j, k) => (
          <li key={j}>
            <span className="num">{formatNumber(k + 1)}</span>
            <Words text={question.right[j]} fa={persian} language={language} />
          </li>
        ))}
      </ol>
      {question.left.map((text, i) => (
        <div key={i} className="tx-match-row">
          <p>
            <Words text={text} fa={persian} language={language} />
          </p>
          <div className="tx-nums" role="group">
            {rights.map((j, k) => {
              const mine = of(i) === j;
              const taken = !mine && pairs.some(([, right]) => right === j);
              return (
                <button key={j} type="button" className={cn("num", mine && "sel", taken && "taken")} aria-pressed={mine} onClick={() => join(i, j)}>
                  {formatNumber(k + 1)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const gapSplit = /\{\{\s*(\d+)\s*\}\}/;

function ClozeControl({ question, answer, set, language }: QuestionProps) {
  const size = question.type === "cloze" ? question.answers.length : 0;
  const fills = answer && "fills" in answer ? answer.fills : Array<string>(size).fill("");
  const [active, setActive] = useState(Math.max(0, fills.indexOf("")));
  if (question.type !== "cloze") return null;
  const put = (next: string[]) => set(next.every((fill) => fill === "") ? undefined : { fills: next });
  const parts = question.textWithGaps.split(gapSplit);
  const fill = (word: string) => {
    const next = [...fills];
    next[active] = word;
    put(next);
    sfx("tick", 0.3);
    const after = next.findIndex((value, i) => value === "" && i > active);
    const first = next.indexOf("");
    setActive(after >= 0 ? after : first >= 0 ? first : active);
  };
  return (
    <div className="tx-cloze">
      <p className="tx-gaps lat" lang={language} dir="ltr">
        {parts.map((part, k) => {
          if (k % 2 === 0) return <span key={k}>{part}</span>;
          const gap = Number(part) - 1;
          const value = fills[gap] ?? "";
          return (
            <button
              key={k}
              type="button"
              className={cn("slot", value && "filled", active === gap && "pick")}
              aria-label={t("learn.session.blankN", { n: formatNumber(gap + 1) })}
              onClick={() => {
                setActive(gap);
                if (!value) return;
                const next = [...fills];
                next[gap] = "";
                put(next);
              }}
            >
              {value || formatNumber(gap + 1)}
            </button>
          );
        })}
      </p>
      <div className="tx-bank lat" lang={language} dir="ltr">
        {question.bank.map((word) => (
          <button key={word} type="button" className={cn("chip", fills.includes(word) && "used")} onClick={() => fill(word)}>
            {word}
          </button>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────────── the review page ─────────────────────────────

/** The answer a question wants, as the review page writes it. */
function rightOf(question: QuestionC, view: TextView, persian: boolean, language: string): ReactNode {
  const words = (text: string) => <Words text={text} fa={persian} language={language} />;
  switch (question.type) {
    case "mcq":
    case "ctx":
      return words(question.options[question.correct]);
    case "tf":
      return question.correct ? t("learn.text.true") : t("learn.text.false");
    case "order":
      return (
        <ol className="tx-list">
          {question.correctOrder.map((item) => (
            <li key={item}>{words(question.items[item])}</li>
          ))}
        </ol>
      );
    case "match":
      return (
        <ul className="tx-list">
          {question.pairs.map(([left, right]) => (
            <li key={left}>
              {words(question.left[left])}
              <span className="sep" aria-hidden="true">
                {" · "}
              </span>
              {words(question.right[right])}
            </li>
          ))}
        </ul>
      );
    case "cloze":
      return (
        <span className="lat" lang={language} dir="ltr">
          {question.answers.join(" · ")}
        </span>
      );
    case "find":
      return (
        <span className="lat" lang={language} dir="ltr">
          {view.sentences[question.correctSentence]?.text}
        </span>
      );
    case "num":
      return (
        <span className="lat" dir="ltr">
          {question.answer}
        </span>
      );
    case "dict":
      return (
        <span className="lat" lang={language} dir="ltr">
          {view.sentences[question.sentence]?.text}
        </span>
      );
  }
}

/** What the learner gave, as the review page writes it. */
function mineOf(question: QuestionC, answer: QuestionAnswer | undefined, graded: GradedQuestion, view: TextView, persian: boolean, language: string): ReactNode {
  if (!answer || "idk" in answer) return null;
  const words = (text: string | undefined) => (text === undefined ? null : <Words text={text} fa={persian} language={language} />);
  if ("choice" in answer && (question.type === "mcq" || question.type === "ctx")) return words(question.options[answer.choice]);
  if ("value" in answer) return answer.value ? t("learn.text.true") : t("learn.text.false");
  if ("order" in answer && question.type === "order")
    return (
      <ol className="tx-list">
        {answer.order.map((item) => (
          <li key={item}>{words(question.items[item])}</li>
        ))}
      </ol>
    );
  if ("pairs" in answer && question.type === "match")
    return (
      <ul className="tx-list">
        {answer.pairs.map(([left, right]) => (
          <li key={left}>
            {words(question.left[left])}
            <span className="sep" aria-hidden="true">
              {" · "}
            </span>
            {words(question.right[right])}
          </li>
        ))}
      </ul>
    );
  if ("fills" in answer)
    return (
      <span className="lat" lang={language} dir="ltr">
        {answer.fills.map((fill) => fill || "…").join(" · ")}
      </span>
    );
  if ("sentence" in answer)
    return (
      <span className="lat" lang={language} dir="ltr">
        {view.sentences[answer.sentence]?.text}
      </span>
    );
  if ("text" in answer && question.type === "dict" && graded.marks) {
    const sentence = view.sentences[question.sentence];
    if (!sentence) return null;
    const marks = graded.marks;
    return (
      <span className="dictation lat" lang={language} dir="ltr" aria-label={t("learn.session.dictationMarks")}>
        {dictationOf(dictSource(sentence)).map((word, i) => (
          <span key={i} className={cn(marks[i] === true && "ok", marks[i] === false && "bad")}>
            {word.text}
          </span>
        ))}
      </span>
    );
  }
  if ("text" in answer)
    return (
      <span className="lat" lang={language} dir="ltr">
        {answer.text}
      </span>
    );
  return null;
}

export function ReviewQuestion({
  question,
  answer,
  graded,
  view,
  language,
  timedOut,
}: {
  question: QuestionC;
  answer: QuestionAnswer | undefined;
  graded: GradedQuestion;
  view: TextView;
  language: string;
  timedOut: boolean;
}) {
  const persian = asksInPersian(view.band);
  const ok = graded.result === "correct";
  const mine = mineOf(question, answer, graded, view, persian, language);
  const prompt = question.prompt || (question.type === "dict" ? t("learn.text.dictPrompt") : question.type === "ctx" ? t("learn.text.ctxPrompt", { word: question.word }) : "");
  return (
    <li className={cn("tx-r", ok ? "ok" : "bad")}>
      <div className="tx-q-h">
        <span className="n num" aria-label={ok ? t("learn.text.right") : t("learn.text.wrong")}>
          <Icon name={ok ? "l-check" : "l-x"} className="i s" />
        </span>
        <p className="tx-prompt">{question.prompt ? <Words text={prompt} fa={persian} language={language} /> : prompt}</p>
      </div>
      {!persian && question.promptFa ? <p className="tx-prompt-fa">{question.promptFa}</p> : null}
      <dl className="tx-ans">
        {!ok ? (
          <>
            <dt>{t("learn.text.yours")}</dt>
            <dd>{mine ?? (graded.result === "idk" ? t("learn.session.idk") : timedOut ? t("learn.text.noTime") : t("learn.text.noAnswer"))}</dd>
          </>
        ) : null}
        <dt>{ok ? t("learn.text.yoursRight") : t("learn.text.rightOne")}</dt>
        <dd>{ok && mine ? mine : rightOf(question, view, persian, language)}</dd>
      </dl>
      {question.explanationFa ? (
        <p className="tx-why">
          <Mixed text={question.explanationFa} />
        </p>
      ) : null}
    </li>
  );
}

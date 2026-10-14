"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/learn/icons";
import { pop, shake, squish } from "@/components/learn/motion";
import { buzz, sfx } from "@/components/learn/sfx";
import { say } from "@/components/learn/speak";
import type { Speak } from "@/engine/content";
import type { AnswerSpec, Choice, Ex, Gloss, RawAnswer } from "@/engine/ex";
import type { Graded } from "@/engine/grade";
import { cleanAnswer, matchAny, type Lang } from "@/engine/text";
import { t, tRich, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { Headword, PlayButton } from "./cards";
import { Keyboard, SpecialRow, useTouchKeyboard } from "./keyboard";
import { SentenceLine, type Fill } from "./sentence";

/**
 * One exercise (PRD §3.5, §5.6, §6.5): the question from `ex.q`, the answer from `ex.a`. The parent
 * grades with the engine; a synonym or Persian letters come back here as a message and the learner
 * tries again. After grading the exercise stays on screen, marked, under the feedback sheet.
 */

export type Retry = { result: "synonym"; first: string } | { result: "persian" };

export type ExerciseProps = {
  /** The card id: a new card resets everything. */
  id: string;
  ex: Ex;
  language: Lang;
  languageName: string;
  verdict: Graded | null;
  submit: (raw: RawAnswer) => Retry | null;
  muted: boolean;
  tip: boolean;
  onTap?: (gloss: Gloss) => void;
};

const iconOf = (ex: Ex): IconName => (ex.item.startsWith("w:") ? "i-vocab" : "i-gram");
const lat = (text: string, language: string) => (
  <span className="lat" lang={language} dir="ltr">
    {text}
  </span>
);

const good = (verdict: Graded | null) => verdict?.result === "correct" || verdict?.result === "near";

function Ask({ ex, languageName }: { ex: Ex; languageName: string }) {
  return (
    <div className="ask">
      <Icon name={iconOf(ex)} />
      {t(`learn.ask.${ex.code}` as MessageKey, { language: languageName })}
    </div>
  );
}

/** What the question shows above the answers, from whatever `ex.q` carries. */
function Prompt({
  id,
  ex,
  language,
  muted,
  tip,
  fills,
  onTap,
  onBlank,
}: Pick<ExerciseProps, "id" | "ex" | "language" | "muted" | "tip" | "onTap"> & { fills?: Fill[]; onBlank?: (i: number) => void }) {
  const { q } = ex;
  const translation = q.sentence?.translation ?? q.translation ?? null;
  return (
    <>
      {ex.listen ? (
        <div className="listen">
          <PlayButton id={`${id}:listen`} speak={ex.listen} big autoplay={!muted} label={t("learn.session.play")} />
          <SlowButton id={`${id}:listen`} speak={ex.listen} />
          {tip ? (
            <p className="tip">
              <Icon name="l-spk1" />
              {t("learn.session.soundTip")}
            </p>
          ) : null}
        </div>
      ) : null}
      {q.image && !q.word ? <img className="word-img" src={q.image} alt="" /> : null}
      {q.word && ex.a.kind === "choice" && ex.code !== "W2c" ? <Headword word={q.word} /> : null}
      {q.word && ex.code === "W2c" ? <p className="prompt-lat">{lat(q.word.display, language)}</p> : null}
      {q.lemma ? (
        <p className="prompt-lat" lang={language} dir="ltr">
          {q.lemma}
        </p>
      ) : null}
      {q.meaning ? <p className={q.lemma ? "prompt-sub" : "prompt-fa"}>{q.meaning}</p> : null}
      {q.standard ? <p className="prompt-sub">{tRich("learn.session.standard", { word: lat(q.standard, language) })}</p> : null}
      {q.verb ? (
        <div className="verb-head" dir="ltr">
          {lat(q.verb, language)}
          {q.tense ? (
            <span className="tense" lang={language}>
              {q.tense}
            </span>
          ) : null}
        </div>
      ) : null}
      {q.pronoun ? (
        <p className="pronoun" lang={language} dir="ltr">
          {q.pronoun}
        </p>
      ) : null}
      {q.instruction ? <p className="prompt-fa md">{t("learn.session.change", { instruction: q.instruction })}</p> : null}
      {q.source ? (
        <p className="ex-sentence sm lat" lang={language} dir="ltr">
          {q.source}
        </p>
      ) : null}
      {q.promptFa ? <p className="prompt-fa md">{q.promptFa}</p> : null}
      {q.sentence ? <SentenceLine view={q.sentence} fills={fills} language={language} small={q.sentence.text.length > 48} onTap={onTap} onBlank={onBlank} /> : null}
      {translation ? <p className="tr">{translation}</p> : null}
      {q.hint ? <p className="prompt-sub">{t("learn.session.hint", { hint: q.hint })}</p> : null}
    </>
  );
}

function SlowButton({ id, speak }: { id: string; speak: Speak }) {
  return (
    <button type="button" className="act slow" onClick={() => say(id, speak, true)}>
      <Icon name="l-tempo" className="i s" />
      {t("learn.session.slow")}
    </button>
  );
}

function Idk({ ex, verdict, submit }: Pick<ExerciseProps, "ex" | "verdict" | "submit">) {
  if (!ex.idk || verdict) return null;
  return (
    <button type="button" className="ghost idk" onClick={() => submit({ idk: true })}>
      {t("learn.session.idk")}
    </button>
  );
}

function Check({ disabled, onClick, children }: { disabled: boolean; onClick: () => void; children?: ReactNode }) {
  return (
    <button
      type="button"
      className="primary jelly-press"
      disabled={disabled}
      onPointerDown={(event) => !disabled && squish(event.currentTarget)}
      onClick={() => {
        sfx("release", 0.45);
        onClick();
      }}
    >
      {children ?? t("learn.session.check")}
    </button>
  );
}

const optionsStack = (options: Choice[]) => options.some((option) => option.text.length > (option.lang === "fa" ? 22 : 14)) || options.length > 4;

function Options({
  options,
  language,
  chosen,
  correct,
  answered,
  onPick,
  label,
}: {
  options: Choice[];
  language: string;
  chosen: string | null;
  correct: string;
  answered: boolean;
  onPick: (id: string, el: HTMLElement) => void;
  label?: string;
}) {
  return (
    <div className={cn("opts", optionsStack(options) && "stack")} role="group" aria-label={label}>
      {options.map((option) => {
        const state = !answered ? (option.id === chosen ? "sel" : undefined) : option.id === correct ? "is-correct" : option.id === chosen ? "is-wrong" : "is-dim";
        return (
          <button
            key={option.id}
            type="button"
            className={cn("opt jelly-press", option.lang === "fa" ? "fa" : "lat", state)}
            lang={option.lang === "fa" ? undefined : language}
            dir={option.lang === "fa" ? undefined : "ltr"}
            disabled={answered}
            aria-pressed={option.id === chosen}
            onPointerDown={(event) => !answered && squish(event.currentTarget)}
            onClick={(event) => onPick(option.id, event.currentTarget)}
          >
            {option.image ? <img src={option.image} alt={option.text} /> : option.text}
            <span className="tick" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M5 12.5l4.5 4.5L19 7" />
              </svg>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ───────────────────────────── one choice ─────────────────────────────

function ChoiceEx(props: ExerciseProps & { spec: Extract<AnswerSpec, { kind: "choice" }> }) {
  const { ex, spec, verdict, submit, language } = props;
  const [chosen, setChosen] = useState<string | null>(null);
  const wrongEl = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (verdict && !good(verdict) && wrongEl.current) shake(wrongEl.current);
  }, [verdict]);
  const blank = ex.q.sentence?.segments.some((segment) => segment.t === "blank");
  const pickText = (id: string | null) => spec.options.find((option) => option.id === id)?.text ?? "";
  // After the answer the blank shows what was picked: right in teal, wrong struck through; after «نمی‌دانم», the answer.
  const fills: Fill[] = !blank || !verdict ? [] : chosen && !good(verdict) ? [{ text: pickText(chosen), state: "bad" }] : [{ text: pickText(spec.correct), state: "ok" }];
  return (
    <>
      <Ask ex={ex} languageName={props.languageName} />
      <Prompt {...props} fills={fills} />
      <div className="ex-grow" />
      <div className="answers">
        <Options
          options={spec.options}
          language={language}
          chosen={chosen}
          correct={spec.correct}
          answered={!!verdict}
          onPick={(id, el) => {
            if (verdict) return;
            setChosen(id);
            wrongEl.current = el;
            submit({ choice: id });
          }}
        />
        <Idk {...props} />
      </div>
    </>
  );
}

// ───────────────────────────── two blanks (G3b) ─────────────────────────────

function Choice2Ex(props: ExerciseProps & { spec: Extract<AnswerSpec, { kind: "choice2" }> }) {
  const { ex, spec, verdict, submit, language } = props;
  const [chosen, setChosen] = useState<[string | null, string | null]>([null, null]);
  const text = (group: number, id: string | null) => spec.groups[group].find((option) => option.id === id)?.text ?? "";
  const fills: Fill[] = [0, 1].map((group) => {
    const id = chosen[group];
    if (!verdict) return id ? { text: text(group, id), state: "pick" as const } : null;
    const right = id === spec.correct[group];
    return { text: right ? text(group, id) : text(group, spec.correct[group]), state: right ? ("ok" as const) : ("bad" as const) };
  });
  return (
    <>
      <Ask ex={ex} languageName={props.languageName} />
      <Prompt {...props} fills={fills} />
      <div className="ex-grow" />
      <div className="answers">
        {spec.groups.map((group, index) => (
          <div key={index} className="field">
            <p className="group-label">{t("learn.session.blankN", { n: index + 1 })}</p>
            <Options
              options={group}
              language={language}
              chosen={chosen[index]}
              correct={spec.correct[index]}
              answered={!!verdict}
              label={t("learn.session.blankN", { n: index + 1 })}
              onPick={(id) => {
                sfx("toggle", 0.35);
                setChosen((before) => (index === 0 ? [id, before[1]] : [before[0], id]));
              }}
            />
          </div>
        ))}
        {verdict ? null : <Check disabled={!chosen[0] || !chosen[1]} onClick={() => submit({ choices: [chosen[0]!, chosen[1]!] })} />}
        <Idk {...props} />
      </div>
    </>
  );
}

// ───────────────────────────── spot the wrong part (G2a) ─────────────────────────────

function SpotEx(props: ExerciseProps & { spec: Extract<AnswerSpec, { kind: "spot" }> }) {
  const { ex, spec, verdict, submit, language } = props;
  const [chosen, setChosen] = useState<string | null>(null);
  return (
    <>
      <Ask ex={ex} languageName={props.languageName} />
      <Prompt {...props} />
      <p className="spot lat" lang={language} dir="ltr">
        {spec.parts.map((part) =>
          /^\s+$/.test(part.text) ? (
            <span key={part.id}>{part.text}</span>
          ) : (
            <button
              key={part.id}
              type="button"
              disabled={!!verdict}
              className={cn(verdict && part.id === spec.correct && "ok", verdict && part.id === chosen && part.id !== spec.correct && "bad")}
              onClick={(event) => {
                if (verdict) return;
                setChosen(part.id);
                if (part.id !== spec.correct) shake(event.currentTarget);
                submit({ choice: part.id });
              }}
            >
              {part.text}
            </button>
          ),
        )}
      </p>
      <div className="ex-grow" />
      <div className="answers">
        <Idk {...props} />
      </div>
    </>
  );
}

// ───────────────────────────── typed answers ─────────────────────────────

/** Typing with the app's keyboard on a phone, or the computer's own keyboard with the special letters. */
function useTyping(language: string, disabled: boolean) {
  const touch = useTouchKeyboard();
  const [value, setValue] = useState("");
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const insert = (text: string) => {
    const el = field.current;
    if (touch || !el || el.selectionStart === null) {
      setValue((before) => before + text);
      return;
    }
    const start = el.selectionStart;
    const end = el.selectionEnd ?? start;
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  };
  const erase = () => setValue((before) => [...before].slice(0, -1).join(""));
  const keyboard = touch ? <Keyboard language={language} onKey={insert} onErase={erase} disabled={disabled} /> : <SpecialRow language={language} onKey={insert} />;
  return { touch, value, setValue, field, insert, erase, keyboard };
}

function TypeEx(props: ExerciseProps & { spec: Extract<AnswerSpec, { kind: "type" }> }) {
  const { ex, spec, verdict, submit, language } = props;
  const typing = useTyping(language, !!verdict);
  const { value, setValue, field, touch } = typing;
  const [gender, setGender] = useState<string | null>(null);
  const [retry, setRetry] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const blank = ex.q.sentence?.segments.some((segment) => segment.t === "blank");
  useEffect(() => {
    if (!touch) field.current?.focus({ preventScroll: true });
  }, [touch, field]);
  useEffect(() => {
    if (verdict && !good(verdict)) shake(field.current);
  }, [verdict, field]);

  const ready = value.trim().length > 0 && (!spec.gender || gender !== null);
  const check = () => {
    if (!ready || verdict) return;
    const outcome = submit({ text: value, gender, ...(retry ? { retry: true } : {}) });
    if (!outcome) return;
    sfx("droplet", 0.4);
    shake(field.current);
    if (outcome.result === "synonym") {
      setRetry(true);
      setMessage(t("learn.session.synonym", { first: `\u2066${outcome.first}\u2069` }));
      setValue("");
    } else setMessage(t("learn.session.persian"));
  };
  const fills: Fill[] = blank ? [value ? { text: value, state: verdict ? (good(verdict) ? "ok" : "bad") : "pick" } : null] : [];
  const Field = spec.sentence ? "textarea" : "input";

  return (
    <>
      <Ask ex={ex} languageName={props.languageName} />
      <Prompt {...props} fills={fills} />
      <div className="ex-grow" />
      <div className={cn("cta", touch && "with-kb")}>
        <Field
          ref={field}
          className={cn("answer-field lat", verdict && (good(verdict) ? "ok" : "bad"))}
          lang={language}
          dir="ltr"
          rows={spec.sentence ? 2 : undefined}
          value={value}
          readOnly={!!verdict}
          inputMode={touch ? "none" : "text"}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="done"
          aria-label={t(`learn.ask.${ex.code}` as MessageKey, { language: props.languageName })}
          placeholder={t("learn.session.typeHere")}
          onChange={(event) => {
            setValue(event.target.value);
            setMessage(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              check();
            }
          }}
        />
        {message ? (
          <p className="msg" role="alert">
            {message}
          </p>
        ) : null}
        {spec.gender ? (
          <div className="genders" role="group" aria-label={t("learn.session.genderLabel")}>
            {spec.gender.buttons.map((button) => (
              <button
                key={button}
                type="button"
                className="lat"
                lang={language}
                aria-pressed={gender === button}
                disabled={!!verdict}
                onClick={() => {
                  setGender(button);
                  sfx("toggle", 0.35);
                }}
              >
                {button}
              </button>
            ))}
          </div>
        ) : null}
        {verdict ? null : (
          <div className="row">
            {ex.idk ? (
              <button type="button" className="ghost" onClick={() => submit({ idk: true })}>
                {t("learn.session.idk")}
              </button>
            ) : null}
            <Check disabled={!ready} onClick={check} />
          </div>
        )}
        {verdict ? null : typing.keyboard}
      </div>
    </>
  );
}

// ───────────────────────────── hidden letters (W4b) ─────────────────────────────

function LettersEx(props: ExerciseProps & { spec: Extract<AnswerSpec, { kind: "letters" }> }) {
  const { ex, spec, verdict, submit, language } = props;
  const touch = useTouchKeyboard();
  const [letters, setLetters] = useState<string[]>([]);
  const full = letters.length === spec.hidden.length;
  const put = (text: string) => setLetters((before) => (before.length < spec.hidden.length && text.trim() ? [...before, text] : before));
  const erase = () => setLetters((before) => before.slice(0, -1));
  const check = () => full && !verdict && submit({ letters });
  useEffect(() => {
    if (touch || verdict) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === "Backspace") erase();
      else if (event.key === "Enter") check();
      else if (event.key.length === 1 && /\p{L}/u.test(event.key)) put(event.key);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const word = [...spec.word];
  return (
    <>
      <Ask ex={ex} languageName={props.languageName} />
      <Prompt {...props} />
      <p className="letters" lang={language} aria-live="polite">
        {word.map((char, index) => {
          const slot = spec.hidden.indexOf(index);
          if (slot < 0) return <span key={index}>{char}</span>;
          const given = letters[slot];
          const right = verdict ? cleanAnswer(given ?? "", false).toLowerCase() === char.toLowerCase() : null;
          return (
            <span key={index} className={cn("hole", slot === letters.length && !verdict && "on", right === true && "ok", right === false && "bad")}>
              {verdict && right === false ? char : (given ?? "")}
            </span>
          );
        })}
      </p>
      <div className="ex-grow" />
      <div className={cn("cta", touch && "with-kb")}>
        {verdict ? null : (
          <div className="row">
            {ex.idk ? (
              <button type="button" className="ghost" onClick={() => submit({ idk: true })}>
                {t("learn.session.idk")}
              </button>
            ) : null}
            <Check disabled={!full} onClick={check} />
          </div>
        )}
        {verdict ? null : touch ? <Keyboard language={language} onKey={put} onErase={erase} /> : <SpecialRow language={language} onKey={put} />}
      </div>
    </>
  );
}

// ───────────────────────────── tiles (W4a, G4a, G4b) ─────────────────────────────

function TilesEx(props: ExerciseProps & { spec: Extract<AnswerSpec, { kind: "tiles" }> }) {
  const { ex, spec, verdict, submit, language } = props;
  const [line, setLine] = useState<number[]>([]);
  const letters = ex.code === "W4a";
  const built = line.map((index) => spec.tiles[index]);
  return (
    <>
      <Ask ex={ex} languageName={props.languageName} />
      <Prompt {...props} />
      <div className={cn("line lat", letters && "letters-line")} lang={language} aria-live="polite">
        {line.map((index) => (
          <button
            key={index}
            type="button"
            className={cn("tile", verdict && (good(verdict) ? "ok" : "bad"))}
            disabled={!!verdict}
            onClick={() => {
              sfx("tick", 0.35);
              setLine((before) => before.filter((other) => other !== index));
            }}
          >
            {spec.tiles[index]}
          </button>
        ))}
      </div>
      <div className="ex-grow" />
      <div className="answers">
        <div className="bank lat" lang={language}>
          {spec.tiles.map((tile, index) =>
            line.includes(index) ? (
              <span key={index} className="tile ghost-tile" aria-hidden="true">
                {tile}
              </span>
            ) : (
              <button
                key={index}
                type="button"
                className="tile"
                disabled={!!verdict}
                onPointerDown={(event) => squish(event.currentTarget)}
                onClick={() => {
                  sfx("press", 0.35);
                  buzz(4);
                  setLine((before) => [...before, index]);
                }}
              >
                {tile}
              </button>
            ),
          )}
        </div>
        {verdict ? null : <Check disabled={line.length === 0} onClick={() => submit({ tiles: built })} />}
        <Idk {...props} />
      </div>
    </>
  );
}

// ───────────────────────────── pairs (W3d) ─────────────────────────────

function PairsEx(props: ExerciseProps & { spec: Extract<AnswerSpec, { kind: "pairs" }> }) {
  const { ex, spec, verdict, submit, language } = props;
  const [left, setLeft] = useState<string | null>(null);
  const [right, setRight] = useState<string | null>(null);
  const [done, setDone] = useState<string[]>([]);
  const [miss, setMiss] = useState<string[]>([]);
  const first = useRef<string | null>(null);
  const els = useRef(new Map<string, HTMLElement>());

  const attempt = (l: string, r: string) => {
    if (l === spec.target && first.current === null) first.current = r;
    if (spec.pairs[l] === r) {
      const next = [...done, l, r];
      setDone(next);
      sfx("tick", 0.45);
      buzz(6);
      pop(els.current.get(l));
      pop(els.current.get(r));
      if (next.length === spec.left.length * 2) window.setTimeout(() => submit({ firstPair: first.current ?? r }), 260);
    } else {
      setMiss([l, r]);
      sfx("droplet", 0.35);
      shake(els.current.get(l));
      shake(els.current.get(r));
      window.setTimeout(() => setMiss([]), 520);
    }
    setLeft(null);
    setRight(null);
  };
  const button = (choice: Choice, side: "left" | "right") => {
    const selected = side === "left" ? left === choice.id : right === choice.id;
    const finished = done.includes(choice.id);
    return (
      <button
        key={choice.id}
        ref={(el) => {
          if (el) els.current.set(choice.id, el);
        }}
        type="button"
        className={cn("pair", side === "left" && "lat", selected && "sel", finished && "done", miss.includes(choice.id) && "miss")}
        lang={side === "left" ? language : undefined}
        dir={side === "left" ? "ltr" : undefined}
        disabled={finished || !!verdict}
        aria-pressed={selected}
        onClick={() => {
          if (side === "left") {
            if (right) attempt(choice.id, right);
            else setLeft(selected ? null : choice.id);
          } else if (left) attempt(left, choice.id);
          else setRight(selected ? null : choice.id);
          sfx("toggle", 0.3);
        }}
      >
        {choice.text}
      </button>
    );
  };
  return (
    <>
      <Ask ex={ex} languageName={props.languageName} />
      <div className="ex-grow" />
      <div className="answers">
        <div className="pairs">
          <div role="group" aria-label={t("learn.session.wordsLabel")}>
            {spec.left.map((choice) => button(choice, "left"))}
          </div>
          <div role="group" aria-label={t("learn.session.meaningsLabel")}>
            {spec.right.map((choice) => button(choice, "right"))}
          </div>
        </div>
      </div>
    </>
  );
}

// ───────────────────────────── sort into groups (G3a) ─────────────────────────────

function SortEx(props: ExerciseProps & { spec: Extract<AnswerSpec, { kind: "sort" }> }) {
  const { ex, spec, verdict, submit, language } = props;
  const sets = ex.q.sets ?? [];
  const [chip, setChip] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Record<string, number>>({});
  const [late, setLate] = useState<string[]>([]);
  const first = useRef<Record<string, number>>({});
  const chips = useRef(new Map<string, HTMLElement>());

  const drop = (set: number) => {
    if (!chip || verdict) return;
    const item = spec.items.find((other) => other.id === chip)!;
    if (first.current[chip] === undefined) first.current[chip] = set;
    if (item.set === set) {
      const next = { ...placed, [chip]: set };
      setPlaced(next);
      sfx("tick", 0.4);
      if (Object.keys(next).length === spec.items.length) window.setTimeout(() => submit({ firstSort: first.current }), 260);
    } else {
      setLate((before) => [...before, chip]);
      sfx("droplet", 0.35);
      shake(chips.current.get(chip));
    }
    setChip(null);
  };
  return (
    <>
      <Ask ex={ex} languageName={props.languageName} />
      <div className="bins" role="group" aria-label={t("learn.session.groupsLabel")}>
        {sets.map((name, index) => (
          <button key={index} type="button" className={cn("bin", chip && "armed")} onClick={() => drop(index)} disabled={!chip}>
            <b>{name}</b>
            <span className="in lat" lang={language}>
              {spec.items
                .filter((item) => placed[item.id] === index)
                .map((item) => (
                  <span key={item.id} className={cn("chip placed", late.includes(item.id) && "late")}>
                    {item.text}
                  </span>
                ))}
            </span>
          </button>
        ))}
      </div>
      <div className="ex-grow" />
      <div className="answers">
        <div className="bank lat" lang={language}>
          {spec.items
            .filter((item) => placed[item.id] === undefined)
            .map((item) => (
              <button
                key={item.id}
                ref={(el) => {
                  if (el) chips.current.set(item.id, el);
                }}
                type="button"
                className={cn("chip", chip === item.id && "sel", late.includes(item.id) && "late")}
                aria-pressed={chip === item.id}
                disabled={!!verdict}
                onClick={() => {
                  setChip(chip === item.id ? null : item.id);
                  sfx("toggle", 0.3);
                }}
              >
                {item.text}
              </button>
            ))}
        </div>
        <Idk {...props} />
      </div>
    </>
  );
}

// ───────────────────────────── conjugation tables (C2, C4) ─────────────────────────────

function TableEx(props: ExerciseProps & { spec: Extract<AnswerSpec, { kind: "table" }> }) {
  const { ex, spec, verdict, submit, language } = props;
  const touch = useTouchKeyboard();
  const open = spec.rows.map((row, index) => (row.accepted ? index : -1)).filter((index) => index >= 0);
  const [cells, setCells] = useState<string[]>(() => spec.rows.map(() => ""));
  const [active, setActive] = useState(open[0] ?? 0);
  const inputs = useRef(new Map<number, HTMLInputElement>());
  const given = ex.q.rows ?? [];
  const usedBank = useMemo(() => {
    const counts = new Map<string, number>();
    for (const index of open) if (cells[index]) counts.set(cells[index], (counts.get(cells[index]) ?? 0) + 1);
    return counts;
  }, [cells, open]);
  const full = open.every((index) => cells[index].trim().length > 0);
  const set = (index: number, value: string) => setCells((before) => before.map((cell, i) => (i === index ? value : cell)));
  const rowOk = (index: number) => {
    const accepted = spec.rows[index].accepted;
    if (!accepted) return null;
    const multi = accepted.some((form) => form.includes(" "));
    return (
      matchAny(
        cleanAnswer(cells[index], multi),
        accepted.map((form) => cleanAnswer(form, multi)),
        language,
        false,
      ).result !== "wrong"
    );
  };
  const nextOpen = (from: number) => open.find((index) => index > from && !cells[index]) ?? open.find((index) => !cells[index] && index !== from) ?? from;

  const bankLeft = (spec.bank ?? []).map((form, index) => ({ form, index }));
  const seen = new Map<string, number>();
  const bankView = bankLeft.map(({ form, index }) => {
    const n = (seen.get(form) ?? 0) + 1;
    seen.set(form, n);
    return { form, index, used: n <= (usedBank.get(form) ?? 0) };
  });

  return (
    <>
      <Ask ex={ex} languageName={props.languageName} />
      <Prompt {...props} />
      <div className="conj" dir="ltr">
        {spec.rows.map((row, index) => {
          const fixed = given[index]?.given ?? null;
          const ok = verdict ? rowOk(index) : null;
          return (
            <div key={index}>
              <span className="p lat" lang={language}>
                {row.pronoun}
              </span>
              {row.accepted === null ? (
                <span className="f lat" lang={language}>
                  {fixed}
                </span>
              ) : spec.bank ? (
                <button
                  type="button"
                  className={cn("cell lat", active === index && !verdict && "on", ok === true && "ok", ok === false && "bad")}
                  lang={language}
                  disabled={!!verdict}
                  onClick={() => {
                    if (cells[index]) set(index, "");
                    setActive(index);
                  }}
                >
                  {verdict && ok === false ? row.accepted[0] : cells[index]}
                </button>
              ) : (
                <input
                  ref={(el) => {
                    if (el) inputs.current.set(index, el);
                  }}
                  className={cn("cell lat", ok === true && "ok", ok === false && "bad")}
                  lang={language}
                  value={verdict && ok === false ? row.accepted[0] : cells[index]}
                  readOnly={!!verdict}
                  inputMode={touch ? "none" : "text"}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-label={row.pronoun}
                  onFocus={() => setActive(index)}
                  onChange={(event) => set(index, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    const next = open.find((other) => other > index);
                    if (next !== undefined) inputs.current.get(next)?.focus();
                    else if (full) submit({ rows: cells });
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="ex-grow" />
      <div className={cn(spec.bank ? "answers" : "cta", !spec.bank && touch && "with-kb")}>
        {spec.bank && !verdict ? (
          <div className="bank lat" lang={language}>
            {bankView.map(({ form, index, used }) =>
              used ? (
                <span key={index} className="tile ghost-tile" aria-hidden="true">
                  {form}
                </span>
              ) : (
                <button
                  key={index}
                  type="button"
                  className="tile"
                  onClick={() => {
                    sfx("press", 0.35);
                    set(active, form);
                    setActive(nextOpen(active));
                  }}
                >
                  {form}
                </button>
              ),
            )}
          </div>
        ) : null}
        {verdict ? null : (
          <div className="row">
            {ex.idk ? (
              <button type="button" className="ghost" onClick={() => submit({ idk: true })}>
                {t("learn.session.idk")}
              </button>
            ) : null}
            <Check disabled={!full} onClick={() => submit({ rows: cells })} />
          </div>
        )}
        {!spec.bank && !verdict ? (
          touch ? (
            <Keyboard language={language} onKey={(text) => set(active, cells[active] + text)} onErase={() => set(active, [...cells[active]].slice(0, -1).join(""))} />
          ) : (
            <SpecialRow
              language={language}
              onKey={(text) => {
                set(active, cells[active] + text);
                inputs.current.get(active)?.focus();
              }}
            />
          )
        ) : null}
      </div>
    </>
  );
}

export function Exercise(props: ExerciseProps) {
  const spec = props.ex.a;
  switch (spec.kind) {
    case "choice":
      return <ChoiceEx {...props} spec={spec} />;
    case "choice2":
      return <Choice2Ex {...props} spec={spec} />;
    case "spot":
      return <SpotEx {...props} spec={spec} />;
    case "type":
      return <TypeEx {...props} spec={spec} />;
    case "letters":
      return <LettersEx {...props} spec={spec} />;
    case "tiles":
      return <TilesEx {...props} spec={spec} />;
    case "pairs":
      return <PairsEx {...props} spec={spec} />;
    case "sort":
      return <SortEx {...props} spec={spec} />;
    case "table":
      return <TableEx {...props} spec={spec} />;
  }
}

/** The right answer as text, for the feedback sheet. */
export function rightAnswer(ex: Ex): string | null {
  const spec = ex.a;
  switch (spec.kind) {
    case "choice":
      return spec.options.find((option) => option.id === spec.correct)?.text ?? null;
    case "choice2":
      return ex.q.sentence?.text ?? spec.correct.map((id, i) => spec.groups[i].find((option) => option.id === id)?.text).join(" … ");
    case "spot":
      return ex.q.sentence?.text ?? null;
    case "type":
      return spec.gender ? `${spec.gender.correct} ${spec.accepted[0]}` : spec.accepted[0];
    case "letters":
      return spec.word;
    case "tiles":
      return spec.orders[0].join(ex.code === "W4a" ? "" : " ");
    case "pairs": {
      const left = spec.left.find((choice) => choice.id === spec.target);
      const right = spec.right.find((choice) => choice.id === spec.pairs[spec.target]);
      return left && right ? `${left.text} = ${right.text}` : null;
    }
    case "sort":
      return null;
    case "table":
      return spec.rows
        .filter((row) => row.accepted)
        .map((row) => `${row.pronoun} ${row.accepted![0]}`)
        .join("، ");
  }
}

export { lat as latin };

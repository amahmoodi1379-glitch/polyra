"use client";

import { useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/learn/icons";
import { buzz, sfx } from "@/components/learn/sfx";
import { t } from "@/i18n";

/**
 * The app's own Latin keyboard on phones and tablets (PRD §3.5, §15.6): the phone's keyboard never
 * opens, so a Persian layout, autocorrect and the automatic capital cannot get in the way. On a
 * computer the learner types on their own keyboard and only the row of special letters is shown.
 */

export const SPECIALS: Record<string, string[]> = {
  fr: ["é", "è", "ê", "à", "ç", "ù", "ô", "î", "û", "ë", "ï", "œ"],
  de: ["ä", "ö", "ü", "ß"],
};

const LETTERS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const DIGITS = ["1234567890", "-'\".,?!:"];

const coarse = "(pointer: coarse)";
const subscribe = (listener: () => void) => {
  const query = window.matchMedia(coarse);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

/** Whether this device types with a finger: the app's keyboard is shown instead of the phone's. */
export function useTouchKeyboard() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(coarse).matches,
    () => false,
  );
}

type Props = { language: string; onKey: (text: string) => void; onErase: () => void; disabled?: boolean };

export function Keyboard({ language, onKey, onErase, disabled }: Props) {
  const [shift, setShift] = useState(false);
  const [digits, setDigits] = useState(false);
  const press = (text: string) => {
    if (disabled) return;
    onKey(shift ? text.toLocaleUpperCase(language) : text);
    if (shift) setShift(false);
    sfx("tick", 0.35);
    buzz(4);
  };
  // pointerdown keeps the focus where it is and answers at the touch, not at the lift.
  const key = (text: string, label = text) => (
    <button
      key={text}
      type="button"
      className="key"
      aria-label={label}
      onPointerDown={(event) => {
        event.preventDefault();
        press(text);
      }}
      onClick={(event) => {
        // Keyboard and switch users: a click without a pointer press.
        if (event.detail === 0) press(text);
      }}
    >
      {shift ? text.toLocaleUpperCase(language) : text}
    </button>
  );
  const erase = (
    <button
      type="button"
      className="key fn"
      aria-label={t("learn.session.erase")}
      onPointerDown={(event) => {
        event.preventDefault();
        if (disabled) return;
        onErase();
        sfx("tick", 0.3);
      }}
      onClick={(event) => {
        if (event.detail === 0) onErase();
      }}
    >
      <Icon name="l-erase" />
    </button>
  );

  return (
    <div className="kb" role="group" aria-label={t("learn.session.keyboard")}>
      <div className="kb-row special">{(SPECIALS[language] ?? []).map((char) => key(char))}</div>
      {digits ? (
        <>
          {DIGITS.map((row) => (
            <div key={row} className="kb-row">
              {[...row].map((char) => key(char))}
            </div>
          ))}
          <div className="kb-row">
            <button type="button" className="key fn" onClick={() => setDigits(false)}>
              {t("learn.session.letters")}
            </button>
            {key(" ", t("learn.session.space"))}
            {erase}
          </div>
        </>
      ) : (
        <>
          <div className="kb-row">{[...LETTERS[0]].map((char) => key(char))}</div>
          <div className="kb-row">{[...LETTERS[1]].map((char) => key(char))}</div>
          <div className="kb-row">
            <button type="button" className="key fn" aria-label={t("learn.session.shift")} aria-pressed={shift} onClick={() => setShift((value) => !value)}>
              <Icon name="l-shift" />
            </button>
            {[...LETTERS[2]].map((char) => key(char))}
            {erase}
          </div>
          <div className="kb-row">
            <button type="button" className="key fn" onClick={() => setDigits(true)}>
              {t("learn.session.digits")}
            </button>
            {key("'", "'")}
            {key("-", "-")}
            <button
              type="button"
              className="key space"
              aria-label={t("learn.session.space")}
              onPointerDown={(event) => {
                event.preventDefault();
                press(" ");
              }}
              onClick={(event) => {
                if (event.detail === 0) press(" ");
              }}
            />
            {key(".", ".")}
          </div>
        </>
      )}
    </div>
  );
}

/** On a computer: the special letters under the answer field, typed at the cursor. */
export function SpecialRow({ language, onKey }: { language: string; onKey: (text: string) => void }) {
  const specials = SPECIALS[language] ?? [];
  if (specials.length === 0) return null;
  return (
    <div className="specials" role="group" aria-label={t("learn.session.keyboard")}>
      {specials.map((char) => (
        <button
          key={char}
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onKey(char);
            sfx("tick", 0.3);
          }}
        >
          {char}
        </button>
      ))}
    </div>
  );
}

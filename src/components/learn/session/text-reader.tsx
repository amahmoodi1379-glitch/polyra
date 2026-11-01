"use client";

import { useRef, useState } from "react";
import { useDeviceVoice } from "@/components/learn/speak";
import type { Gloss } from "@/engine/ex";
import type { TextView } from "@/engine/session";
import { t } from "@/i18n";
import { TextBody } from "./text-body";
import { useTextSound } from "./text-sound";
import { Kicker, SoundPanel } from "./text";

/**
 * One text of «متن‌های من» (PRD §7.9): the whole sound at normal and slow speed, sentence by sentence,
 * the text with each sentence's translation and word meanings on a touch. No score, no question.
 * While a listening attempt is still to come, the words open only after one full play, so the page
 * stays listening practice; a phone that cannot play the text shows it at once.
 */
export function TextReader({ view, language, languageName, listenFirst }: { view: TextView; language: string; languageName: string; listenFirst: boolean }) {
  const [slow, setSlow] = useState(false);
  const [heard, setHeard] = useState(!listenFirst);
  const [translated, setTranslated] = useState(false);
  const voice = useDeviceVoice(language);
  const silent = !view.audio && voice === false;
  const sound = useTextSound(view, { id: `mytext:${view.id}`, limit: null, plays: 0, positionMs: 0, slow, onEnd: () => setHeard(true) });
  const open = heard || silent;

  // A word touched here goes to the new-word queue like anywhere else with help (PRD §5.9).
  const tapped = useRef(new Set<number>());
  const tap = (gloss: Gloss) => {
    if (gloss.kind !== "word" || !gloss.wordId || tapped.current.has(gloss.wordId)) return;
    tapped.current.add(gloss.wordId);
    void fetch("/api/learn/tap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ language, wordId: gloss.wordId }) }).catch(() => {});
  };

  return (
    <div className="screen-body tx">
      <header className="tx-head">
        <Kicker view={view} info={null} />
        <h2 className="tx-title lat" lang={language} dir="ltr">
          {view.title}
        </h2>
        {silent ? <p className="tx-lead">{t("learn.texts.noVoice", { language: languageName })}</p> : !open ? <p className="tx-lead">{t("learn.texts.listenFirst")}</p> : null}
      </header>
      {silent ? null : <SoundPanel view={view} sound={sound} slow={slow} onSlow={setSlow} bySentence={!open} />}
      {open ? (
        <div className="tx-open">
          <div className="tx-title-row">
            <h3 className="tx-h2">{t("learn.texts.words")}</h3>
            <button type="button" className="tx-tr" aria-pressed={translated} onClick={() => setTranslated(!translated)}>
              {translated ? t("learn.text.hideTranslations") : t("learn.text.showTranslations")}
            </button>
          </div>
          <TextBody view={view} language={language} wordTap translations={translated ? "always" : "tap"} play={silent ? undefined : sound.sentence} current={sound.sentenceAt} onTap={tap} />
        </div>
      ) : (
        <div className="tx-veil" aria-hidden="true">
          {view.sentences.map((line) => (
            <span key={line.id} style={{ inlineSize: `${Math.min(100, 30 + line.text.length * 1.2)}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

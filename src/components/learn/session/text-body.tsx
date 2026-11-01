"use client";

import { useState } from "react";
import { Icon } from "@/components/learn/icons";
import type { Gloss, SentenceView } from "@/engine/ex";
import type { TextView } from "@/engine/session";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { SentenceLine } from "./sentence";

/**
 * The sentences of a text as the learner reads them (PRD §7.4, §7.9): a line for each sentence, with
 * its speaker in a dialogue. What it allows comes from the stage: word meanings, the translation of a
 * sentence, playing a sentence, or touching the sentence that answers a «find» question.
 */

export type TextBodyOptions = {
  language: string;
  /** A word's meaning with a touch. */
  wordTap: boolean;
  /** Each sentence's Persian translation: never, with a touch, or under every line. */
  translations: "never" | "tap" | "always";
  /** Plays one sentence. */
  play?: (index: number) => void;
  /** The sentence the sound is in now. */
  current?: number | null;
  /** Choosing the sentence that answers a question (Q-find). */
  pick?: { chosen: number | null; onPick: (index: number) => void } | null;
  /** Sentences to mark: the right one of a «find» question on the review page. */
  marked?: number[];
  onTap?: (gloss: Gloss) => void;
};

const asSentence = (line: TextView["sentences"][number]): SentenceView => ({
  id: line.id,
  text: line.text,
  segments: [{ t: "text", s: line.text }],
  translation: line.translation,
  glosses: line.glosses,
  speak: line.speak,
});

export function TextBody({ view, language, wordTap, translations, play, current, pick, marked, onTap }: { view: TextView } & TextBodyOptions) {
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const toggle = (index: number) => {
    const next = new Set(open);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setOpen(next);
  };
  return (
    <div className={cn("tx-body", pick && "picking")}>
      {view.sentences.map((line, index) => {
        const shown = translations === "always" || (translations === "tap" && open.has(index));
        return (
          <div key={line.id} className={cn("tx-line", current === index && "now", pick?.chosen === index && "chosen", marked?.includes(index) && "marked")}>
            {line.speaker ? (
              <span className="who lat" lang={language} dir="ltr">
                {line.speaker}
              </span>
            ) : null}
            {pick ? (
              <button
                type="button"
                className="tx-pick lat"
                lang={language}
                dir="ltr"
                aria-pressed={pick.chosen === index}
                aria-label={t("learn.text.sentenceN", { n: formatNumber(index + 1) })}
                onClick={() => pick.onPick(index)}
              >
                {line.text}
              </button>
            ) : (
              <SentenceLine view={asSentence(line)} small language={language} touch={wordTap} onTap={onTap} />
            )}
            {!pick && (play || (translations === "tap" && line.translation)) ? (
              <div className="tx-acts">
                {play ? (
                  <button type="button" className="mini-play" aria-label={t("learn.session.playSentence")} onClick={() => play(index)}>
                    <Icon name="l-spk1" className="i s" />
                  </button>
                ) : null}
                {translations === "tap" && line.translation ? (
                  <button type="button" className="tx-tr" aria-expanded={open.has(index)} onClick={() => toggle(index)}>
                    {t("learn.text.translation")}
                  </button>
                ) : null}
              </div>
            ) : null}
            {shown && line.translation ? <p className="tr">{line.translation}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

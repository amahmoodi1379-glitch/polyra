"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/learn/icons";
import { WordText } from "@/components/learn/session/cards";
import { folds } from "@/engine/text";
import { t } from "@/i18n";
import type { MyWord } from "@/server/learn/lists";

/** Persian letters that are typed two ways (Arabic and Persian keyboards), and the zero-width joiner. */
const persian = (text: string) => text.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " ");
const key = (text: string) => persian(folds(text.toLowerCase())[1]);

/** «کلمه‌های من»: newest first, searched by the word or its meaning (PRD §3.10). */
export function WordList({ language, words }: { language: string; words: MyWord[] }) {
  const [query, setQuery] = useState("");
  const wanted = key(query.trim());
  const shown = wanted ? words.filter((item) => key(`${item.word.display} ${item.word.meanings.join(" ")}`).includes(wanted)) : words;
  return (
    <>
      <label className="search">
        <Icon name="l-search" />
        <span className="vh">{t("learn.words.search")}</span>
        <input type="search" value={query} placeholder={t("learn.words.search")} onChange={(event) => setQuery(event.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <p className="count-line num" aria-live="polite">
        {t("learn.words.count", { n: shown.length })}
      </p>
      {shown.length === 0 ? (
        <div className="empty">
          <p>{t("learn.words.noMatch")}</p>
        </div>
      ) : (
        <ul className="entries" role="list">
          {shown.map((item) => (
            <li key={item.id}>
              <Link className="entry" href={`/learn/${language}/words/${item.id}`}>
                <span className="t">
                  <WordText word={item.word} />
                  <span>{item.word.meaning}</span>
                </span>
                <Icon name="l-back" className="i s fwd" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

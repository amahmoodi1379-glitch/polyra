"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, RefreshCw, Search, X } from "lucide-react";
import { FindWord } from "@/components/admin/find-word";
import { Button } from "@/components/ui/button";
import { t, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import type { WordInfo } from "@/server/content/library/edit/shared";
import type { TokenEdit } from "@/server/content/library/edit/tokens";
import { suggestWords } from "../actions";
import {
  AddButton,
  Field,
  RowTools,
  SelectBox,
  TextBox,
  move,
  useField,
  useForm,
} from "../form-kit";

const gap = /\s*(?:\.{3}|…)\s*/u;
const letter = /[\p{L}\p{N}]/u;
const norm = (text: string) =>
  text.normalize("NFC").toLowerCase().replace(/[’ʼ]/g, "'");

/**
 * Whether the rows still cover the text: every piece found in order on word boundaries, and no letter
 * of the text left without a row. Only for the «هماهنگ کردن» hint; the server checks for real.
 */
function fits(text: string, tokens: TokenEdit[]) {
  const lower = norm(text);
  const covered = new Array<boolean>(lower.length).fill(false);
  const bounded = (index: number, piece: string) =>
    (!letter.test(piece[0]) || index === 0 || !letter.test(lower[index - 1])) &&
    (!letter.test(piece.at(-1) ?? "") ||
      index + piece.length >= lower.length ||
      !letter.test(lower[index + piece.length]));
  let cursor = 0;
  for (const token of tokens) {
    const pieces = token.surface
      .split(gap)
      .map((piece) => norm(piece.trim()))
      .filter(Boolean);
    let from = cursor;
    for (const [k, piece] of pieces.entries()) {
      let index = lower.indexOf(piece, from);
      while (index >= 0 && (covered[index] || !bounded(index, piece)))
        index = lower.indexOf(piece, index + 1);
      if (index < 0) return false;
      for (let i = index; i < index + piece.length; i++) covered[i] = true;
      if (k === 0) cursor = index + piece.length;
      from = index + piece.length;
    }
  }
  return [...lower].every(
    (char, index) => covered[index] || !letter.test(char),
  );
}

const kinds: TokenEdit["kind"][] = ["word", "name", "number", "other"];

/** The columns of a row at each width of the form (container sizes, not the screen). */
const row =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 @lg:grid-cols-[1.5rem_minmax(0,1fr)_8rem_auto] @4xl:grid-cols-[1.5rem_9rem_8rem_minmax(0,1.2fr)_minmax(0,1fr)_auto]";

/**
 * The word table of a sentence (PRD §13.7): one row per piece, its kind, the list word and the
 * meaning here. When the text changes, «هماهنگ کردن با متن» rebuilds the rows and keeps the old ones
 * that still fit.
 */
export function TokenTable({
  text,
  words,
  name = "tokens",
  label,
}: {
  text: string;
  words: Record<string, WordInfo>;
  name?: string;
  label?: MessageKey;
}) {
  const { language } = useForm();
  const [tokens, setTokens, errors] = useField<TokenEdit[]>(name);
  const [known, setKnown] = useState(words);
  const [picking, setPicking] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const list = tokens ?? [];
  const stale = text.trim() !== "" && !fits(text, list);

  const update = (index: number, patch: Partial<TokenEdit>) =>
    setTokens(
      list.map((token, k) => (k === index ? { ...token, ...patch } : token)),
    );

  const suggest = () =>
    startTransition(async () => {
      setFailed(false);
      const result = await suggestWords(language, text, list);
      if (!result) {
        setFailed(true);
        return;
      }
      setKnown((current) => ({ ...current, ...result.words }));
      setTokens(result.tokens);
      setPicking(null);
    });

  const ownErrors = errors.filter((error) => error.path === name);

  return (
    <Field
      name={name}
      label={label ?? "admin.library.tokens.title"}
      help={t("admin.library.tokens.lead")}
      errors={ownErrors}
      wide
    >
      {stale ? (
        <div className="bg-tint flex flex-wrap items-center gap-3 rounded-[16px] px-4 py-3">
          <p className="text-ink min-w-0 flex-[1_1_16rem] text-[13.5px] leading-6 font-bold">
            {t("admin.library.tokens.suggestLead")}
          </p>
          <Button type="button" size="sm" onClick={suggest} disabled={pending}>
            {pending ? (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                strokeWidth={2}
                aria-hidden
              />
            ) : (
              <RefreshCw strokeWidth={2} aria-hidden />
            )}
            {pending
              ? t("admin.library.tokens.suggesting")
              : t("admin.library.tokens.suggest")}
          </Button>
          {failed ? (
            <p className="text-bad w-full text-[13px] font-bold">
              {t("admin.library.result.failed")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="@container">
        <div
          className={cn(
            row,
            "text-ink-3 hidden px-0 pb-1 text-[12.5px] font-bold @4xl:grid",
          )}
        >
          <span />
          <span>{t("admin.library.tokens.surface")}</span>
          <span>{t("admin.library.tokens.kind")}</span>
          <span>{t("admin.library.tokens.word")}</span>
          <span>{t("admin.library.tokens.meaning")}</span>
          <span />
        </div>

        <ol
          className={cn(
            "flex flex-col transition-opacity",
            pending && "opacity-50",
          )}
        >
          {list.map((token, index) => {
            const isWord = token.kind === "word";
            const word = token.code ? known[token.code] : undefined;
            return (
              <li
                key={index}
                className="border-line flex flex-col gap-2 border-b py-2.5 last:border-b-0"
              >
                {/* Narrow: piece and tools, then kind, then word and meaning. Medium: two lines. Wide: one line. */}
                <div className={row}>
                  <span className="text-ink-3 hidden text-center text-[12.5px] tabular-nums @lg:col-start-1 @lg:row-start-1 @lg:block">
                    {index + 1}
                  </span>
                  <TextBox
                    value={token.surface}
                    onChange={(next) => update(index, { surface: next })}
                    voice="target"
                    className="col-start-1 row-start-1 h-10 text-[16px] @lg:col-start-2"
                  />
                  <SelectBox
                    value={token.kind}
                    onChange={(next) =>
                      update(index, {
                        kind: next as TokenEdit["kind"],
                        ...(next === "word"
                          ? {}
                          : { code: null, meaning_fa: null }),
                      })
                    }
                    options={kinds.map((kind) => ({
                      value: kind,
                      label: t(`admin.library.options.tokenKind.${kind}`),
                    }))}
                    label={t("admin.library.tokens.kind")}
                    className="col-span-2 col-start-1 row-start-2 [&_select]:h-10 @lg:col-span-1 @lg:col-start-3 @lg:row-start-1"
                  />
                  <span className="col-start-2 row-start-1 @lg:col-start-4 @4xl:col-start-6">
                    <RowTools
                      index={index}
                      count={list.length}
                      onMove={(from, to) => setTokens(move(list, from, to))}
                      onRemove={(at) => {
                        setTokens(list.filter((_, k) => k !== at));
                        setPicking(null);
                      }}
                    />
                  </span>
                  <div className="col-span-2 col-start-1 row-start-3 grid grid-cols-1 gap-2 @lg:col-span-3 @lg:col-start-2 @lg:row-start-2 @lg:grid-cols-2 @4xl:contents">
                    {isWord ? (
                      <button
                        type="button"
                        onClick={() =>
                          setPicking(picking === index ? null : index)
                        }
                        aria-expanded={picking === index}
                        className={cn(
                          "hover:border-ink-3 flex h-10 min-w-0 items-center gap-2 rounded-[12px] border px-3 text-start transition-colors @4xl:col-start-4 @4xl:row-start-1",
                          token.code
                            ? "border-line-2"
                            : "border-brand-soft border-dashed",
                        )}
                      >
                        {token.code ? (
                          <>
                            <bdi
                              dir="ltr"
                              lang={language}
                              className="lat text-ink shrink-0 text-[16px] font-semibold"
                            >
                              {word?.lemma ?? token.code}
                            </bdi>
                            <span
                              className={cn(
                                "min-w-0 flex-1 truncate text-[13px]",
                                word ? "text-ink-3" : "text-bad font-bold",
                              )}
                            >
                              {word
                                ? (word.meaning_fa ?? "")
                                : t("admin.library.words.unknownPart")}
                            </span>
                            {word ? (
                              <span className="lat text-ink-3 shrink-0 text-[12px]">
                                {word.level}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-brand-text flex items-center gap-1.5 text-[13px] font-bold">
                            <Search
                              className="size-3.5"
                              strokeWidth={2}
                              aria-hidden
                            />
                            {t("admin.library.tokens.none")}
                          </span>
                        )}
                      </button>
                    ) : (
                      <span className="text-ink-3 hidden h-10 items-center px-3 text-[13px] @4xl:col-start-4 @4xl:flex @4xl:row-start-1">
                        —
                      </span>
                    )}
                    {isWord ? (
                      <TextBox
                        value={token.meaning_fa ?? ""}
                        onChange={(next) =>
                          update(index, { meaning_fa: next || null })
                        }
                        voice="fa"
                        placeholder={
                          word?.meaning_fa ?? t("admin.library.tokens.meaning")
                        }
                        className="h-10 text-[14px] @4xl:col-start-5 @4xl:row-start-1"
                      />
                    ) : null}
                  </div>
                </div>
                {picking === index ? (
                  <div className="flex flex-col gap-2 @lg:ps-8">
                    <FindWord
                      language={language}
                      onPick={(picked) => {
                        setKnown((current) => ({
                          ...current,
                          [picked.code]: picked,
                        }));
                        update(index, { code: picked.code });
                        setPicking(null);
                      }}
                      onCancel={() => setPicking(null)}
                    />
                    {token.code ? (
                      <button
                        type="button"
                        onClick={() => {
                          update(index, { code: null });
                          setPicking(null);
                        }}
                        className="text-ink-3 hover:text-bad flex w-fit items-center gap-1.5 rounded-[10px] px-2 py-1 text-[13px] font-bold"
                      >
                        <X className="size-3.5" strokeWidth={2} aria-hidden />
                        {t("admin.library.tokens.clear")}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      <AddButton
        onClick={() =>
          setTokens([
            ...list,
            { surface: "", kind: "word", code: null, meaning_fa: null },
          ])
        }
        label={t("admin.library.tokens.addRow")}
      />
    </Field>
  );
}

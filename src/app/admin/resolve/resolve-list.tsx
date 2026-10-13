"use client";

import { useEffect, useId, useOptimistic, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { Check, CircleAlert, LoaderCircle, Plus, Search } from "lucide-react";
import type { Pos } from "@/generated/prisma/client";
import { joinDots } from "@/components/admin/join-dots";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumber, t, tRich, type MessageKey } from "@/i18n";
import { cn } from "@/lib/utils";
import { posValues } from "@/schemas/common";
import type { CandidateAction, CandidateGroup, DuplicatePair, OpenItems, SentenceRef, SuspectGroup, WordRef } from "@/server/content/resolve";
import { findWords, settleCandidate, settleDuplicate, settleSuspect, type ResolveOutcome } from "./actions";

type Settle = (id: string, run: () => Promise<ResolveOutcome>) => void;
type Panel = "add" | "choose" | null;

const posLabel = (pos: Pos) => t(`content.pos.${pos}` as MessageKey);

/**
 * The open items of one language, grouped in three lists (PRD §13.9). A settled item folds away at
 * once and the page refreshes behind it; if saving fails it comes back with the reason.
 */
export function ResolveList({ language, items, levels }: { language: string; items: OpenItems; levels: string[] }) {
  const [hidden, hide] = useOptimistic<string[], string>([], (list, id) => [...list, id]);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const settle: Settle = (id, run) => {
    const item = document.querySelector<HTMLElement>(`[data-item="${CSS.escape(id)}"]`);
    const next = item?.nextElementSibling ?? item?.previousElementSibling;
    setFailed((current) => ({ ...current, [id]: false }));
    startTransition(async () => {
      hide(id);
      next?.querySelector<HTMLElement>("[data-focus]")?.focus({ preventScroll: true });
      const outcome = await run();
      if (outcome === "gone") setToast(t("admin.resolve.gone"));
      if (outcome === "failed") setFailed((current) => ({ ...current, [id]: true }));
    });
  };

  const visible = (id: string) => !hidden.includes(id);
  const candidates = items.candidates.filter((group) => visible(`c:${group.key}`));
  const suspects = items.suspects.filter((group) => visible(`s:${group.key}`));
  const duplicates = items.duplicates.filter((pair) => visible(`d:${pair.word.id}`));
  const nothingLeft = candidates.length + suspects.length + duplicates.length === 0;

  return (
    <>
      {nothingLeft ? (
        <div className="bg-surface flex flex-col items-start gap-4 rounded-[22px] p-6 shadow-[var(--shadow-1)] sm:p-8">
          <span className="bg-ok-soft text-ok grid size-11 place-items-center rounded-full">
            <Check className="size-[22px]" strokeWidth={2.25} aria-hidden />
          </span>
          <p className="text-ink text-lg font-extrabold">{t("admin.resolve.empty")}</p>
          <Button asChild variant="secondary">
            <Link href="/admin">{t("admin.resolve.back")}</Link>
          </Button>
        </div>
      ) : null}

      {items.candidates.length > 0 ? (
        <Section id="candidates" title={t("admin.resolve.candidates.title")} lead={t("admin.resolve.candidates.lead")} count={candidates.length}>
          {items.candidates.map((group) => {
            const id = `c:${group.key}`;
            return (
              <Item key={id} id={id} hidden={!visible(id)} failed={failed[id]}>
                <CandidateItem group={group} language={language} levels={levels} settle={(run) => settle(id, run)} />
              </Item>
            );
          })}
        </Section>
      ) : null}

      {items.suspects.length > 0 ? (
        <Section id="suspects" title={t("admin.resolve.suspects.title")} lead={t("admin.resolve.suspects.lead")} count={suspects.length}>
          {items.suspects.map((group) => {
            const id = `s:${group.key}`;
            return (
              <Item key={id} id={id} hidden={!visible(id)} failed={failed[id]}>
                <SuspectItem group={group} language={language} settle={(run) => settle(id, run)} />
              </Item>
            );
          })}
        </Section>
      ) : null}

      {items.duplicates.length > 0 ? (
        <Section id="duplicates" title={t("admin.resolve.duplicates.title")} lead={t("admin.resolve.duplicates.lead")} count={duplicates.length}>
          {items.duplicates.map((pair) => {
            const id = `d:${pair.word.id}`;
            return (
              <Item key={id} id={id} hidden={!visible(id)} failed={failed[id]}>
                <DuplicateItem pair={pair} language={language} settle={(run) => settle(id, run)} />
              </Item>
            );
          })}
        </Section>
      ) : null}

      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-40 flex justify-center"
      >
        {toast ? (
          <p className="bg-ink text-ground animate-in fade-in slide-in-from-bottom-2 pointer-events-auto rounded-[14px] px-4 py-3 text-[14.5px] font-bold shadow-[var(--shadow-1)] duration-200 motion-reduce:animate-none">
            {toast}
          </p>
        ) : null}
      </div>
    </>
  );
}

/* ---------- Frame ---------- */

function Section({ id, title, lead, count, children }: { id: string; title: string; lead: string; count: number; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-6 flex-col gap-3">
      <div className="flex flex-col gap-1 px-1">
        <h2 id={`${id}-title`} className="text-ink flex items-center gap-2.5 text-[17px] font-extrabold">
          {title}
          <span className="num bg-tint text-brand-text inline-flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[13px] font-bold">
            {formatNumber(count)}
          </span>
        </h2>
        <p className="text-ink-3 max-w-[64ch] text-[14px] leading-6">{lead}</p>
      </div>
      <ul className="bg-surface rounded-[22px] shadow-[var(--shadow-1)]">{children}</ul>
    </section>
  );
}

/** One item; folds shut when settled so the list closes up instead of jumping. */
function Item({ id, hidden, failed, children }: { id: string; hidden: boolean; failed?: boolean; children: ReactNode }) {
  return (
    <li
      data-item={id}
      inert={hidden}
      className={cn(
        "border-line grid border-b transition-[grid-template-rows,opacity,border-color] duration-300 ease-[var(--ease-out)] last:border-b-0 motion-reduce:transition-none",
        hidden ? "grid-rows-[0fr] border-transparent opacity-0" : "grid-rows-[1fr]",
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="flex flex-col gap-4 px-5 py-5 sm:px-6">
          {children}
          {failed ? (
            <p role="alert" className="text-bad flex items-center gap-1.5 text-[14px] font-bold">
              <CircleAlert className="size-4 shrink-0" strokeWidth={2} aria-hidden />
              {t("admin.resolve.failed")}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** The question of an item; focus lands here when the item above it is settled. */
function Question({ children }: { children: ReactNode }) {
  return (
    <p data-focus tabIndex={-1} className="text-ink text-[15.5px] leading-7 font-bold outline-none">
      {children}
    </p>
  );
}

/** A French or German word inside a Persian sentence. */
function Lat({ language, children, className }: { language: string; children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" lang={language} className={cn("lat text-[1.08em] font-semibold", className)}>
      {children}
    </span>
  );
}

function Meta({ meaning, sentences }: { meaning?: string | null; sentences?: number }) {
  const parts = [
    meaning ? t("admin.resolve.meaning", { meaning }) : null,
    sentences && sentences > 1 ? t("admin.resolve.inSentences", { count: sentences }) : null,
  ].filter((part) => part !== null);
  if (parts.length === 0) return null;
  return <p className="text-ink-3 -mt-2.5 text-[14px] leading-6">{joinDots(parts)}</p>;
}

/** One sentence the item came from, with the word marked, and its translation. */
function Sentence({ sentence, language }: { sentence: SentenceRef; language: string }) {
  return (
    <figure className="bg-ground flex flex-col gap-1 rounded-[16px] px-4 py-3">
      <p dir="ltr" lang={language} className="lat text-ink text-[18px] leading-[1.6]">
        {highlight(sentence.text, sentence.spans)}
      </p>
      <figcaption className="text-ink-2 text-[14px] leading-6">{sentence.translation_fa}</figcaption>
    </figure>
  );
}

function highlight(text: string, spans: [number, number][]) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of [...spans].sort((a, b) => a[0] - b[0])) {
    if (start < at || end > text.length || start >= end) continue;
    parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} className="bg-tint-2 text-brand-text rounded-[6px] px-[3px] font-semibold [box-decoration-break:clone]">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  }
  parts.push(text.slice(at));
  return parts;
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="grid gap-2 sm:flex sm:flex-wrap">{children}</div>;
}

/* ---------- The three kinds ---------- */

function CandidateItem({
  group,
  language,
  levels,
  settle,
}: {
  group: CandidateGroup;
  language: string;
  levels: string[];
  settle: (run: () => Promise<ResolveOutcome>) => void;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const panelId = useId();
  const act = (action: CandidateAction) => settle(() => settleCandidate(language, group.key, action));
  const toggle = (next: Panel) => setPanel((current) => (current === next ? null : next));
  const word = <Lat language={language}>{group.word}</Lat>;

  let question: ReactNode[];
  let actions: ReactNode;
  if (group.reason === "name_matches_word" && group.match) {
    const lemma = <Lat language={language}>{group.match.lemma}</Lat>;
    question = group.match.meaning_fa
      ? tRich("admin.resolve.candidates.name", { word, lemma, meaning: group.match.meaning_fa })
      : tRich("admin.resolve.candidates.namePlain", { word, lemma });
    actions = (
      <>
        <Button variant="secondary" onClick={() => act({ type: "listed" })}>
          <Check strokeWidth={2} aria-hidden />
          {t("admin.resolve.candidates.isListed")}
        </Button>
        <Button variant="outline" onClick={() => act({ type: "name" })}>
          {t("admin.resolve.candidates.isName")}
        </Button>
      </>
    );
  } else {
    question = tRich("admin.resolve.candidates.missing", { word });
    actions = (
      <>
        <Button variant="secondary" className="aria-expanded:bg-tint-2" aria-expanded={panel === "add"} aria-controls={panelId} onClick={() => toggle("add")}>
          <Plus strokeWidth={2} aria-hidden />
          {t("admin.resolve.candidates.add")}
        </Button>
        <Button variant="outline" className="aria-expanded:border-brand-soft aria-expanded:bg-tint" aria-expanded={panel === "choose"} aria-controls={panelId} onClick={() => toggle("choose")}>
          <Search strokeWidth={2} aria-hidden />
          {t("admin.resolve.candidates.choose")}
        </Button>
        <Button variant="outline" onClick={() => act({ type: "name" })}>
          {t("admin.resolve.candidates.isName")}
        </Button>
      </>
    );
  }

  return (
    <>
      <Question>{question}</Question>
      <Meta meaning={group.meaning} sentences={group.sentences} />
      <Sentence sentence={group.sentence} language={language} />
      <Actions>{actions}</Actions>
      <div id={panelId}>
        {panel === "add" ? (
          <AddWord group={group} language={language} levels={levels} onAdd={act} onCancel={() => setPanel(null)} />
        ) : panel === "choose" ? (
          <FindWord language={language} onPick={(found) => act({ type: "choose", wordId: found.id })} onCancel={() => setPanel(null)} />
        ) : null}
      </div>
    </>
  );
}

function SuspectItem({ group, language, settle }: { group: SuspectGroup; language: string; settle: (run: () => Promise<ResolveOutcome>) => void }) {
  const [choosing, setChoosing] = useState(false);
  const panelId = useId();
  const surface = <Lat language={language}>{group.surface}</Lat>;
  const lemma = <Lat language={language}>{group.word.lemma}</Lat>;
  return (
    <>
      <Question>
        {group.word.meaning_fa
          ? tRich("admin.resolve.suspects.question", { surface, lemma, meaning: group.word.meaning_fa })
          : tRich("admin.resolve.suspects.questionPlain", { surface, lemma })}
      </Question>
      <Meta sentences={group.sentences} />
      <Sentence sentence={group.sentence} language={language} />
      <Actions>
        <Button variant="secondary" onClick={() => settle(() => settleSuspect(language, group.key, { type: "confirm" }))}>
          <Check strokeWidth={2} aria-hidden />
          {t("admin.resolve.suspects.yes")}
        </Button>
        <Button variant="outline" className="aria-expanded:border-brand-soft aria-expanded:bg-tint" aria-expanded={choosing} aria-controls={panelId} onClick={() => setChoosing((open) => !open)}>
          <Search strokeWidth={2} aria-hidden />
          {t("admin.resolve.suspects.choose")}
        </Button>
      </Actions>
      <div id={panelId}>
        {choosing ? (
          <FindWord
            language={language}
            onPick={(found) => settle(() => settleSuspect(language, group.key, { type: "choose", wordId: found.id }))}
            onCancel={() => setChoosing(false)}
          />
        ) : null}
      </div>
    </>
  );
}

function DuplicateItem({ pair, language, settle }: { pair: DuplicatePair; language: string; settle: (run: () => Promise<ResolveOutcome>) => void }) {
  const lemma = <Lat language={language}>{pair.existing.lemma}</Lat>;
  const decide = (isNewSense: boolean) => settle(() => settleDuplicate(language, pair.word.id, isNewSense));
  return (
    <>
      <Question>
        {pair.existing.meaning_fa
          ? tRich("admin.resolve.duplicates.question", { lemma, meaning: pair.existing.meaning_fa })
          : tRich("admin.resolve.duplicates.questionPlain", { lemma })}
      </Question>
      <dl className="bg-ground grid grid-cols-[auto_1fr] items-baseline gap-x-5 gap-y-2.5 rounded-[16px] px-4 py-3.5">
        <WordLine label={t("admin.resolve.duplicates.existing")} word={pair.existing} language={language} />
        <WordLine label={t("admin.resolve.duplicates.new")} word={pair.word} language={language} fresh />
      </dl>
      <Actions>
        <Button variant="secondary" onClick={() => decide(true)}>
          {t("admin.resolve.duplicates.yes")}
        </Button>
        <Button variant="outline" onClick={() => decide(false)}>
          {t("admin.resolve.duplicates.no")}
        </Button>
      </Actions>
      <p className="text-ink-3 -mt-1.5 text-[13.5px] leading-6">{t("admin.resolve.duplicates.noHint")}</p>
    </>
  );
}

function WordLine({ label, word, language, fresh }: { label: string; word: WordRef; language: string; fresh?: boolean }) {
  return (
    <>
      <dt className={cn("text-[13.5px] font-bold", fresh ? "text-brand-text" : "text-ink-3")}>{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
        <span className="text-ink text-[16px] font-bold">{word.meaning_fa ?? t("admin.resolve.duplicates.noMeaning")}</span>
        <span className="text-ink-3 text-[13.5px]">
          {joinDots([
            <Lat key="lemma" language={language} className="text-ink-2 text-[15px]">
              {word.lemma}
            </Lat>,
            posLabel(word.pos),
            <span key="level" className="lat">
              {word.level}
            </span>,
          ])}
        </span>
      </dd>
    </>
  );
}

/* ---------- Panels ---------- */

function AddWord({
  group,
  language,
  levels,
  onAdd,
  onCancel,
}: {
  group: CandidateGroup;
  language: string;
  levels: string[];
  onAdd: (action: CandidateAction) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [lemma, setLemma] = useState(group.word);
  const [pos, setPos] = useState<Pos | null>(group.pos);
  const [level, setLevel] = useState(group.level);
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!lemma.trim()) return setProblem(t("admin.resolve.candidates.lemmaMissing"));
    if (!pos) return setProblem(t("admin.resolve.candidates.posMissing"));
    onAdd({ type: "add", lemma: lemma.trim(), pos, level });
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="border-line-2 animate-in fade-in slide-in-from-top-1 flex flex-col gap-5 rounded-[18px] border p-4 duration-200 motion-reduce:animate-none sm:p-5"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor={`${id}-lemma`} className="text-ink text-[14.5px] font-bold">
          {t("admin.resolve.candidates.lemma")}
        </label>
        <Input
          id={`${id}-lemma`}
          dir="ltr"
          lang={language}
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={80}
          value={lemma}
          onChange={(event) => setLemma(event.target.value)}
          aria-describedby={`${id}-lemma-hint`}
          className="lat max-w-sm text-[18px]"
        />
        <p id={`${id}-lemma-hint`} className="text-ink-3 text-[13.5px] leading-6">
          {t("admin.resolve.candidates.lemmaHint")}
        </p>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink mb-2 text-[14.5px] font-bold">{t("admin.resolve.candidates.pos")}</legend>
        <div className="flex flex-wrap gap-1.5">
          {posValues.map((value) => (
            <label
              key={value}
              className="bg-tint text-ink-2 hover:text-ink has-checked:bg-brand has-checked:text-on-brand has-focus-visible:ring-ring/45 inline-flex h-9 cursor-pointer items-center rounded-[12px] px-3.5 text-[14px] font-bold transition-colors duration-150 has-focus-visible:ring-[3px]"
            >
              <input
                type="radio"
                name={`${id}-pos`}
                value={value}
                checked={pos === value}
                onChange={() => setPos(value)}
                className="sr-only"
              />
              {posLabel(value)}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-ink mb-2 text-[14.5px] font-bold">{t("admin.resolve.candidates.level")}</legend>
        <div className="bg-tint inline-grid w-fit grid-flow-col gap-1 rounded-[14px] p-1">
          {levels.map((value) => (
            <label
              key={value}
              className="text-ink-2 hover:text-ink has-checked:bg-surface dark:has-checked:bg-tint-2 has-checked:text-brand-text has-focus-visible:ring-ring/45 flex h-9 min-w-14 cursor-pointer items-center justify-center rounded-[11px] px-3 text-[15px] font-semibold transition-[background-color,color,box-shadow] duration-150 has-checked:shadow-[var(--shadow-1)] has-focus-visible:ring-[3px]"
            >
              <input
                type="radio"
                name={`${id}-level`}
                value={value}
                checked={level === value}
                onChange={() => setLevel(value)}
                className="sr-only"
              />
              <span className="lat">{value}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="text-ink-3 max-w-[62ch] text-[13.5px] leading-6">{t("admin.resolve.candidates.addHint")}</p>
      {problem ? (
        <p role="alert" className="text-bad -mt-2 flex items-center gap-1.5 text-[14px] font-bold">
          <CircleAlert className="size-4 shrink-0" strokeWidth={2} aria-hidden />
          {problem}
        </p>
      ) : null}
      <div className="grid gap-2 sm:flex">
        <Button type="submit">
          <Plus strokeWidth={2} aria-hidden />
          {t("admin.resolve.candidates.addConfirm")}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

/** Finds a vocabulary word as the admin types: its French or German form, or its Persian meaning. */
function FindWord({ language, onPick, onCancel }: { language: string; onPick: (word: WordRef) => void; onCancel: () => void }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WordRef[] | null>(null);
  const [searching, setSearching] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const ticket = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  function change(value: string) {
    setQuery(value);
    window.clearTimeout(timer.current);
    const text = value.trim();
    const mine = ++ticket.current;
    if (!text) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = window.setTimeout(async () => {
      const found = await findWords(language, text).catch(() => []);
      if (mine !== ticket.current) return;
      setResults(found);
      setSearching(false);
    }, 220);
  }

  return (
    <div className="border-line-2 animate-in fade-in slide-in-from-top-1 flex flex-col gap-3 rounded-[18px] border p-4 duration-200 motion-reduce:animate-none sm:p-5">
      <label htmlFor={`${id}-query`} className="text-ink text-[14.5px] font-bold">
        {t("admin.resolve.search.label")}
      </label>
      <div className="relative max-w-md">
        <Search className="text-ink-3 pointer-events-none absolute start-4 top-1/2 size-[18px] -translate-y-1/2" strokeWidth={2} aria-hidden />
        <Input
          id={`${id}-query`}
          type="text"
          enterKeyHint="search"
          dir="auto"
          autoFocus
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={60}
          value={query}
          onChange={(event) => change(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancel();
          }}
          placeholder={t("admin.resolve.search.placeholder")}
          aria-describedby={`${id}-status`}
          className="px-11"
        />
      </div>
      <p id={`${id}-status`} aria-live="polite" className="text-ink-3 flex items-center gap-1.5 text-[13.5px] leading-6 empty:-mt-3">
        {searching ? (
          <>
            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden />
            {t("admin.resolve.search.searching")}
          </>
        ) : results && results.length === 0 ? (
          t("admin.resolve.search.none")
        ) : null}
      </p>
      {results && results.length > 0 ? (
        <ul className="-mx-2 flex flex-col">
          {results.map((word) => (
            <li key={word.id}>
              <button
                type="button"
                onClick={() => onPick(word)}
                className="hover:bg-tint focus-visible:bg-tint focus-visible:ring-ring/45 flex min-h-12 w-full items-baseline gap-3 rounded-[12px] px-3 py-2.5 text-start transition-colors duration-150 outline-none focus-visible:ring-[3px]"
              >
                <Lat language={language} className="text-ink shrink-0 text-[17px]">
                  {word.lemma}
                </Lat>
                <span className="text-ink-3 shrink-0 text-[13px]">{posLabel(word.pos)}</span>
                <span className="text-ink-2 min-w-0 flex-1 truncate text-[14.5px]">{word.meaning_fa ?? ""}</span>
                <span className="lat text-ink-3 shrink-0 text-[13px]">{word.level}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

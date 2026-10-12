"use client";

import { useEffect, useId, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { Check, ChevronDown, CircleAlert, LoaderCircle, Trash2 } from "lucide-react";
import { CopyButton } from "@/components/admin/copy-button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatNumber, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { startBatch } from "../../create/actions";
import { chooseChatbot, pasteAnswer, pasteQa, skipRejected, startOver, throwAway, type PasteOutcome } from "./actions";

export type CountKey = "added" | "updated" | "skipped" | "dropped" | "rejected";
type Severity = "high" | "medium" | "low";

/** Everything the four steps show, prepared on the server (PRD §13.9). */
export type BatchView = {
  id: number;
  language: string;
  slug: string;
  step: 1 | 2 | 3 | 4 | 5;
  hasQa: boolean;
  chatbots: string[];
  /** The chatbot saved on the batch; null until the prompt is copied or an answer is pasted. */
  chatbot: string | null;
  defaultChatbot: string;
  prompt: string;
  /** Characters received so far when the answer was cut; null otherwise. */
  cutLength: number | null;
  report: {
    rounds: number;
    counts: { key: CountKey; value: number }[];
    rejected: { label: string; problems: string[] }[];
    dismissed: number;
    warnings: { label: string; text: string }[];
    issues: string[];
    accepted: string[];
  } | null;
  /** Items of this batch still waiting for the admin's decision (PRD §13.9), counted live. */
  open: { candidates: number; suspects: number; duplicates: number };
  fixPrompt: string | null;
  qaPrompt: string | null;
  qaDone: boolean;
  findings: { severity: Severity; label: string | null; problem: string; suggestion: string | null }[];
};

type StepState = "done" | "current" | "open" | "locked";

const SHOWN_REJECTED = 6;

/** Scrolls a step into view after the page refreshed with its result. */
function reveal(id: string) {
  const target = document.getElementById(id);
  if (!target) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  target.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
}

export function BatchFlow({ view }: { view: BatchView }) {
  const { report } = view;
  const rounds = report?.rounds ?? 0;
  const seen = useRef({ rounds, qaDone: view.qaDone });
  useEffect(() => {
    if (rounds > seen.current.rounds) reveal("step-3");
    else if (view.qaDone && !seen.current.qaDone) reveal("step-4");
    seen.current = { rounds, qaDone: view.qaDone };
  }, [rounds, view.qaDone]);

  const imported = report !== null;
  const [chatbot, setChatbot] = useState(view.defaultChatbot);
  const steps: Record<1 | 2 | 3 | 4, StepState> = {
    1: view.chatbot ? "done" : "current",
    2: imported ? "done" : view.step === 2 ? "current" : "open",
    3: !imported ? "locked" : report.rejected.length === 0 ? "done" : "current",
    4: !imported || !view.hasQa ? "locked" : view.qaDone ? "done" : view.step === 4 ? "current" : "open",
  };

  return (
    <div className="flex flex-col gap-4">
      <PromptStep key={String(imported)} view={view} state={steps[1]} chatbot={chatbot} onPick={setChatbot} />
      <PasteStep view={view} state={steps[2]} chatbot={chatbot} />
      <ReportStep view={view} state={steps[3]} />
      <QaStep view={view} state={steps[4]} />
      {view.step === 5 ? <Finished view={view} /> : null}
      {!imported ? <CancelBatch id={view.id} /> : null}
    </div>
  );
}

/* ---------- Building blocks ---------- */

function StepBadge({ n, state }: { n: number; state: StepState }) {
  return (
    <span
      aria-hidden
      className={cn(
        "num grid size-8 shrink-0 place-items-center rounded-full text-[14px] font-extrabold transition-colors duration-200",
        state === "done" && "bg-ok-soft text-ok",
        state === "current" && "bg-brand text-on-brand",
        (state === "open" || state === "locked") && "bg-tint text-ink-3",
      )}
    >
      {state === "done" ? <Check className="size-[17px]" strokeWidth={2.5} /> : formatNumber(n)}
    </span>
  );
}

function Step({
  n,
  title,
  state,
  note,
  toggle,
  children,
}: {
  n: number;
  title: string;
  state: StepState;
  /** A short line next to the title: what the step came to, or why it is not open yet. */
  note?: string;
  /** For a finished step: its body is hidden until asked for. */
  toggle?: { open: boolean; onToggle: () => void; show: string; hide: string };
  children?: ReactNode;
}) {
  const bodyId = useId();
  const showBody = children && (!toggle || toggle.open);
  return (
    <section
      id={`step-${n}`}
      aria-labelledby={`step-${n}-title`}
      className={cn(
        "scroll-mt-24 rounded-[22px]",
        state === "locked" ? "border-line-2 border border-dashed" : "bg-surface shadow-[var(--shadow-1)]",
      )}
    >
      <div className="flex min-h-[68px] items-center gap-3.5 px-5 py-3.5 sm:px-6">
        <StepBadge n={n} state={state} />
        <div className="flex min-w-0 flex-1 flex-col sm:flex-row sm:items-baseline sm:gap-3">
          <h2
            id={`step-${n}-title`}
            tabIndex={-1}
            className={cn("text-[16.5px] font-extrabold outline-none", state === "locked" ? "text-ink-3" : "text-ink")}
          >
            <span className="sr-only">{t("admin.batch.stepOf", { step: n, total: 4 })}: </span>
            {title}
          </h2>
          {note ? <p className="text-ink-3 text-[13.5px] leading-6">{note}</p> : null}
        </div>
        {toggle ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={toggle.open}
            aria-controls={bodyId}
            onClick={toggle.onToggle}
            className="-me-2"
          >
            {toggle.open ? toggle.hide : toggle.show}
          </Button>
        ) : null}
      </div>
      {showBody ? (
        <div id={bodyId} className="border-line flex flex-col gap-5 border-t px-5 pt-5 pb-6 sm:px-6">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function ErrorLine({ id, message }: { id?: string; message: string | null }) {
  return (
    <div id={id} aria-live="polite">
      {message ? (
        <p className="text-bad flex items-start gap-2 text-[14px] leading-6">
          <CircleAlert className="mt-[3px] size-4 shrink-0" aria-hidden />
          <span>{message}</span>
        </p>
      ) : null}
    </div>
  );
}

/** A box for pasting what the chatbot answered, with its own check button. */
function PasteBox({
  label,
  placeholder,
  submit,
  action,
  primary = true,
}: {
  label: string;
  placeholder: string;
  submit: string;
  action: (text: string) => Promise<PasteOutcome>;
  /** The main button of the page only on the step the admin is on. */
  primary?: boolean;
}) {
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      setError(t("admin.batch.paste.empty"));
      return;
    }
    start(async () => {
      const result = await action(text);
      setError(result.ok ? null : result.message);
      if (result.ok) setText("");
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor={id} className="text-ink-2 text-[13px] font-bold">
        {label}
      </label>
      <textarea
        id={id}
        value={text}
        onChange={(event) => setText(event.currentTarget.value)}
        dir={text ? "ltr" : "rtl"}
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder}
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-error`}
        className={cn(
          "border-input bg-surface text-ink placeholder:text-ink-3 h-44 min-h-28 w-full resize-y rounded-[16px] border px-4 py-3 text-[13.5px] leading-6 outline-none [unicode-bidi:plaintext]",
          "focus-visible:border-brand-soft focus-visible:ring-ring/30 transition-[border-color,box-shadow] focus-visible:ring-[3px]",
          "aria-invalid:border-bad aria-invalid:ring-bad/15 aria-invalid:ring-[3px]",
          text ? "font-mono" : "font-sans placeholder:text-[14.5px]",
        )}
      />
      <ErrorLine id={`${id}-error`} message={error} />
      <Button type="submit" variant={primary ? "default" : "secondary"} disabled={pending} className="w-fit">
        {pending ? <LoaderCircle className="motion-safe:animate-spin" strokeWidth={2} aria-hidden /> : null}
        {pending ? t("admin.batch.paste.working") : submit}
      </Button>
    </form>
  );
}

function Disclosure({
  summary,
  children,
  open,
  onToggle,
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
}) {
  return (
    <details
      open={open}
      onToggle={onToggle ? (event) => onToggle(event.currentTarget.open) : undefined}
      className="group flex flex-col"
    >
      <summary className="text-ink-2 hover:text-ink flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-[10px] py-1 text-[14.5px] font-bold transition-colors [&::-webkit-details-marker]:hidden">
        <ChevronDown className="disclose-chevron size-4" strokeWidth={2.25} aria-hidden />
        {summary}
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

/* ---------- Step 1: the prompt ---------- */

function PromptStep({
  view,
  state,
  chatbot,
  onPick,
}: {
  view: BatchView;
  state: StepState;
  chatbot: string;
  onPick: (name: string) => void;
}) {
  // After the answer is in, the prompt folds away; it stays one tap from reach.
  const collapsed = view.report !== null;
  const [showText, setShowText] = useState(false);
  const [open, setOpen] = useState(!collapsed);
  const [, start] = useTransition();
  const textRef = useRef<HTMLPreElement>(null);

  function pick(name: string) {
    onPick(name);
    // Once saved, a change is saved right away; before that it is saved with the copy.
    if (view.chatbot && view.chatbot !== name) start(() => chooseChatbot(view.id, name));
  }

  function selectText() {
    setShowText(true);
    requestAnimationFrame(() => {
      const node = textRef.current;
      if (!node) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      node.scrollIntoView({ block: "nearest" });
    });
  }

  return (
    <Step
      n={1}
      title={t("admin.batch.steps.prompt")}
      state={state}
      note={view.chatbot ? t("admin.batch.prompt.chosen", { bot: view.chatbot }) : undefined}
      toggle={
        collapsed
          ? { open, onToggle: () => setOpen(!open), show: t("admin.batch.prompt.show"), hide: t("admin.batch.prompt.hide") }
          : undefined
      }
    >
      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-ink-2 mb-2.5 text-[13px] font-bold">{t("admin.batch.prompt.chooseBot")}</legend>
        <div className="bg-tint grid w-full grid-flow-col gap-1 rounded-[16px] p-1 sm:w-fit sm:auto-cols-fr">
          {view.chatbots.map((name) => (
            <label key={name} className="relative">
              <input
                type="radio"
                name={`chatbot-${view.id}`}
                value={name}
                checked={chatbot === name}
                onChange={() => pick(name)}
                className="peer sr-only"
              />
              <span
                dir="ltr"
                className={cn(
                  "flex h-10 cursor-pointer items-center justify-center rounded-[12px] px-4 text-[14px] font-bold transition-[background-color,color,box-shadow] duration-150 sm:min-w-28",
                  "peer-focus-visible:ring-ring/45 peer-focus-visible:ring-[3px]",
                  chatbot === name ? "bg-surface dark:bg-tint-2 text-ink shadow-[var(--shadow-1)]" : "text-ink-2 hover:text-ink",
                )}
              >
                {name}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <CopyButton
          text={view.prompt}
          label={view.chatbot ? t("admin.batch.prompt.copyAgain") : t("admin.batch.prompt.copy")}
          variant={state === "current" ? "default" : "secondary"}
          size="lg"
          onCopied={() => {
            if (view.chatbot !== chatbot) start(() => chooseChatbot(view.id, chatbot));
          }}
          onFailed={selectText}
        />
        <span className="text-ink-3 num pt-4 text-[13px]">{t("admin.batch.prompt.size", { count: view.prompt.length })}</span>
      </div>
      <p className="text-ink-2 max-w-[62ch] text-[14.5px] leading-7">{t("admin.batch.prompt.hint")}</p>

      <Disclosure summary={t("admin.batch.prompt.show")} open={showText} onToggle={setShowText}>
        <pre
          ref={textRef}
          tabIndex={0}
          className="bg-tint text-ink-2 max-h-96 overflow-auto rounded-[16px] p-4 font-sans text-[13.5px] leading-7 whitespace-pre-wrap [unicode-bidi:plaintext]"
        >
          {view.prompt}
        </pre>
      </Disclosure>
    </Step>
  );
}

/* ---------- Step 2: paste the answer ---------- */

function PasteStep({ view, state, chatbot }: { view: BatchView; state: StepState; chatbot: string }) {
  const [, start] = useTransition();
  if (view.report) {
    return <Step n={2} title={t("admin.batch.steps.paste")} state="done" note={t("admin.batch.paste.summary")} />;
  }
  const cut = view.cutLength !== null;
  return (
    <Step n={2} title={t("admin.batch.steps.paste")} state={state}>
      {cut ? (
        <div className="bg-tint flex flex-col items-start gap-2 rounded-[16px] px-4 py-3.5">
          <p className="text-ink-2 text-[14.5px] leading-7">{t("admin.batch.paste.received", { count: view.cutLength ?? 0 })}</p>
          <Button type="button" variant="ghost" size="sm" className="-ms-3" onClick={() => start(() => startOver(view.id))}>
            {t("admin.batch.paste.startOver")}
          </Button>
        </div>
      ) : null}
      <PasteBox
        label={cut ? t("admin.batch.paste.continuation") : t("admin.batch.paste.label")}
        placeholder={cut ? t("admin.batch.paste.continuationPlaceholder") : t("admin.batch.paste.placeholder")}
        submit={t("admin.batch.paste.submit")}
        primary={state === "current"}
        action={(text) => pasteAnswer(view.id, { text, mode: "answer", chatbot: view.chatbot ? "" : chatbot })}
      />
    </Step>
  );
}

/* ---------- Step 3: the report ---------- */

function ReportStep({ view, state }: { view: BatchView; state: StepState }) {
  const { report } = view;
  const [, start] = useTransition();
  if (!report) {
    return <Step n={3} title={t("admin.batch.steps.report")} state="locked" note={t("admin.batch.qa.waitImport")} />;
  }
  const rejected = report.rejected.length;
  const { open } = view;
  const needsYou = open.candidates + open.suspects + open.duplicates > 0;

  return (
    <Step n={3} title={t("admin.batch.steps.report")} state={state}>
      <p className="text-ink flex items-start gap-2.5 text-[15px] leading-7 font-bold">
        {rejected ? (
          <CircleAlert className="text-bad mt-[5px] size-[18px] shrink-0" strokeWidth={2} aria-hidden />
        ) : (
          <Check className="text-ok mt-[5px] size-[18px] shrink-0" strokeWidth={2.5} aria-hidden />
        )}
        <span>
          {rejected
            ? t("admin.batch.report.someOut", { count: rejected })
            : report.dismissed
              ? t("admin.batch.report.dismissed", { count: report.dismissed })
              : t("admin.batch.report.allIn")}
        </span>
      </p>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-10">
        {report.counts.map(({ key, value }) => (
          <div key={key} className="flex flex-col-reverse gap-1">
            <dt className="text-ink-3 text-[13px] font-bold">{t(`admin.batch.report.counts.${key}`)}</dt>
            <dd className={cn("num text-[28px] leading-none font-extrabold", key === "rejected" ? "text-bad" : "text-ink")}>
              {formatNumber(value)}
            </dd>
          </div>
        ))}
      </dl>

      {rejected ? (
        <div className="flex flex-col gap-4">
          <h3 className="text-ink text-[15px] font-extrabold">{t("admin.batch.report.rejectedTitle")}</h3>
          <RejectedList items={report.rejected} />
          {view.fixPrompt ? (
            <div className="bg-tint/60 flex flex-col gap-4 rounded-[18px] p-4 sm:p-5">
              <div className="flex flex-col gap-2">
                <CopyButton text={view.fixPrompt} label={t("admin.batch.report.copyFix")} />
                <p className="text-ink-3 text-[13.5px] leading-6">{t("admin.batch.report.fixHint")}</p>
              </div>
              <PasteBox
                label={t("admin.batch.report.fixLabel")}
                placeholder={t("admin.batch.paste.placeholder")}
                submit={t("admin.batch.report.fixSubmit")}
                action={(text) => pasteAnswer(view.id, { text, mode: "fix", chatbot: "" })}
              />
            </div>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-ink-3 -ms-3 w-fit"
            onClick={() => start(() => skipRejected(view.id))}
          >
            {t("admin.batch.report.dismiss")}
          </Button>
        </div>
      ) : null}

      {needsYou ? (
        <div className="bg-tint flex flex-col items-start gap-3 rounded-[16px] px-4 py-3.5 text-[14.5px] leading-7 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col">
            {open.candidates + open.suspects > 0 ? (
              <p className="text-ink">{t("admin.batch.report.review", { candidates: open.candidates, suspects: open.suspects })}</p>
            ) : null}
            {open.duplicates ? <p className="text-ink">{t("admin.batch.report.duplicates", { count: open.duplicates })}</p> : null}
          </div>
          <Button asChild variant="secondary" size="sm" className="shrink-0">
            <Link href={`/admin/resolve?lang=${view.language}`}>{t("admin.batch.report.resolve")}</Link>
          </Button>
        </div>
      ) : null}

      {report.warnings.length || report.issues.length || report.accepted.length ? (
        <div className="flex flex-col gap-2">
          {report.warnings.length ? (
            <Disclosure summary={t("admin.batch.report.warnings", { count: report.warnings.length })}>
              <ul className="flex flex-col gap-2.5">
                {report.warnings.map((warning, index) => (
                  <li key={index} className="flex flex-col text-[14px] leading-6 sm:flex-row sm:gap-3">
                    <span className="lat text-ink shrink-0 font-semibold sm:min-w-32">{warning.label}</span>
                    <span className="text-ink-2">{warning.text}</span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}
          {report.issues.length ? (
            <Disclosure summary={`${t("admin.batch.report.notes")} (${formatNumber(report.issues.length)})`}>
              <ul className="text-ink-2 flex list-disc flex-col gap-1.5 ps-5 text-[14px] leading-6">
                {report.issues.map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
            </Disclosure>
          ) : null}
          {report.accepted.length ? (
            <Disclosure summary={t("admin.batch.report.accepted", { count: report.accepted.length })}>
              <ul className="flex flex-wrap gap-1.5">
                {report.accepted.slice(0, 400).map((label, index) => (
                  <li key={index} className="lat bg-tint text-ink rounded-[10px] px-2.5 py-0.5 text-[14px] leading-7">
                    {label}
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}
        </div>
      ) : null}
    </Step>
  );
}

function RejectedItem({ item }: { item: { label: string; problems: string[] } }) {
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3.5">
      <span className="lat text-ink w-fit text-[15.5px] font-semibold">{item.label}</span>
      <ul className="flex flex-col gap-1">
        {item.problems.map((text, index) => (
          <li key={index} className="text-ink-2 flex gap-2.5 text-[14px] leading-6">
            <span aria-hidden className="bg-bad mt-[9px] size-1.5 shrink-0 rounded-full" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function RejectedList({ items }: { items: { label: string; problems: string[] }[] }) {
  const first = items.slice(0, SHOWN_REJECTED);
  const rest = items.slice(SHOWN_REJECTED);
  const list = "border-line divide-line flex flex-col divide-y rounded-[18px] border";
  return (
    <div className="flex flex-col gap-2">
      <ul className={list}>
        {first.map((item, index) => (
          <RejectedItem key={index} item={item} />
        ))}
      </ul>
      {rest.length ? (
        <Disclosure summary={t("admin.batch.report.more", { count: rest.length })}>
          <ul className={list}>
            {rest.map((item, index) => (
              <RejectedItem key={index} item={item} />
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}

/* ---------- Step 4: quality check ---------- */

const severityStyle: Record<Severity, string> = {
  high: "bg-bad-soft text-bad",
  medium: "bg-tint-2 text-ink",
  low: "border-line-2 text-ink-3 border",
};

function QaStep({ view, state }: { view: BatchView; state: StepState }) {
  const title = t("admin.batch.steps.qa");
  if (!view.hasQa) return <Step n={4} title={title} state="locked" note={t("admin.batch.qa.notNeeded")} />;
  if (!view.report) return <Step n={4} title={title} state="locked" note={t("admin.batch.qa.waitImport")} />;

  if (view.qaDone) {
    const count = view.findings.length;
    return (
      <Step n={4} title={title} state="done" note={count ? t("admin.batch.qa.summary", { count }) : t("admin.batch.qa.none")}>
        {count ? (
          <>
            <p className="text-ink-2 text-[14.5px] leading-7">{t("admin.batch.qa.found", { count })}</p>
            {(["high", "medium", "low"] as const).map((severity) => {
              const items = view.findings.filter((finding) => finding.severity === severity);
              if (!items.length) return null;
              return (
                <section key={severity} className="flex flex-col gap-2.5">
                  <h3 className="flex items-center gap-2 text-[14px] font-extrabold">
                    <span className={cn("inline-flex h-7 items-center rounded-[9px] px-2.5", severityStyle[severity])}>
                      {t(`admin.batch.qa.severity.${severity}`)}
                    </span>
                    <span className="text-ink-3 num font-bold">{formatNumber(items.length)}</span>
                  </h3>
                  <ul className="border-line divide-line flex flex-col divide-y rounded-[18px] border">
                    {items.map((finding, index) => (
                      <li key={index} className="flex flex-col gap-1 px-4 py-3.5 text-[14px] leading-6">
                        {finding.label ? <span className="lat text-ink w-fit text-[15.5px] font-semibold">{finding.label}</span> : null}
                        <p className="text-ink-2">{finding.problem}</p>
                        {finding.suggestion ? (
                          <p className="text-ink-3">{t("admin.batch.qa.suggestion", { text: finding.suggestion })}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        ) : null}
      </Step>
    );
  }

  return (
    <Step n={4} title={title} state={state}>
      <p className="text-ink-2 max-w-[62ch] text-[14.5px] leading-7">{t("admin.batch.qa.lead")}</p>
      {view.qaPrompt ? (
        <CopyButton text={view.qaPrompt} label={t("admin.batch.qa.copy")} variant={state === "current" ? "default" : "secondary"} />
      ) : null}
      <PasteBox
        label={t("admin.batch.qa.label")}
        placeholder={t("admin.batch.paste.placeholder")}
        submit={t("admin.batch.qa.submit")}
        primary={state === "current"}
        action={(text) => pasteQa(view.id, text)}
      />
    </Step>
  );
}

/* ---------- The end, or throwing the batch away ---------- */

function Finished({ view }: { view: BatchView }) {
  return (
    <section
      aria-labelledby="finished-title"
      className="bg-surface flex flex-col gap-5 rounded-[22px] p-5 shadow-[var(--shadow-1)] sm:flex-row sm:items-center sm:p-6"
    >
      <div className="flex flex-1 items-start gap-3.5">
        <span aria-hidden className="bg-ok-soft text-ok grid size-10 shrink-0 place-items-center rounded-full">
          <Check className="size-5" strokeWidth={2.5} />
        </span>
        <div className="flex flex-col gap-0.5">
          <h2 id="finished-title" className="text-ink text-[16.5px] font-extrabold">
            {t("admin.batch.finished.title")}
          </h2>
          <p className="text-ink-2 text-[14.5px]">{t("admin.batch.finished.lead")}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <form action={startBatch}>
          <input type="hidden" name="kind" value={view.slug} />
          <input type="hidden" name="language" value={view.language} />
          <Button type="submit">{t("admin.batch.finished.next")}</Button>
        </form>
        <Button asChild variant="secondary">
          <Link href="/admin">{t("admin.batch.finished.workbench")}</Link>
        </Button>
      </div>
    </section>
  );
}

function CancelBatch({ id }: { id: number }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="text-ink-3 mt-2 w-fit">
          <Trash2 strokeWidth={1.75} aria-hidden />
          {t("admin.batch.cancel.action")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("admin.batch.cancel.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("admin.batch.cancel.body")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("admin.batch.cancel.keep")}</AlertDialogCancel>
          <form action={throwAway.bind(null, id)}>
            <ConfirmButton />
          </form>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending} className="w-full">
      {pending ? <LoaderCircle className="motion-safe:animate-spin" strokeWidth={2} aria-hidden /> : null}
      {t("admin.batch.cancel.confirm")}
    </Button>
  );
}

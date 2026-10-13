"use client";

import { Fragment } from "react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { PhonicsContext, PhonicsValues } from "@/server/content/library/edit/phonics";
import { AddButton, AreaField, Field, ListField, RowTools, Section, TextBox, TextField, move, rowErrors, useField, useForm } from "../form-kit";

/** A phonics lesson (PRD §8.1): the lists its kind needs, with the counts of import. */
export function PhonicsForm({ context }: { context: PhonicsContext }) {
  return (
    <>
      <Section>
        <TextField name="sound_label" voice="fa" />
        <ListField name="graphemes" voice="target" />
        <AreaField name="tip_fa" voice="fa" rows={4} />
      </Section>
      {context.kind !== "liaison" ? (
        <Section title={t("admin.library.phonics.words")} lead={t("admin.library.phonics.wordsLead")} columns={1}>
          <ExampleWords />
        </Section>
      ) : null}
      {context.kind === "contrast" ? (
        <Section title={t("admin.library.phonics.pairs")} lead={t("admin.library.phonics.pairsLead")} columns={1}>
          <MinimalPairs />
        </Section>
      ) : null}
      {context.kind === "liaison" ? (
        <Section title={t("admin.library.phonics.sentences")} lead={t("admin.library.phonics.sentencesLead")} columns={1}>
          <LiaisonSentences />
        </Section>
      ) : null}
    </>
  );
}

function ListShell({ name, children, onAdd, addLabel }: { name: string; children: React.ReactNode; onAdd: () => void; addLabel: string }) {
  const [, , errors] = useField<unknown[]>(name);
  return (
    <Field name={name} help={null} hideLabel errors={errors.filter((error) => error.path === name)} wide>
      <ol className="flex flex-col gap-2.5">{children}</ol>
      <AddButton onClick={onAdd} label={addLabel} />
    </Field>
  );
}

function RowCard({ children, errors }: { children: React.ReactNode; errors: { message: string }[] }) {
  return (
    <li className={cn("border-line flex flex-col gap-2 rounded-[16px] border p-3", errors.length > 0 && "border-bad/60")}>
      {children}
      {errors.length > 0 ? <span className="text-bad text-[13px] font-bold">{errors[0].message}</span> : null}
    </li>
  );
}

function ExampleWords() {
  const [words, setWords, errors] = useField<PhonicsValues["example_words"]>("example_words");
  const list = words ?? [];
  const update = (index: number, patch: Partial<PhonicsValues["example_words"][number]>) => setWords(list.map((word, k) => (k === index ? { ...word, ...patch } : word)));
  return (
    <ListShell name="example_words" onAdd={() => setWords([...list, { text: "", meaning_fa: "", wrong_spellings: ["", ""] }])} addLabel={t("admin.library.phonics.addWord")}>
      {list.map((word, index) => (
        <RowCard key={index} errors={rowErrors(errors, "example_words", index)}>
          <span className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <TextBox value={word.text} onChange={(next) => update(index, { text: next })} voice="target" className="flex-[1_1_10rem]" />
            <TextBox value={word.meaning_fa} onChange={(next) => update(index, { meaning_fa: next })} voice="fa" className="flex-[1_1_10rem]" />
            <RowTools index={index} count={list.length} onMove={(from, to) => setWords(move(list, from, to))} onRemove={(at) => setWords(list.filter((_, k) => k !== at))} />
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-ink-3 w-full text-[12.5px] font-bold sm:w-auto">{t("content.fields.wrong_spellings")}</span>
            {[0, 1].map((k) => (
              <TextBox
                key={k}
                value={word.wrong_spellings[k] ?? ""}
                onChange={(next) => update(index, { wrong_spellings: [0, 1].map((n) => (n === k ? next : (word.wrong_spellings[n] ?? ""))) })}
                voice="target"
                placeholder={t("admin.library.phonics.wrong", { n: k + 1 })}
                className="h-10 flex-[1_1_9rem] text-[15.5px]"
              />
            ))}
          </span>
        </RowCard>
      ))}
    </ListShell>
  );
}

function MinimalPairs() {
  const [pairs, setPairs, errors] = useField<PhonicsValues["minimal_pairs"]>("minimal_pairs");
  const list = pairs ?? [];
  const update = (index: number, patch: Partial<PhonicsValues["minimal_pairs"][number]>) => setPairs(list.map((pair, k) => (k === index ? { ...pair, ...patch } : pair)));
  return (
    <ListShell name="minimal_pairs" onAdd={() => setPairs([...list, { a: "", b: "", a_fa: "", b_fa: "" }])} addLabel={t("admin.library.phonics.addPair")}>
      {list.map((pair, index) => (
        <RowCard key={index} errors={rowErrors(errors, "minimal_pairs", index)}>
          <span className="flex items-start gap-2">
            <span className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
              {(["a", "b"] as const).map((side) => (
                <span key={side} className="flex min-w-0 flex-col gap-1.5">
                  <TextBox value={pair[side]} onChange={(next) => update(index, { [side]: next })} voice="target" />
                  <TextBox value={pair[`${side}_fa`]} onChange={(next) => update(index, { [`${side}_fa`]: next })} voice="fa" className="h-10 text-[14px]" />
                </span>
              ))}
            </span>
            <RowTools index={index} count={list.length} onRemove={(at) => setPairs(list.filter((_, k) => k !== at))} />
          </span>
        </RowCard>
      ))}
    </ListShell>
  );
}

function LiaisonSentences() {
  const { language } = useForm();
  const [sentences, setSentences, errors] = useField<PhonicsValues["liaison_sentences"]>("liaison_sentences");
  const list = sentences ?? [];
  const update = (index: number, patch: Partial<PhonicsValues["liaison_sentences"][number]>) =>
    setSentences(list.map((sentence, k) => (k === index ? { ...sentence, ...patch } : sentence)));
  return (
    <ListShell name="liaison_sentences" onAdd={() => setSentences([...list, { text: "", liaison_after_word_index: [] }])} addLabel={t("admin.library.phonics.addSentence")}>
      {list.map((sentence, index) => {
        const words = sentence.text.trim() ? sentence.text.trim().split(/\s+/) : [];
        const marks = new Set(sentence.liaison_after_word_index);
        const toggle = (at: number) =>
          update(index, { liaison_after_word_index: marks.has(at) ? [...marks].filter((value) => value !== at) : [...marks, at].sort((a, b) => a - b) });
        return (
          <RowCard key={index} errors={rowErrors(errors, "liaison_sentences", index)}>
            <span className="flex items-center gap-2">
              <TextBox
                value={sentence.text}
                onChange={(next) => {
                  const count = next.trim() ? next.trim().split(/\s+/).length : 0;
                  update(index, { text: next, liaison_after_word_index: sentence.liaison_after_word_index.filter((at) => at < count - 1) });
                }}
                voice="target"
              />
              <RowTools index={index} count={list.length} onRemove={(at) => setSentences(list.filter((_, k) => k !== at))} />
            </span>
            {words.length > 1 ? (
              <p dir="ltr" lang={language} className="lat text-ink flex flex-wrap items-center gap-y-1 px-1 text-[18px] leading-9">
                {words.map((word, at) => (
                  <Fragment key={at}>
                    <span>{word}</span>
                    {at < words.length - 1 ? (
                      <button
                        type="button"
                        aria-pressed={marks.has(at)}
                        aria-label={t("admin.library.phonics.gap", { word })}
                        onClick={() => toggle(at)}
                        className={cn(
                          "mx-0.5 grid h-8 w-6 place-items-center rounded-[8px] text-[18px] transition-colors",
                          marks.has(at) ? "bg-brand text-on-brand" : "text-ink-3/60 hover:bg-tint hover:text-brand-text",
                        )}
                      >
                        ‿
                      </button>
                    ) : null}
                  </Fragment>
                ))}
              </p>
            ) : null}
          </RowCard>
        );
      })}
    </ListShell>
  );
}

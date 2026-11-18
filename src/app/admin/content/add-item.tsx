"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, X } from "lucide-react";
import { FindWord } from "@/components/admin/find-word";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { t, type MessageKey } from "@/i18n";
import type { WordRef } from "@/server/content/resolve";
import { addSentenceByHand, addWordByHand, type AddOutcome } from "./actions";
import { itemHref } from "./links";

const POS = ["noun", "verb", "adj", "adv", "prep", "pron", "det", "conj", "num", "interj", "phrase"] as const;
const GENDERS: Record<string, string[]> = { fr: ["m", "f", "mf"], de: ["der", "die", "das"] };

const fieldClass = "bg-surface border-line-2 text-ink h-12 w-full rounded-[16px] border px-3 text-[15px] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30";

/**
 * «مورد تازه» in «همه محتوا» (owner's choice, DECISIONS.md): a word or phrase, or a practice sentence,
 * made by hand without a chatbot. The new draft opens in its full edit form.
 */
export function AddItem({ type, language, levels }: { type: "words" | "sentences"; language: string; levels: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
        <Plus strokeWidth={2.25} aria-hidden />
        {t(`admin.library.add.${type}`)}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{t(`admin.library.add.${type}`)}</SheetTitle>
            <SheetDescription>{t(`admin.library.add.${type}Lead`)}</SheetDescription>
          </SheetHeader>
          <div className="px-5 pb-6">{type === "words" ? <WordForm language={language} levels={levels} /> : <SentenceForm language={language} />}</div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function useAdd(language: string, type: "words" | "sentences") {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [existing, setExisting] = useState<number | null>(null);
  const submit = (send: () => Promise<AddOutcome>) =>
    start(async () => {
      setMessage(null);
      setExisting(null);
      const outcome = await send();
      if (outcome.state === "added") router.push(itemHref(type, outcome.id));
      else if (outcome.state === "exists") {
        setExisting(outcome.id);
        setMessage(t(`admin.library.add.exists.${type}`));
      } else if (outcome.state === "invalid") setMessage(outcome.errors.map((error) => error.message).join(" "));
      else setMessage(t("admin.library.result.failed"));
    });
  return { pending, message, existing, submit, open: (id: number) => router.push(itemHref(type, id)), language };
}

function Problem({ message, existing, onOpen }: { message: string | null; existing: number | null; onOpen: (id: number) => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="text-bad flex flex-col items-start gap-2 text-[14px] leading-7 font-bold">
      <p>{message}</p>
      {existing ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => onOpen(existing)}>
          {t("admin.library.add.openExisting")}
        </Button>
      ) : null}
    </div>
  );
}

function WordForm({ language, levels }: { language: string; levels: string[] }) {
  const add = useAdd(language, "words");
  const [lemma, setLemma] = useState("");
  const [pos, setPos] = useState<(typeof POS)[number]>("noun");
  const [level, setLevel] = useState(levels[0] ?? "A1");
  const [gender, setGender] = useState("");
  const [meaning, setMeaning] = useState("");
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.submit(() => addWordByHand(language, { lemma, pos, level, gender, meaning_fa: meaning }));
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-ink-2 text-[13px] font-bold">{t("admin.library.add.lemma")}</span>
        <Input dir="ltr" lang={language} className="lat text-[17px]" value={lemma} onChange={(event) => setLemma(event.target.value)} required maxLength={80} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-ink-2 text-[13px] font-bold">{t("admin.library.add.pos")}</span>
          <select className={fieldClass} value={pos} onChange={(event) => setPos(event.target.value as (typeof POS)[number])}>
            {POS.map((value) => (
              <option key={value} value={value}>
                {t(`content.pos.${value}` as MessageKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-ink-2 text-[13px] font-bold">{t("admin.library.add.level")}</span>
          <select className={fieldClass} value={level} onChange={(event) => setLevel(event.target.value)}>
            {levels.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {pos === "noun" ? (
        <label className="flex flex-col gap-1.5">
          <span className="text-ink-2 text-[13px] font-bold">{t("admin.library.add.gender")}</span>
          <select className={fieldClass} value={gender} onChange={(event) => setGender(event.target.value)}>
            <option value="">{t("admin.library.add.genderLater")}</option>
            {(GENDERS[language] ?? []).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="flex flex-col gap-1.5">
        <span className="text-ink-2 text-[13px] font-bold">{t("admin.library.add.meaning")}</span>
        <Input value={meaning} onChange={(event) => setMeaning(event.target.value)} maxLength={200} />
        <span className="text-ink-3 text-[12.5px]">{t("admin.library.add.meaningHint")}</span>
      </label>
      <Problem message={add.message} existing={add.existing} onOpen={add.open} />
      <Button type="submit" disabled={add.pending || !lemma.trim()}>
        {add.pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
        {t("admin.library.add.make")}
      </Button>
    </form>
  );
}

function SentenceForm({ language }: { language: string }) {
  const add = useAdd(language, "sentences");
  const [text, setText] = useState("");
  const [translation, setTranslation] = useState("");
  const [target, setTarget] = useState<WordRef | null>(null);
  const [finding, setFinding] = useState(false);
  const [wrong, setWrong] = useState(["", "", ""]);
  const ready = text.trim() && translation.trim() && (!target || wrong.every((item) => item.trim()));
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.submit(() => addSentenceByHand(language, { text, translation_fa: translation, target: target?.code ?? "", distractors: target ? wrong : [] }));
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-ink-2 text-[13px] font-bold">{t("admin.library.add.sentence")}</span>
        <Input dir="ltr" lang={language} className="lat text-[17px]" value={text} onChange={(event) => setText(event.target.value)} required maxLength={300} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-ink-2 text-[13px] font-bold">{t("admin.library.add.translation")}</span>
        <Input value={translation} onChange={(event) => setTranslation(event.target.value)} required maxLength={400} />
      </label>
      <div className="flex flex-col gap-2">
        <span className="text-ink-2 text-[13px] font-bold">{t("admin.library.add.target")}</span>
        <p className="text-ink-3 text-[12.5px] leading-6">{t("admin.library.add.targetHint")}</p>
        {target ? (
          <div className="bg-tint flex items-center gap-2 rounded-[14px] px-3 py-2">
            <bdi dir="ltr" lang={language} className="lat text-ink text-[16px] font-semibold">
              {target.lemma}
            </bdi>
            <span className="text-ink-2 text-[13px]">{target.meaning_fa}</span>
            <Button type="button" variant="ghost" size="icon-sm" className="ms-auto" onClick={() => setTarget(null)}>
              <X strokeWidth={2} aria-hidden />
              <span className="sr-only">{t("admin.library.add.noTarget")}</span>
            </Button>
          </div>
        ) : finding ? (
          <FindWord
            language={language}
            onPick={(word) => {
              setTarget(word);
              setFinding(false);
            }}
            onCancel={() => setFinding(false)}
          />
        ) : (
          <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setFinding(true)}>
            {t("admin.library.add.pickTarget")}
          </Button>
        )}
      </div>
      {target ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-ink-2 mb-1.5 text-[13px] font-bold">{t("admin.library.add.distractors")}</legend>
          {wrong.map((value, index) => (
            <Input
              key={index}
              dir="ltr"
              lang={language}
              className="lat"
              aria-label={t("admin.library.add.distractor", { n: index + 1 })}
              value={value}
              onChange={(event) => setWrong(wrong.map((item, at) => (at === index ? event.target.value : item)))}
              required
              maxLength={80}
            />
          ))}
          <span className="text-ink-3 text-[12.5px] leading-6">{t("admin.library.add.distractorsHint")}</span>
        </fieldset>
      ) : null}
      <Problem message={add.message} existing={add.existing} onOpen={add.open} />
      <Button type="submit" disabled={add.pending || !ready}>
        {add.pending ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : null}
        {t("admin.library.add.make")}
      </Button>
    </form>
  );
}

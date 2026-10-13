"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Combine, LoaderCircle, Timer } from "lucide-react";
import { joinTextAction, syncTextAction } from "@/app/admin/audio/actions";
import { itemHref } from "@/app/admin/content/links";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import type { ItemAudio, SlotView } from "@/server/content/audio/view";
import { uploadAudio, type Prepared } from "./browser-audio";
import { AudioCard, AudioRow, NoticeLine, playingAsset } from "./slot-controls";
import { TextSync } from "./text-sync";
import { useNotice } from "./use-capture";

type TextAudioView = Extract<ItemAudio, { kind: "text" }>;
type PhonicsAudioView = Extract<ItemAudio, { kind: "phonics" }>;

/** The audio part of an item's edit page, by the shape of its audio. */
export function ItemAudioPanel({ audio, language }: { audio: ItemAudio; language: string }) {
  switch (audio.kind) {
    case "single":
      return <AudioCard slot={audio.slot} language={language} />;
    case "text":
      return <TextAudio audio={audio} language={language} />;
    case "phonics":
      return <PhonicsAudio audio={audio} language={language} />;
  }
}

type Syncing = { url: string; durationMs: number; initial?: number[]; fresh?: { prepared: Prepared; heard: boolean }; which: "human" | "machine" };

/**
 * A text's audio (PRD §13.8): one whole file with the start of each sentence, made by «هم‌زمان‌سازی»
 * or joined from the sentences' own files, which are recorded one by one in the list below.
 */
function TextAudio({ audio, language }: { audio: TextAudioView; language: string }) {
  const router = useRouter();
  const [syncing, setSyncing] = useState<Syncing | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useNotice();
  const [joining, startJoin] = useTransition();
  const textId = audio.slot.id;
  const sentences = audio.sentences.map((sentence) => sentence.text);
  const asset = playingAsset(audio.slot);
  const which = audio.slot.playing === "machine" ? "machine" : "human";

  const close = () => {
    if (syncing?.fresh) URL.revokeObjectURL(syncing.fresh.prepared.url);
    setSyncing(null);
  };

  const sendFresh = async (prepared: Prepared, heard: boolean, offsetsMs: number[]) => {
    setSaving(true);
    const reply = await uploadAudio(audio.slot.key, prepared.mp3, { heard, offsetsMs });
    setSaving(false);
    if (reply.state !== "saved") {
      setNotice({ ok: false, message: t(reply.state === "invalid" && reply.reason === "offsets" ? "admin.audio.errors.offsets" : "admin.audio.errors.upload") });
      return false;
    }
    URL.revokeObjectURL(prepared.url);
    setNotice({ ok: true, message: t("admin.audio.review.saved") });
    router.refresh();
    return true;
  };

  const ready = (prepared: Prepared, heard: boolean) => {
    setNotice(null);
    // One sentence starts at 0; nothing to mark.
    if (sentences.length <= 1) void sendFresh(prepared, heard, [0]);
    else setSyncing({ url: prepared.url, durationMs: prepared.durationMs, fresh: { prepared, heard }, which: "human" });
  };

  const save = async (offsetsMs: number[]) => {
    if (!syncing) return;
    if (syncing.fresh) {
      if (await sendFresh(syncing.fresh.prepared, syncing.fresh.heard, offsetsMs)) setSyncing(null);
      return;
    }
    setSaving(true);
    const outcome = await syncTextAction(textId, syncing.which, offsetsMs);
    setSaving(false);
    setNotice(outcome);
    if (outcome.ok) {
      setSyncing(null);
      router.refresh();
    }
  };

  const withFile = audio.sentences.filter((sentence) => sentence.slot.human && !sentence.slot.human.stale).length;
  const offsets = which === "human" ? audio.offsets.human : audio.offsets.machine;

  return (
    <div className="flex flex-col gap-4">
      {syncing ? (
        <TextSync
          url={syncing.url}
          durationMs={syncing.durationMs}
          sentences={sentences}
          language={language}
          initial={syncing.initial}
          saving={saving}
          onSave={(marks) => void save(marks)}
          onCancel={close}
        />
      ) : (
        <AudioCard
          slot={audio.slot}
          language={language}
          title={t("admin.audio.text.whole")}
          onReady={ready}
          keepLabel={sentences.length > 1 ? t("admin.audio.text.sync") : undefined}
        >
          {asset && asset.durationMs && sentences.length > 1 ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setSyncing({ url: asset.url, durationMs: asset.durationMs ?? 0, initial: offsets.length === sentences.length ? offsets : undefined, which })}
            >
              <Timer strokeWidth={2} aria-hidden />
              {t("admin.audio.text.syncAgain")}
            </Button>
          ) : null}
          <NoticeLine notice={notice} />
        </AudioCard>
      )}

      <section className="bg-surface flex flex-col gap-4 rounded-[22px] px-5 py-6 shadow-[var(--shadow-1)] sm:px-7">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-ink text-[17px] font-extrabold">{t("admin.audio.text.bySentence")}</h2>
          <span className="text-ink-3 text-[13px] font-bold">{t("admin.audio.text.sentencesReady", { count: withFile, total: audio.sentences.length })}</span>
        </div>
        <p className="text-ink-3 -mt-2 text-[13.5px] leading-6">{t("admin.audio.text.lead")}</p>
        <ol className="divide-line flex flex-col divide-y">
          {audio.sentences.map((sentence, index) => (
            <AudioRow
              key={sentence.id}
              slot={sentence.slot}
              language={language}
              label={t("admin.audio.text.sentence", { number: index + 1 })}
              href={itemHref("sentences", sentence.id)}
            />
          ))}
        </ol>
        <Button
          type="button"
          variant="secondary"
          className="w-fit"
          disabled={joining || withFile < audio.sentences.length || audio.sentences.length === 0}
          onClick={() =>
            startJoin(async () => {
              const outcome = await joinTextAction(textId);
              setNotice(outcome);
              router.refresh();
            })
          }
        >
          {joining ? <LoaderCircle className="animate-spin motion-reduce:animate-none" strokeWidth={2} aria-hidden /> : <Combine strokeWidth={2} aria-hidden />}
          {t("admin.audio.text.join")}
        </Button>
      </section>
    </div>
  );
}

/** Every sound of a phonics lesson, in the lesson's groups (PRD §8.5). */
function PhonicsAudio({ audio, language }: { audio: PhonicsAudioView; language: string }) {
  const all = audio.groups.flatMap((group) => group.slots);
  const withFile = all.filter((slot) => playingAsset(slot) !== null).length;
  const label = (slot: SlotView) => (slot.part && slot.index !== null ? t(`admin.audio.parts.${slot.part}`, { number: slot.index + 1 }) : undefined);
  return (
    <section className="bg-surface flex flex-col gap-5 rounded-[22px] px-5 py-6 shadow-[var(--shadow-1)] sm:px-7">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-ink text-[17px] font-extrabold">{t("admin.audio.phonics.title")}</h2>
          <span className="text-ink-3 text-[13px] font-bold">{t("admin.audio.phonics.ready", { count: withFile, total: all.length })}</span>
        </div>
        <p className="text-ink-3 text-[13.5px] leading-6">{t("admin.audio.phonics.lead")}</p>
      </div>
      {audio.groups.map((group) => (
        <div key={group.part} className="flex flex-col">
          <h3 className="text-ink-2 text-[13.5px] font-extrabold">{t(`admin.audio.phonics.groups.${group.part}`)}</h3>
          <ol className="divide-line flex flex-col divide-y">
            {group.slots.map((slot) => (
              <AudioRow key={slot.key} slot={slot} language={language} label={label(slot)} />
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}

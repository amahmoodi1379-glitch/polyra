"use server";

import { revalidatePath } from "next/cache";
import { t } from "@/i18n";
import { requireAdmin } from "@/server/auth/session";
import { parseSlot } from "@/server/content/audio/slots";
import { matchFiles, type FileMatch } from "@/server/content/audio/match";
import { joinTextAudio, markHeard, removeHumanAudio, setTextOffsets } from "@/server/content/audio/store";
import { isLanguage } from "@/server/content/languages";
import { logError } from "@/server/errors";

/** What an audio button shows after it ran: a plain Persian line, good or bad. */
export type AudioOutcome = { ok: boolean; message: string };

const failed = (): AudioOutcome => ({ ok: false, message: t("admin.audio.failed") });

async function run(where: string, work: (adminId: number) => Promise<AudioOutcome>): Promise<AudioOutcome> {
  const admin = await requireAdmin();
  try {
    const outcome = await work(admin.id);
    revalidatePath("/admin", "layout");
    return outcome;
  } catch (error) {
    await logError(where, error, { userId: admin.id });
    return failed();
  }
}

/** «برداشتن صدای انسانی»: the machine file plays again (PRD §13.8). */
export async function removeHumanAction(slotKey: string): Promise<AudioOutcome> {
  return run("audio.removeHuman", async (adminId) => {
    const slot = parseSlot(slotKey);
    if (!slot) return failed();
    const result = await removeHumanAudio(slot, adminId);
    return result.state === "done" ? { ok: true, message: t("admin.audio.removed") } : { ok: false, message: t("admin.audio.gone") };
  });
}

/** «شنیدم، درست است» on one file, or taking it back (PRD §13.4). */
export async function heardAction(assetId: number, heard: boolean): Promise<AudioOutcome> {
  return run("audio.heard", async (adminId) => {
    const result = await markHeard(assetId, adminId, heard);
    return result.state === "done" ? { ok: true, message: t(heard ? "admin.audio.heardDone" : "admin.audio.unheardDone") } : { ok: false, message: t("admin.audio.gone") };
  });
}

/** A text's human file made from its sentences' human recordings (PRD §13.8 «جمله‌به‌جمله»). */
export async function joinTextAction(textId: number): Promise<AudioOutcome> {
  return run("audio.join", async (adminId) => {
    const result = await joinTextAudio(textId, "human", adminId);
    if (result.state === "saved") return { ok: true, message: t("admin.audio.text.joined") };
    if (result.state === "incomplete") return { ok: false, message: t("admin.audio.text.incomplete", { count: result.missing.length }) };
    return result.state === "missing" ? { ok: false, message: t("admin.audio.gone") } : failed();
  });
}

/** «هم‌زمان‌سازی» saved on a stored text file. */
export async function syncTextAction(textId: number, which: "human" | "machine", offsetsMs: number[]): Promise<AudioOutcome> {
  return run("audio.sync", async (adminId) => {
    const result = await setTextOffsets(textId, which, offsetsMs, adminId);
    if (result.state === "done") return { ok: true, message: t("admin.audio.text.synced") };
    return result.state === "missing" ? { ok: false, message: t("admin.audio.gone") } : { ok: false, message: t("admin.audio.text.badOffsets") };
  });
}

/** «آپلود دسته‌ای»: the place each file name is for, or the nearest ones to choose from. */
export async function matchFilesAction(language: string, names: string[]): Promise<FileMatch[] | null> {
  const admin = await requireAdmin();
  if (!isLanguage(language) || names.length > 500) return null;
  try {
    return await matchFiles(
      language,
      names.map((name) => String(name).slice(0, 300)),
    );
  } catch (error) {
    await logError("audio.match", error, { userId: admin.id });
    return null;
  }
}

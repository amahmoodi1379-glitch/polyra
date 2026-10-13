import { AUDIO_RATE, SILENCE_DB } from "@/lib/audio/standard";

/**
 * The browser side of a recording or an uploaded file (PRD §13.8): decode it at the app's rate, mix it
 * to one channel, then trim, even out and write it as the app's mp3 (src/lib/audio/prepare.ts). The
 * server only checks the result, so every stored file is made by the same code.
 */

export type Prepared = { mp3: Uint8Array; durationMs: number; url: string };
export type PrepareError = "decode" | "silent" | "failed";

/** Mono samples at AUDIO_RATE; decoding at that rate also resamples. */
async function decode(blob: Blob): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, 1, AUDIO_RATE);
  const buffer = await context.decodeAudioData(await blob.arrayBuffer());
  if (buffer.numberOfChannels === 1) return buffer.getChannelData(0).slice();
  const mixed = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) mixed[i] += data[i] / buffer.numberOfChannels;
  }
  return mixed;
}

function inWorker(pcm: Float32Array): Promise<{ mp3: Uint8Array; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./prepare.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<{ ok: boolean; mp3?: Uint8Array; durationMs?: number }>) => {
      worker.terminate();
      if (event.data.ok && event.data.mp3) resolve({ mp3: event.data.mp3, durationMs: event.data.durationMs ?? 0 });
      else reject(new Error("prepare failed"));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message));
    };
    worker.postMessage(pcm, [pcm.buffer]);
  });
}

/** Any audio the browser can play (mp3, m4a, wav, ogg, a recording) in the app's format, ready to send. */
export async function prepareAudio(blob: Blob): Promise<{ ok: true; prepared: Prepared } | { ok: false; error: PrepareError }> {
  let pcm: Float32Array;
  try {
    pcm = await decode(blob);
  } catch {
    return { ok: false, error: "decode" };
  }
  // Nothing above the silence line: the microphone was off or the file is empty.
  const floor = 10 ** (SILENCE_DB / 20);
  if (!pcm.some((sample) => Math.abs(sample) > floor)) return { ok: false, error: "silent" };
  try {
    const { mp3, durationMs } = await inWorker(pcm);
    return { ok: true, prepared: { mp3, durationMs, url: URL.createObjectURL(new Blob([mp3 as BlobPart], { type: "audio/mpeg" })) } };
  } catch {
    return { ok: false, error: "failed" };
  }
}

export type UploadReply = { state: "saved"; assetId: number } | { state: "invalid"; reason: string } | { state: "missing" | "denied" | "error" };

/** Sends a prepared file to its place (src/app/admin/audio/upload/route.ts). */
export async function uploadAudio(slot: string, mp3: Uint8Array, options: { heard: boolean; offsetsMs?: number[] }): Promise<UploadReply> {
  const query = new URLSearchParams({ slot, which: "human", heard: options.heard ? "1" : "0" });
  if (options.offsetsMs) query.set("offsets", options.offsetsMs.join(","));
  try {
    const response = await fetch(`/admin/audio/upload?${query}`, { method: "POST", body: mp3 as BodyInit, headers: { "Content-Type": "audio/mpeg" } });
    return (await response.json()) as UploadReply;
  } catch {
    return { state: "error" };
  }
}

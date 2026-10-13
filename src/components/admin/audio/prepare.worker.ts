import { prepareSpeech } from "@/lib/audio/prepare";

/** Runs the audio preparation (src/lib/audio/prepare.ts) off the page, so a long text does not freeze it. */
type Scope = { onmessage: ((event: MessageEvent<Float32Array>) => void) | null; postMessage(message: unknown, transfer?: Transferable[]): void };
const scope = globalThis as unknown as Scope;

scope.onmessage = (event) => {
  try {
    const { mp3, durationMs } = prepareSpeech(event.data);
    scope.postMessage({ ok: true, mp3, durationMs }, [mp3.buffer]);
  } catch {
    scope.postMessage({ ok: false });
  }
};

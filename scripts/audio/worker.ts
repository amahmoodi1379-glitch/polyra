import "dotenv/config";
import { hostname } from "node:os";
import { allVoices } from "@/lib/audio/voices";
import { MachineGenerator } from "@/server/content/audio/generate";
import { releaseLease } from "@/server/content/audio/machine";
import { db } from "@/server/db";
import { logError } from "@/server/errors";
import { missingParts, modelPath, piperBin, VoicePool } from "./piper";

/**
 * The machine-voice generator (DECISIONS.md, 18 Nov 2026): runs beside the app on the server
 * (docker-entrypoint.sh starts it on one processor with the lowest CPU and disk priority), one file at a time, and
 * fills every approved or published word, sentence, text and phonics item with our own Piper voices.
 * `npm run audio` runs it on a developer's machine; `-- --once` stops when nothing is left.
 */

const IDLE_MS = 60_000;
/** After each file, rest as long as it took: the generator uses at most about half of one processor. */
const REST = 1;
/** A voice not used for this long is closed, to give its memory back. */
const CLOSE_AFTER_MS = 2 * 60_000;

const sleep = (ms: number, stop: () => boolean) =>
  new Promise<void>((resolve) => {
    const started = Date.now();
    const tick = setInterval(() => {
      if (stop() || Date.now() - started >= ms) {
        clearInterval(tick);
        resolve();
      }
    }, 500);
  });

async function main() {
  const once = process.argv.includes("--once");
  const owner = `${hostname()}:${process.pid}`;
  let stopping = false;
  const stop = () => stopping;
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => (stopping = true));

  const missing = missingParts(allVoices);
  // Without the program no voice speaks; without a model only that voice is silent.
  const noProgram = missing.includes(piperBin());
  const silent = new Set(allVoices.filter((voice) => noProgram || missing.some((part) => part.startsWith(modelPath(voice)))).map((voice) => voice.id));
  if (missing.length > 0) console.warn(`Machine voice: not found: ${missing.join(", ")}`);

  const pool = new VoicePool();
  const generator = new MachineGenerator(owner, async (voice, line) => (await pool.get(voice)).say(line), {
    rest: REST,
    silent,
    missing,
    onError: async (job, error) => void (await logError("audio.machine", error, { seed: `audio.machine:${job.key}` })),
  });

  let idleSince = Date.now();
  while (!stopping) {
    const result = await generator.pass(stop).catch(async (error) => {
      await logError("audio.machine", error);
      return null;
    });
    if (result && result.made + result.failed > 0) {
      idleSince = Date.now();
      console.log(`Machine voice: ${result.made} made, ${result.failed} failed, ${result.left} left.`);
      continue;
    }
    if (Date.now() - idleSince > CLOSE_AFTER_MS) pool.close();
    if (once && result?.held) break;
    await sleep(IDLE_MS, stop);
  }
  pool.close();
  await releaseLease(owner).catch(() => undefined);
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

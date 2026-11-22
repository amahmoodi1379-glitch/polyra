import { prepareSpeech } from "@/lib/audio/prepare";
import { resample } from "@/lib/audio/resample";
import { AUDIO_RATE } from "@/lib/audio/standard";
import { voiceById, type MachineVoice } from "@/lib/audio/voices";
import { readWav } from "@/lib/audio/wav";
import { loadPlanSlots, planMachineAudio, saveGeneratorState, takeLease, type AudioType, type GeneratorState, type Job, type MachinePlan } from "./machine";
import { joinMachineText, storeMachineAudio, type MachineResult } from "./store";

/**
 * The machine-voice generator's work, apart from the voice itself (scripts/audio/worker.ts gives it
 * Piper; tests give it a tone). Each pass reads the to-do list again, so new content, edits and a
 * teacher's removals are picked up within a minute or two, and a restart simply goes on from the
 * database.
 */

/** Speaks one line with a voice and returns a WAV file. */
export type Speak = (voice: MachineVoice, line: string) => Promise<Uint8Array>;

const typeOf: Record<Job["slot"]["kind"], AudioType> = { word: "words", sentence: "sentences", text: "texts", phonics: "phonics" };

/** One file made and stored: Piper's WAV brought to the app's format exactly like a teacher's upload. */
export async function makeMachineFile(job: Job, speak: Speak): Promise<MachineResult> {
  if (job.kind === "join") return joinMachineText(job.slot.id, job.parts, job.madeFrom);
  const voice = voiceById(job.voice);
  if (!voice) return { state: "invalid", reason: "voice" };
  const wav = readWav(await speak(voice, job.text));
  const { mp3 } = prepareSpeech(resample(wav.pcm, wav.rate, AUDIO_RATE));
  return storeMachineAudio({ slot: job.slot, bytes: mp3, voice: job.voice, madeFrom: job.text });
}

export type GeneratorOptions = {
  /** How long the right to work lasts before it must be renewed. */
  leaseMs?: number;
  /** Longest stretch of work before the list is read again. */
  lookEveryMs?: number;
  /** Most jobs taken from one reading of the list. */
  batch?: number;
  /**
   * After each file, a pause this many times as long as the file took, so the server keeps spare
   * time for learners even when the generator has a lot to do. 0 (tests) does not pause.
   */
  rest?: number;
  /** Voices that cannot speak here (their model is missing): their jobs wait. */
  silent?: Set<string>;
  /** What could not be found, shown on the «صدا» page. */
  missing?: string[];
  onError?: (job: Job, error: unknown) => Promise<void>;
};

export type PassResult = { held: boolean; made: number; failed: number; left: number };

/** A slot that failed twice with the same text waits until the generator restarts. */
const TRIES = 2;
const jobId = (job: Job) => `${job.key}|${job.kind === "say" ? `${job.voice}|${job.text}` : job.madeFrom}`;

export class MachineGenerator {
  made = 0;
  failed = 0;
  lastMadeAt: Date | null = null;
  private failures = new Map<string, number>();

  constructor(
    private readonly owner: string,
    private readonly speak: Speak,
    private readonly options: GeneratorOptions = {},
  ) {}

  private usable(job: Job) {
    if ((this.failures.get(jobId(job)) ?? 0) >= TRIES) return false;
    return job.kind === "join" || !this.options.silent?.has(job.voice);
  }

  private async save(plan: MachinePlan, phase: GeneratorState["phase"]) {
    await saveGeneratorState(this.owner, {
      phase,
      checkedAt: new Date().toISOString(),
      lastMadeAt: this.lastMadeAt?.toISOString() ?? null,
      made: this.made,
      failed: this.failed,
      languages: plan.languages,
      ...(this.options.missing?.length ? { missing: this.options.missing } : {}),
    });
  }

  /** One look at the list and up to one batch of files. `held: false` when another process holds the work. */
  async pass(shouldStop: () => boolean = () => false): Promise<PassResult> {
    const leaseMs = this.options.leaseMs ?? 3 * 60_000;
    if (!(await takeLease(this.owner, leaseMs))) return { held: false, made: 0, failed: 0, left: 0 };
    const plan = planMachineAudio(await loadPlanSlots());
    const jobs = plan.jobs.filter((job) => this.usable(job));
    const unavailable = jobs.length === 0 && plan.jobs.some((job) => job.kind === "say" && this.options.silent?.has(job.voice));
    await this.save(plan, jobs.length > 0 ? "working" : unavailable ? "unavailable" : "idle");
    if (jobs.length === 0) return { held: true, made: 0, failed: 0, left: 0 };

    // One voice after another, so each is loaded once per batch; joins need no voice.
    const batch = jobs.slice(0, this.options.batch ?? 100);
    const voiceOf = (job: Job) => (job.kind === "say" ? job.voice : "");
    const order = [...new Set(batch.map(voiceOf))];
    batch.sort((a, b) => order.indexOf(voiceOf(a)) - order.indexOf(voiceOf(b)));

    const started = Date.now();
    let renewed = started;
    let made = 0;
    let failed = 0;
    for (const job of batch) {
      if (shouldStop() || Date.now() - started > (this.options.lookEveryMs ?? 5 * 60_000)) break;
      if (Date.now() - renewed > leaseMs / 3) {
        if (!(await takeLease(this.owner, leaseMs))) break;
        renewed = Date.now();
      }
      const jobStarted = Date.now();
      try {
        const result = await makeMachineFile(job, this.speak);
        if (result.state === "saved") {
          made++;
          this.made++;
          this.lastMadeAt = new Date();
          const counts = plan.languages[job.language];
          counts.waiting[typeOf[job.slot.kind]]--;
          counts.made[typeOf[job.slot.kind]]++;
        } else if (result.state === "invalid") throw new Error(`The machine file was not stored (${result.reason})`);
      } catch (error) {
        failed++;
        this.failed++;
        this.failures.set(jobId(job), (this.failures.get(jobId(job)) ?? 0) + 1);
        await this.options.onError?.(job, error);
      }
      // Let anything else on this process, and on the server, run between two files.
      const rest = (Date.now() - jobStarted) * (this.options.rest ?? 0);
      await new Promise((resolve) => (rest > 0 ? setTimeout(resolve, rest) : setImmediate(resolve)));
    }
    await this.save(plan, "working");
    return { held: true, made, failed, left: jobs.length - made };
  }
}

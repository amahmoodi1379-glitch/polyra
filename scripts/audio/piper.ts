import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { MachineVoice } from "@/lib/audio/voices";

/**
 * Piper (OHF-Voice/piper1-gpl, the `piper-tts` package) running on our own server: one process per
 * loaded voice, fed one line at a time, writing one WAV file per line. The only TTS of the project
 * (CLAUDE.md rule 5); nothing leaves the server. In the image Piper lives in /opt/piper and the
 * voices in scripts/audio/voices (Dockerfile); PIPER_BIN and PIPER_VOICES point elsewhere for a
 * developer's machine.
 */

export const piperBin = () => process.env.PIPER_BIN ?? "/opt/piper/bin/piper";
export const voicesDir = () => path.resolve(process.env.PIPER_VOICES ?? path.join(process.cwd(), "scripts/audio/voices"));
export const modelPath = (voice: MachineVoice) => path.join(voicesDir(), `${voice.model}.onnx`);

/** What is missing to speak with these voices: the program, or a voice's model or its settings file. */
export function missingParts(voices: MachineVoice[]): string[] {
  const missing: string[] = [];
  try {
    accessSync(piperBin(), constants.X_OK);
  } catch {
    missing.push(piperBin());
  }
  for (const model of new Set(voices.map(modelPath))) {
    if (!existsSync(model)) missing.push(model);
    if (!existsSync(`${model}.json`)) missing.push(`${model}.json`);
  }
  return missing;
}

/** Longest a line may take, the first one including loading the voice. */
const LINE_TIMEOUT_MS = 180_000;

export class PiperVoiceProcess {
  private child: ChildProcess;
  private waiting: { resolve: (file: string) => void; reject: (error: Error) => void; timer: NodeJS.Timeout } | null = null;
  private log: string[] = [];
  private exited = false;

  private constructor(
    readonly voice: MachineVoice,
    private readonly dir: string,
  ) {
    const args = ["-m", modelPath(voice), "--output-dir", dir];
    if (voice.speaker !== null) args.push("-s", String(voice.speaker));
    this.child = spawn(piperBin(), args, { stdio: ["pipe", "ignore", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    createInterface({ input: this.child.stderr! }).on("line", (line) => this.heard(line));
    this.child.on("error", (error) => this.stopped(error));
    this.child.on("exit", (code, signal) => this.stopped(new Error(`Piper stopped (${signal ?? code})`)));
    this.child.stdin!.on("error", () => undefined);
  }

  static async start(voice: MachineVoice) {
    return new PiperVoiceProcess(voice, await mkdtemp(path.join(tmpdir(), "polyra-piper-")));
  }

  get alive() {
    return !this.exited;
  }

  private heard(line: string) {
    const wrote = /Wrote (.+\.wav)\s*$/.exec(line);
    if (wrote && this.waiting) {
      const { resolve, timer } = this.waiting;
      clearTimeout(timer);
      this.waiting = null;
      resolve(wrote[1]);
      return;
    }
    this.log = [...this.log.slice(-19), line];
  }

  private stopped(error: Error) {
    this.exited = true;
    if (!this.waiting) return;
    const { reject, timer } = this.waiting;
    clearTimeout(timer);
    this.waiting = null;
    reject(new Error(`${error.message}${this.log.length > 0 ? `\n${this.log.join("\n")}` : ""}`));
  }

  /** One line spoken, as the bytes of a WAV file. */
  async say(line: string): Promise<Uint8Array> {
    if (this.exited) throw new Error("Piper is not running");
    if (this.waiting) throw new Error("Piper is already speaking");
    if (/[\r\n]/.test(line)) throw new Error("One line at a time");
    const file = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = null;
        reject(new Error(`Piper took longer than ${LINE_TIMEOUT_MS / 1000} s`));
        this.close();
      }, LINE_TIMEOUT_MS);
      this.waiting = { resolve, reject, timer };
      this.child.stdin!.write(`${line}\n`);
    });
    const full = path.isAbsolute(file) ? file : path.join(this.dir, path.basename(file));
    try {
      return new Uint8Array(await readFile(full));
    } finally {
      await rm(full, { force: true });
    }
  }

  close() {
    if (!this.exited) {
      this.child.stdin!.end();
      const child = this.child;
      setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 3000).unref();
    }
    this.exited = true;
    void rm(this.dir, { recursive: true, force: true });
  }
}

/**
 * At most one voice loaded at a time (each takes about 200 MB and the server has about 1 GB): asking
 * for another closes the one before.
 */
export class VoicePool {
  private current: PiperVoiceProcess | null = null;

  async get(voice: MachineVoice) {
    if (this.current?.alive && this.current.voice.id === voice.id) return this.current;
    this.close();
    this.current = await PiperVoiceProcess.start(voice);
    return this.current;
  }

  close() {
    this.current?.close();
    this.current = null;
  }
}

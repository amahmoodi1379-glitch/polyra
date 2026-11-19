/**
 * The machine voices (DECISIONS.md, 18 Nov 2026): free Piper voices that run on our own server
 * (`scripts/audio`). Each language has a first voice for everything and a second one for the other
 * speaker of a dialogue. A file keeps the id of the voice that made it in `audio_asset.voice`.
 */

export type MachineVoice = {
  /** Stored in `audio_asset.voice`. */
  id: string;
  language: "fr" | "de";
  /** The model file in scripts/audio/voices, without `.onnx`. */
  model: string;
  /** The speaker inside a model that has several; null for a single-speaker model. */
  speaker: number | null;
  /** The recordings the voice was trained on, credited on «درباره». */
  credit: { name: string; authors: string; url: string; licence: VoiceLicence };
};

export type VoiceLicence = "CC BY 4.0" | "CC BY-SA 4.0" | "CC0 1.0";

export const voiceLicences: Record<VoiceLicence, string> = {
  "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
  "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
  "CC0 1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
};

const voice = (value: MachineVoice) => value;

/** First voice, then the second speaker's, by language. */
export const machineVoices = {
  fr: [
    voice({
      id: "fr_FR-siwis-medium",
      language: "fr",
      model: "fr_FR-siwis-medium",
      speaker: null,
      credit: {
        name: "SIWIS French Speech Synthesis Database",
        authors: "Pierre-Edouard Honnet, Alexandros Lazaridis, Philip N. Garner, Junichi Yamagishi",
        url: "https://datashare.is.ed.ac.uk/handle/10283/2353",
        licence: "CC BY 4.0",
      },
    }),
    voice({
      id: "fr_FR-upmc-medium:pierre",
      language: "fr",
      model: "fr_FR-upmc-medium",
      speaker: 1,
      credit: {
        name: "UPMC Pierre Voice Data",
        authors: "Pierre Chauvin, ISIR, Université Pierre et Marie Curie (MaryTTS)",
        url: "https://github.com/marytts/upmc-pierre-data",
        licence: "CC BY-SA 4.0",
      },
    }),
  ],
  de: [
    voice({
      id: "de_DE-thorsten-medium",
      language: "de",
      model: "de_DE-thorsten-medium",
      speaker: null,
      credit: { name: "Thorsten-Voice", authors: "Thorsten Müller", url: "https://github.com/thorstenMueller/Thorsten-Voice", licence: "CC0 1.0" },
    }),
    voice({
      id: "de_DE-kerstin-medium",
      language: "de",
      model: "de_DE-kerstin-medium",
      speaker: null,
      credit: { name: "Nabu Casa Voice Datasets (kerstin)", authors: "Nabu Casa, Open Home Foundation", url: "https://github.com/OHF-Voice/voice-datasets", licence: "CC0 1.0" },
    }),
  ],
} as const satisfies Record<"fr" | "de", readonly [MachineVoice, MachineVoice]>;

/** Which of a language's two voices: 0 for everything, 1 for the other speaker of a dialogue. */
export type VoiceRole = 0 | 1;

export const voiceFor = (language: string, role: VoiceRole): MachineVoice | null => machineVoices[language as "fr" | "de"]?.[role] ?? null;

export const allVoices: MachineVoice[] = [...machineVoices.fr, ...machineVoices.de];
export const voiceById = (id: string) => allVoices.find((item) => item.id === id) ?? null;

/** What a machine voice is given to read: one line, spaces evened out. Null when there is nothing to say. */
export function spokenLine(text: string | null | undefined): string | null {
  const line = (text ?? "").replace(/\s+/g, " ").trim();
  return /\p{L}/u.test(line) ? line : null;
}

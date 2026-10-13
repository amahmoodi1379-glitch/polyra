/**
 * The one format every audio file of the app has (PRD §13.8): mp3, mono, 24 kHz, 64 kbit/s, constant
 * bit rate, loudness evened out. Machine and human audio are both brought to it before they are
 * stored, so any two files can be joined frame by frame (a text from its sentences) without decoding.
 */
export const AUDIO_RATE = 24000;
export const AUDIO_KBPS = 64;
/** Samples in one mp3 frame at this rate (MPEG-2 Layer III). */
export const FRAME_SAMPLES = 576;

/** Integrated loudness every file is brought to, in LUFS (ITU-R BS.1770), and the highest sample peak, in dBFS. */
export const TARGET_LUFS = -18;
export const PEAK_CEILING_DB = -1.5;

/** Silence kept before and after the speech when the edges are trimmed. */
export const EDGE_PAD_MS = 120;
/** Below this level a stretch at the edges counts as silence. */
export const SILENCE_DB = -45;

/** Silence between two sentences when a text's file is made from its sentences. */
export const TEXT_GAP_MS = 450;

/** Longest file each place takes; longer is almost surely the wrong file. */
export const MAX_MS = { word: 15_000, sentence: 60_000, phonics: 60_000, text: 30 * 60_000 } as const;

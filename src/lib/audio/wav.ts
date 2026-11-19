/**
 * Reading a WAV file of 16-bit PCM (what Piper writes) into samples between -1 and 1, mixed down
 * to mono.
 */
export type Wav = { rate: number; pcm: Float32Array };

const text = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

export function readWav(bytes: Uint8Array): Wav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 12 || text(bytes, 0) !== "RIFF" || text(bytes, 8) !== "WAVE") throw new Error("Not a WAV file");
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let format = 0;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = text(bytes, at);
    const size = view.getUint32(at + 4, true);
    const body = at + 8;
    if (id === "fmt ") {
      format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      rate = view.getUint32(body + 4, true);
      bits = view.getUint16(body + 14, true);
    } else if (id === "data") {
      if (format !== 1 || bits !== 16 || channels < 1) throw new Error(`Unsupported WAV (format ${format}, ${bits} bits, ${channels} channels)`);
      const end = Math.min(bytes.length, body + size);
      const frames = Math.floor((end - body) / (2 * channels));
      const pcm = new Float32Array(frames);
      for (let frame = 0; frame < frames; frame++) {
        let sum = 0;
        for (let channel = 0; channel < channels; channel++) sum += view.getInt16(body + (frame * channels + channel) * 2, true);
        pcm[frame] = sum / channels / 32768;
      }
      return { rate, pcm };
    }
    at = body + size + (size % 2);
  }
  throw new Error("WAV file has no data");
}

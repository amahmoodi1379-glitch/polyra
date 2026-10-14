/** Letters and digits that cannot be confused when read aloud or retyped (no 0/O, 1/I/L). */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/**
 * The short code of an error, the one a learner reads out from the error screen: "E" and six letters
 * or digits. The same error gives the same code, so the errors page can gather its repeats, and the
 * browser can show the code of a server error from its digest alone (PRD §15.9).
 */
export function errorCode(seed: string): string {
  // Two 32-bit FNV-1a hashes with different starting points give enough bits for six characters.
  let a = 0x811c9dc5;
  let b = 0x050c5d1f;
  for (let i = 0; i < seed.length; i++) {
    const c = seed.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
  }
  let n = a * 2 ** 21 + (b >>> 11);
  let code = "E";
  for (let i = 0; i < 6; i++) {
    code += ALPHABET[n % ALPHABET.length];
    n = Math.floor(n / ALPHABET.length);
  }
  return code;
}

/** What makes two errors "the same": where they happened and their message, with numbers left out. */
export const errorSeed = (where: string, message: string) => `${where}|${message}`.replace(/\d+/g, "#");

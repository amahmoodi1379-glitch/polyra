import { randomInt } from "node:crypto";
import { db } from "@/server/db";

/** Letters and digits that cannot be confused when read aloud or retyped (no 0/O, 1/I/L). */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function newCode() {
  let code = "E";
  for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/**
 * Records a server error in `error_log` and returns its short code. The panel's errors page lists
 * these with a copy button so the owner can hand the exact error to Claude Code (PRD §13.2, §15.9).
 */
export async function logError(
  where: string,
  error: unknown,
  context: { userId?: number | null; requestId?: string | null } = {},
): Promise<string> {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? null) : null;
  console.error(`[${where}]`, error);
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = newCode();
    try {
      await db.errorLog.create({
        data: { id, where, message, stack, user_id: context.userId ?? null, request_id: context.requestId ?? null },
      });
      return id;
    } catch (writeError) {
      if (attempt === 2) console.error("[logError] could not write error_log", writeError);
    }
  }
  return "E------";
}

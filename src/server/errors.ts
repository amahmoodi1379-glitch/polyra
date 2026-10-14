import { randomInt } from "node:crypto";
import { errorCode, errorSeed } from "@/lib/error-code";
import { db } from "@/server/db";

const SUFFIX = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const suffix = () => Array.from({ length: 4 }, () => SUFFIX[randomInt(SUFFIX.length)]).join("");

/** Longest message and stack kept, so one runaway error cannot fill the table. */
const MESSAGE_MAX = 4000;
const STACK_MAX = 16000;

/**
 * Records an error in `error_log` and returns its short code (PRD §15.9). The same error always gets
 * the same code: its first row is stored under the code itself and each repeat under "code-XXXX", so
 * the errors page shows one entry with its count. `seed` overrides what decides the code (a server
 * render error uses its digest, which is all the browser knows of it).
 */
export async function logError(where: string, error: unknown, context: { userId?: number | null; requestId?: string | null; seed?: string } = {}): Promise<string> {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, MESSAGE_MAX);
  const stack = error instanceof Error ? (error.stack?.slice(0, STACK_MAX) ?? null) : null;
  const code = errorCode(context.seed ?? errorSeed(where, message));
  console.error(`[${where}] ${code}`, error);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const taken = attempt > 0 || (await db.errorLog.findUnique({ where: { id: code }, select: { id: true } })) !== null;
      await db.errorLog.create({
        data: { id: taken ? `${code}-${suffix()}` : code, where, message, stack, user_id: context.userId ?? null, request_id: context.requestId ?? null },
      });
      return code;
    } catch (writeError) {
      if (attempt === 2) console.error("[logError] could not write error_log", writeError);
    }
  }
  return code;
}

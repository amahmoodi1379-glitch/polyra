import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { queueTappedWord } from "@/server/learn/tap";

export const dynamic = "force-dynamic";

const schema = z.object({ language: z.string().refine(isLanguage), wordId: z.number().int().positive() });

/** A word touched in a sentence (PRD §5.9). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ kind: "signed_out" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ kind: "invalid" }, { status: 400 });
  return Response.json({ kind: "ok", queued: await queueTappedWord(user, parsed.data.language, parsed.data.wordId) });
}

import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { startSession } from "@/server/learn/session";

export const dynamic = "force-dynamic";

const schema = z.object({
  language: z.string().refine(isLanguage),
  scope: z.enum(["mixed", "quick", "vocab", "grammar", "notebook", "extra"]),
  noAudio: z.boolean().default(false),
  cap: z.enum(["more", "none"]).nullable().default(null),
});

/** Builds or resumes a session and returns its bundle (PRD §15.4, step 1). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ kind: "signed_out" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ kind: "invalid" }, { status: 400 });
  return Response.json(await startSession(user, parsed.data));
}

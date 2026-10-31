import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { textAnswers } from "@/server/learn/answer";
import { saveTextProgress } from "@/server/learn/text-progress";

export const dynamic = "force-dynamic";

const schema = z.object({
  sessionId: z.uuid(),
  cardId: z.string().min(1).max(40),
  answers: textAnswers,
  plays: z.number().int().min(0).max(100),
  positionMs: z.number().min(0).max(3_600_000),
});

/** Where a text stage stands, so a session closed in the middle goes on from there (PRD §7.4). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ kind: "signed_out" }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ kind: "invalid" }, { status: 400 });
  return Response.json({ kind: await saveTextProgress(user, parsed.data) });
}

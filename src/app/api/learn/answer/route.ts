import { getCurrentUser } from "@/server/auth/session";
import { answerSchema, submitAnswer } from "@/server/learn/answer";

export const dynamic = "force-dynamic";

/** One finished card (PRD §15.4, steps 4 and 5). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ kind: "signed_out" }, { status: 401 });
  const parsed = answerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ kind: "invalid" }, { status: 400 });
  const result = await submitAnswer(user, parsed.data);
  return Response.json(result, { status: result.kind === "invalid" ? 400 : 200 });
}

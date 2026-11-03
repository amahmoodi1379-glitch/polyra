import { getCurrentUser } from "@/server/auth/session";
import { logError } from "@/server/errors";
import { fileReport } from "@/server/reports/file";

export const dynamic = "force-dynamic";

/** «گزارش اشکال» from an exercise's feedback sheet (PRD §13.10). `later`: the answer has not reached the server yet. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ ok: false, reason: "signed_out" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return Response.json({ ok: false, reason: "invalid" }, { status: 400 });
  try {
    const reply = await fileReport(user, { answerId: body.answerId, reason: body.reason, note: body.note, source: body.source, promptFa: body.promptFa });
    return Response.json(reply, { status: reply.ok ? 200 : reply.reason === "later" ? 409 : reply.reason === "limit" ? 429 : 400 });
  } catch (error) {
    const code = await logError("learn/report", error, { userId: user.id });
    return Response.json({ ok: false, reason: "failed", code }, { status: 500 });
  }
}

import { getCurrentUser } from "@/server/auth/session";
import { sessionEnd } from "@/server/learn/answer";

export const dynamic = "force-dynamic";

/** The end screen of a finished session, after a reload (PRD §15.4, step 8). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ kind: "signed_out" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ kind: "gone" }, { status: 404 });
  const end = await sessionEnd(user, id);
  return end ? Response.json({ kind: "end", end }) : Response.json({ kind: "gone" }, { status: 404 });
}

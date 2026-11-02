import { z } from "zod";
import { getCurrentUser } from "@/server/auth/session";
import { isLanguage, type LanguageCode } from "@/server/content/languages";
import { saveWriting, tickWriting } from "@/server/learn/writing";

export const dynamic = "force-dynamic";

const save = z.object({
  language: z.string().refine(isLanguage),
  taskId: z.number().int().positive(),
  text: z.string().max(20_000),
  ticks: z.array(z.number().int().min(0).max(20)).max(20),
  seconds: z.number().min(0).max(86_400),
});
const ticks = z.object({ id: z.number().int().positive(), ticks: z.array(z.number().int().min(0).max(20)).max(20) });

/** A finished writing (PRD §8b.6). */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ kind: "signed_out" }, { status: 401 });
  const parsed = save.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ kind: "invalid" }, { status: 400 });
  const result = await saveWriting(user, { ...parsed.data, language: parsed.data.language as LanguageCode });
  return Response.json(result, { status: result.kind === "ok" ? 200 : 400 });
}

/** The checklist ticked after the model answer (PRD §8b.6, step 3). */
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ kind: "signed_out" }, { status: 401 });
  const parsed = ticks.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ kind: "invalid" }, { status: 400 });
  return Response.json({ kind: (await tickWriting(user, parsed.data.id, parsed.data.ticks)) ? "ok" : "invalid" });
}

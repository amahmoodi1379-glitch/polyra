import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/server/auth/session";
import { storeAudio } from "@/server/content/audio/store";
import { parseSlot } from "@/server/content/audio/slots";
import { logError } from "@/server/errors";

/**
 * One audio file from the panel (PRD §13.8): the body is the mp3 the browser already prepared, the
 * address says where it goes. `slot` is a slot key, `which` is human or machine, `heard=1` when the
 * person who recorded it has listened to it, and `offsets` the start of each sentence of a text.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user?.is_admin) return Response.json({ state: "denied" }, { status: 401 });
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) return Response.json({ state: "denied" }, { status: 403 });

  const query = new URL(request.url).searchParams;
  const slot = parseSlot(query.get("slot") ?? "");
  const which = query.get("which") === "machine" ? "machine" : "human";
  const offsets = query.get("offsets");
  const offsetsMs = offsets ? offsets.split(",").map(Number) : undefined;
  if (!slot || offsetsMs?.some((value) => !Number.isInteger(value))) return Response.json({ state: "invalid", reason: "slot" }, { status: 400 });

  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const result = await storeAudio({ slot, bytes, which, adminId: user.id, heard: query.get("heard") === "1", offsetsMs });
    if (result.state === "saved") revalidatePath("/admin", "layout");
    return Response.json(result, { status: result.state === "saved" ? 200 : result.state === "missing" ? 404 : 400 });
  } catch (error) {
    const code = await logError("audio.upload", error, { userId: user.id });
    return Response.json({ state: "error", code }, { status: 500 });
  }
}

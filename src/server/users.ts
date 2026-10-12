import { db } from "@/server/db";
import { engineNumber } from "@/server/settings/read";

/** The account for a phone, created on first sign-in (PRD §3.1, step 1). */
export async function findOrCreateUser(phone: string) {
  const existing = await db.user.findUnique({ where: { phone } });
  if (existing) return existing;
  const sessionLength = await engineNumber("session.default_length");
  const user = await db.user.create({ data: { phone, session_length_min: sessionLength } });
  await db.event.create({ data: { user_id: user.id, name: "signup" } });
  return user;
}

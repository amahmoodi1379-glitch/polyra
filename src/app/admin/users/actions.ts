"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { createAccount, setAccess, type AccessChange, type AccessResult, type CreateResult } from "@/server/accounts";
import { logError } from "@/server/errors";

export type AccessReply = AccessResult | { ok: false; reason: "failed"; code: string };
export type CreateReply = CreateResult | { ok: false; reason: "failed"; code: string };

/** Turns `is_admin` or `is_tester` on or off for one account, or sets a teacher's panel language. */
export async function changeAccess(userId: number, change: AccessChange): Promise<AccessReply> {
  const admin = await requireAdmin();
  try {
    const result = await setAccess(admin.id, userId, change);
    if (result.ok && result.changed) revalidatePath("/admin", "layout");
    return result;
  } catch (error) {
    return { ok: false, reason: "failed", code: await logError("users.changeAccess", error, { userId: admin.id }) };
  }
}

/** A phone without an account becomes a teacher or a tester before its first sign-in. */
export async function addAccount(input: Parameters<typeof createAccount>[1]): Promise<CreateReply> {
  const admin = await requireAdmin();
  try {
    const result = await createAccount(admin.id, input);
    if (result.ok) revalidatePath("/admin/users");
    return result;
  } catch (error) {
    return { ok: false, reason: "failed", code: await logError("users.addAccount", error, { userId: admin.id }) };
  }
}

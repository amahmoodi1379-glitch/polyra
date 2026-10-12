"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { endSession, requireAdmin } from "@/server/auth/session";
import { db } from "@/server/db";

export async function signOut() {
  await endSession();
  redirect("/login");
}

/** The panel opens in this language next time too (PRD §13.1, `user.admin_language`). */
export async function setAdminLanguage(language: string) {
  const admin = await requireAdmin();
  if (!["fr", "de", "all"].includes(language)) return;
  await db.user.update({ where: { id: admin.id }, data: { admin_language: language } });
  revalidatePath("/admin", "layout");
}

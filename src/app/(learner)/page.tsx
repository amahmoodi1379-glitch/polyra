import { redirect } from "next/navigation";
import { entryPath, requireLearner } from "@/server/learn/guard";

/** «/»: the learner's language home, or the start of the app (PRD §3.1). */
export default async function EntryPage() {
  const user = await requireLearner("/");
  redirect(await entryPath(user.id));
}

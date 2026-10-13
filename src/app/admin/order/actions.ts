"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { isOrderList, perLevel, saveOrder, type OrderResult } from "@/server/content/order";
import { logError } from "@/server/errors";
import { appSetting } from "@/server/settings/read";

export type OrderOutcome = OrderResult | { state: "failed" };

const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id) && id > 0).slice(0, 5000) : []);

/**
 * Saves the order of one list (PRD §13.2 «ترتیب»). `manual: false` puts a level's texts back on their
 * difficulty order (DECISIONS).
 */
export async function saveOrderAction(list: string, language: string, level: string | null, base: number[], order: number[], manual?: boolean): Promise<OrderOutcome> {
  const admin = await requireAdmin();
  if (!isOrderList(list) || !isLanguage(language)) return { state: "failed" };
  if (perLevel[list] && !(level && (await appSetting<string[]>(`levels.${language}`)).includes(level))) return { state: "failed" };
  try {
    const result = await saveOrder(
      list,
      language,
      perLevel[list] ? level : null,
      ids(base),
      {
        order: ids(order),
        manual: list === "texts" ? manual !== false : undefined,
      },
      admin.id,
    );
    revalidatePath("/admin/order");
    return result;
  } catch (error) {
    await logError("order.save", error, { userId: admin.id });
    return { state: "failed" };
  }
}

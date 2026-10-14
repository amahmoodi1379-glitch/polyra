import { getCurrentUser } from "@/server/auth/session";
import { isLanguage } from "@/server/content/languages";
import { isLibrarySlug } from "@/server/content/library/slugs";
import { allJson, exportItems, itemsCsv, itemsJson } from "@/server/content/transfer/export";
import { logError } from "@/server/errors";

/**
 * One file of «خروجی و ورود فایل» (PRD §13.2 «خروجی»): `type` is a list of «همه محتوا» or `all` (every list, JSON only),
 * `format` is csv or json. The name says what it holds and when, e.g. polyra-fr-words-2026-10-14.csv.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user?.is_admin) return new Response(null, { status: 401 });

  const query = new URL(request.url).searchParams;
  const language = query.get("lang") ?? "";
  const type = query.get("type") ?? "";
  const format = query.get("format") === "csv" ? "csv" : "json";
  if (!isLanguage(language) || !(type === "all" || isLibrarySlug(type)) || (type === "all" && format === "csv")) return new Response(null, { status: 400 });

  try {
    const now = new Date();
    const body =
      type === "all"
        ? await allJson(language, now)
        : format === "csv"
          ? itemsCsv(type, await exportItems(type, language))
          : itemsJson(type, language, await exportItems(type, language), now);
    const name = `polyra-${language}-${type}-${now.toISOString().slice(0, 10)}.${format}`;
    return new Response(body, {
      headers: {
        "content-type": format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const code = await logError("export.file", error, { userId: user.id });
    return new Response(`Error ${code}`, { status: 500 });
  }
}

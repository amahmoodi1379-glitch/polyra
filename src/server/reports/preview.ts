import { previewItem, type Preview } from "@/server/content/review/preview";
import type { ReportRow } from "./list";

/**
 * The reported exercise the way the learner got it (PRD §13.10), built again with the engine's own
 * builders: the screens of the item (or of the sentence it was asked on) with the same exercise code
 * and, for a sentence, the same target. Wrong options may come in another order than the learner saw.
 * When that exercise cannot be built any more, every screen of the item is shown instead.
 */
export async function reportPreview(report: Pick<ReportRow, "language" | "code" | "targetId" | "item" | "sentence">): Promise<{ preview: Preview; exact: boolean }> {
  const language = report.language;
  if (!language || !report.item.slug) return { preview: { state: "none", reason: "missing" }, exact: false };
  const viaSentence = report.sentence !== null && report.item.slug !== "transforms" && report.item.slug !== "translations";
  const preview = viaSentence ? await previewItem("sentences", language, report.sentence!.id) : await previewItem(report.item.slug, language, report.item.id);
  if (preview.state !== "ready" || !report.code) return { preview, exact: false };
  const same = preview.screens.filter((screen) => screen.kind === "exercise" && screen.ex.code === report.code && (report.targetId === null || screen.ex.targetId === null || screen.ex.targetId === report.targetId));
  if (same.length > 0) return { preview: { ...preview, screens: same.slice(0, 1) }, exact: true };
  // The sentence may no longer make that exercise: the item's own screens.
  if (viaSentence) {
    const own = await previewItem(report.item.slug, language, report.item.id);
    if (own.state === "ready") {
      const mine = own.screens.filter((screen) => screen.kind === "exercise" && screen.ex.code === report.code);
      return mine.length > 0 ? { preview: { ...own, screens: mine.slice(0, 1) }, exact: true } : { preview: own, exact: false };
    }
  }
  return { preview, exact: false };
}

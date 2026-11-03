import { expect, test, type Page } from "@playwright/test";
import { E2E_REPORT_ADMINS, E2E_REPORTERS } from "./database";

/**
 * «گزارش اشکال» and «حق با تو بود» (PRD §13.10, §16.4), one run per browser size: a learner answers an
 * exercise with «نمی‌دانم» and reports it from the feedback sheet; a teacher finds the report in the panel,
 * sees the exercise, ticks «حق با زبان‌آموز بود» and closes it; the learner's home shows «حق با تو بود»
 * once, and a tap closes it.
 */

// Its own address: the learner server allows 10 code requests an hour from one (PRD §15.5).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.0.1.71" } });
test.describe.configure({ mode: "serial" });

type Project = keyof typeof E2E_REPORTERS;
const tag = (project: string) => project.replace("learner-", "");

async function signIn(page: Page, phone: string, next: string, landing: RegExp) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page).toHaveURL(landing);
}

test("a learner reports an exercise, a teacher agrees, and the learner hears they were right", async ({ page, browser }, testInfo) => {
  test.setTimeout(180_000);
  const project = testInfo.project.name as Project;
  const note = `گزارش آزمایشی ${tag(project)}`;

  await signIn(page, E2E_REPORTERS[project], "/learn/fr", /\/learn\/fr$/);
  await page.getByRole("button", { name: "شروع جلسه" }).click();
  await expect(page).toHaveURL(/\/learn\/fr\/session/);

  // Through the first cards to the first exercise with «نمی‌دانم».
  const seen = page.getByRole("button", { name: /^(یاد گرفتم، برو تمرین|فهمیدم، برو تمرین|فهمیدم)$/ });
  const idk = page.getByRole("button", { name: "نمی‌دانم", exact: true });
  const option = page.locator(".opts .opt:not([disabled])").first();
  const next = page.locator(".fb").getByRole("button", { name: "ادامه" });
  for (let step = 0; step < 40; step++) {
    await expect(seen.or(idk).or(option).or(next).first()).toBeVisible();
    if (await idk.isVisible()) break;
    if (await next.isVisible()) await next.click();
    else if (await seen.isVisible()) await seen.click();
    else await option.click();
  }
  await idk.click();
  await expect(next).toBeVisible();

  await page.locator("[data-report]").click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("heading", { name: "چه اشکالی دیدی؟" })).toBeVisible();
  // «جواب من هم درست است» is for an answer counted wrong, not for «نمی‌دانم».
  await expect(sheet.getByRole("radio", { name: "جواب من هم درست است" })).toHaveCount(0);
  const send = sheet.getByRole("button", { name: "فرستادن گزارش" });
  await expect(send).toBeDisabled();
  await sheet.getByRole("radio", { name: "جوابی که اپ درست می‌داند غلط است" }).click();
  await sheet.getByLabel("اگر خواستی، یک خط توضیح بده").fill(note);
  await page.screenshot({ path: testInfo.outputPath("report-sheet.png") });
  await send.click();
  await expect(sheet.locator("[data-report-sent]")).toHaveText("ممنون! گزارشت رسید.");
  await sheet.getByRole("button", { name: "ادامه" }).click();
  await expect(sheet).toBeHidden();
  await expect(next).toBeVisible();

  // The teacher, on another device.
  const teacher = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.0.1.72" } });
  const panel = await teacher.newPage();
  await signIn(panel, E2E_REPORT_ADMINS[project], "/admin", /\/admin$/);
  // The workbench says there is something to answer.
  await expect(panel.getByText(/گزارش اشکال باز/)).toBeVisible();
  await panel.goto("/admin/reports");
  const row = panel.locator("[data-report-row]").filter({ hasText: note });
  await expect(row).toContainText("«جوابی که اپ درست می‌داند غلط است»");
  await expect(row).toContainText("«نمی‌دانم» زد");
  await row.locator("a").click();
  await expect(panel).toHaveURL(/\/admin\/reports\/\d+$/);
  await expect(panel.getByText(note)).toBeVisible();
  // The exercise, the way the learner got it.
  await expect(panel.locator(".lx").first()).toBeVisible();
  const actions = panel.locator("[data-report-actions]");
  // A choice exercise has no accepted answers to add to.
  await expect(actions.locator('[data-act="accept"]')).toBeDisabled();
  await actions.getByLabel("حق با زبان‌آموز بود").check();
  await panel.screenshot({ path: testInfo.outputPath("report-panel.png"), fullPage: true });
  await actions.locator('[data-act="fixed"]').click();
  await expect(panel.getByText("این گزارش بسته شده است.")).toBeVisible();
  await panel.goto("/admin/reports?view=done");
  await expect(panel.locator("[data-report-row]").filter({ hasText: note })).toContainText("اصلاح شد");
  await teacher.close();

  // Back on the learner's home: «حق با تو بود», once.
  await page.goto("/learn/fr");
  const bar = page.locator('[data-notice="report_fixed"]');
  await expect(bar).toHaveText("حق با تو بود؛ جوابت درست بود و اصلاح شد.");
  await page.screenshot({ path: testInfo.outputPath("report-home.png") });
  await bar.click();
  await expect(bar).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "شروع جلسه" })).toBeVisible();
  await expect(bar).toHaveCount(0);
});

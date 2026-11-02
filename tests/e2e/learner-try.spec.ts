import { expect, test } from "@playwright/test";
import { E2E_TRY_ADMINS } from "./database";

/**
 * «تعیین سطح» on «آزمایش مثل زبان‌آموز» (PRD §11) with the French demo: the teacher sees what each level gives
 * the test, lets a made-up learner who knows A1 take it and reads the result and the sample, then starts
 * the test as themselves and finds the way into it.
 */
// Its own address: the learner server allows 10 code requests an hour from one (PRD §15.5).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.0.1.51" } });

test("a teacher checks the placement test's levels, lets a made-up learner take it and starts it themselves", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await page.goto("/login?next=%2Fadmin%2Ftry");
  await page.getByLabel("شماره موبایل").fill(E2E_TRY_ADMINS[testInfo.project.name as keyof typeof E2E_TRY_ADMINS]);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page).toHaveURL(/\/admin\/try/);

  const card = page.locator("[data-placement-card]");
  await expect(card.getByRole("heading", { name: "تعیین سطح" })).toBeVisible();
  // The demo is A1 only and has enough for its blocks; a level the test does not ask has no notes.
  await expect(card.locator('tr[data-level="A1"]')).toBeVisible();
  await expect(card.getByText("همه سطح‌های باز برای آزمون آماده‌اند.")).toBeVisible();

  await card.locator("[data-placement-known]").selectOption("A1");
  await card.getByRole("button", { name: "آزمون را بدهد" }).click();
  const last = card.locator("[data-placement-last]");
  await expect(last).toBeVisible({ timeout: 60_000 });
  await expect(last.locator('[data-skill="vocab"]')).toContainText("A1");
  await expect(last.getByText("قبول", { exact: true }).first()).toBeVisible();
  await expect(last.locator('[data-sample="vocab"]')).toContainText("در جریان");
  await page.screenshot({ path: testInfo.outputPath("try-placement.png"), fullPage: true });

  await card.getByRole("button", { name: "خودم آزمون را می‌دهم" }).click();
  const open = card.getByRole("link", { name: "باز کردن آزمون در اپ" });
  await expect(open).toBeVisible();
  await expect(open).toHaveAttribute("href", "/learn/fr/placement");
  await expect(last).toBeHidden();
});

import { expect, test, type Page } from "@playwright/test";
import { E2E_WRITERS } from "./database";

/**
 * The weekly writing (PRD §8b.6) on the French demo: a tester at vocabulary B1 opens this week's task
 * from home, cannot finish before half the word count, finishes, sees the model answer beside the
 * writing, ticks the checklist and finds the writing in «نوشته‌های من».
 */

async function signIn(page: Page, phone: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
}

test("a learner writes this week's task, compares it with the model answer and finds it in «نوشته‌های من»", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page, E2E_WRITERS[testInfo.project.name as keyof typeof E2E_WRITERS]);
  await expect(page).toHaveURL(/\/learn\/fr$/);

  await page.getByRole("link", { name: /تمرین نوشتن این هفته/ }).click();
  await expect(page).toHaveURL(/\/learn\/fr\/writing$/);
  await expect(page.getByText("خودت و خانواده‌ات را معرفی کن", { exact: false })).toBeVisible();
  const finish = page.getByRole("button", { name: "تمام شد" });
  const box = page.locator("textarea");
  await box.fill("Bonjour ! Je suis Paul.");
  await expect(finish).toBeDisabled();
  await expect(page.getByText("برای «تمام شد» دست‌کم ۳۰ کلمه بنویس.")).toBeVisible();
  await box.fill(Array.from({ length: 8 }, () => "J'habite à Lyon avec ma famille.").join(" "));
  await expect(finish).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("writing.png"), fullPage: true });
  await finish.click();

  await expect(page.getByText("نوشته‌ات در «نوشته‌های من» ماند.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "جواب نمونه" })).toBeVisible();
  await expect(page.getByText("J'habite à Lyon avec ma famille, dans une petite maison", { exact: false })).toBeVisible();
  const ticked = page.waitForResponse((response) => response.url().endsWith("/api/learn/writing") && response.request().method() === "PATCH" && response.ok());
  await page.getByRole("checkbox", { name: "گفتم کجا زندگی می‌کنم." }).check();
  await ticked;
  await page.screenshot({ path: testInfo.outputPath("writing-model.png"), fullPage: true });

  await page.getByRole("link", { name: "نوشته‌های من" }).click();
  await expect(page).toHaveURL(/\/learn\/fr\/writings$/);
  await expect(page.getByText("۱ نوشته")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "گفتم کجا زندگی می‌کنم." })).toBeChecked();

  // The week is done: home has no writing card any more.
  await page.goto("/learn/fr");
  await expect(page.getByRole("link", { name: /تمرین نوشتن این هفته/ })).toHaveCount(0);
});

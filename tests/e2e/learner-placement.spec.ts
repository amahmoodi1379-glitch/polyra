import { expect, test, type Page } from "@playwright/test";
import { E2E_PLACERS } from "./database";

/**
 * Placement (PRD §11.1–§11.3) on the French demo: a tester chooses «تعیین سطح», answers a question, leaves
 * with «بعداً ادامه می‌دهم», finds the test waiting on the home, goes on, thinks better of «ادامه نمی‌دهم»,
 * and answers «نمی‌دانم» until the result: every skill A1, then the home with «شروع».
 */

async function signIn(page: Page, phone: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
}

test("a tester takes the placement test, leaves it half-way, comes back and gets the result", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  await signIn(page, E2E_PLACERS[testInfo.project.name as keyof typeof E2E_PLACERS]);

  await expect(page.getByRole("heading", { name: "کدام زبان را می‌خواهی یاد بگیری؟" })).toBeVisible();
  await page.getByRole("link", { name: /فرانسوی/ }).click();
  await page.getByRole("radio", { name: /۱۰ دقیقه/ }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: /تعیین سطح/ }).click();

  await expect(page).toHaveURL(/\/learn\/fr\/placement$/);
  const part = page.locator("[data-placement-part]");
  await expect(part).toContainText(/واژگان A1/);
  await expect(part).toContainText(/سؤال (1|۱) از/);
  await expect(page.getByText("اگر جواب را نمی‌دانی «نمی‌دانم» را بزن.", { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("placement-question.png"), fullPage: true });

  // One answer, with no feedback: the next question comes.
  await page.locator(".opts .opt:not([disabled])").first().click();
  await expect(part).toContainText(/سؤال (2|۲) از/);

  // «بعداً ادامه می‌دهم»: the home waits with the test.
  await page.getByRole("button", { name: "بعداً ادامه می‌دهم" }).click();
  await expect(page).toHaveURL(/\/learn\/fr$/);
  await expect(page.getByRole("heading", { name: "تعیین سطح نیمه‌کاره است" })).toBeVisible();
  await expect(page.getByRole("button", { name: "از همین‌جا شروع کن" })).toBeVisible();
  await page.getByRole("link", { name: "ادامه تعیین سطح" }).click();
  await expect(page).toHaveURL(/\/learn\/fr\/placement$/);
  await expect(part).toContainText(/سؤال (2|۲) از/);

  // «ادامه نمی‌دهم» asks first; «نه، ادامه می‌دهم» changes nothing.
  await page.getByRole("button", { name: "ادامه نمی‌دهم" }).click();
  await expect(page.getByText("همین‌جا تمامش کنیم؟", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "نه، ادامه می‌دهم" }).click();
  await expect(part).toContainText(/سؤال (2|۲) از/);

  // «نمی‌دانم» until the block fails: the result.
  const result = page.getByRole("heading", { name: "سطح تو در فرانسوی" });
  const idk = page.getByRole("button", { name: "نمی‌دانم", exact: true });
  for (let i = 0; i < 10 && !(await result.isVisible()); i++) {
    await expect(result.or(idk).first()).toBeVisible();
    if (await result.isVisible()) break;
    await idk.click();
  }
  await expect(result).toBeVisible();
  const levels = page.locator("[data-placement-result] [data-skill]");
  await expect(levels).toHaveCount(4);
  for (const skill of ["vocab", "grammar", "listening", "reading"]) await expect(page.locator(`[data-placement-result] [data-skill="${skill}"]`)).toContainText("A1");
  await page.screenshot({ path: testInfo.outputPath("placement-result.png"), fullPage: true });

  await page.getByRole("button", { name: "برویم" }).click();
  await expect(page).toHaveURL(/\/learn\/fr$/);
  await expect(page.getByRole("button", { name: "شروع جلسه" })).toBeVisible();
});

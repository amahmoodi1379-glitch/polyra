import { expect, test } from "@playwright/test";

test("the app is Persian and right-to-left, and a visitor signs in first", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.getByLabel("شماره موبایل")).toBeVisible();
});

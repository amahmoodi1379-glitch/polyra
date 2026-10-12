import { expect, test } from "@playwright/test";

test("home page is Persian, right-to-left and shows the wordmark", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "fa");
  await expect(page.getByText("polyra", { exact: true })).toBeVisible();
});

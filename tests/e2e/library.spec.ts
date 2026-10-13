import { expect, test } from "@playwright/test";
import { E2E_ADMINS } from "./database";

// «ترتیب» and «تاریخچه تغییرها» (PRD §13.2) on the two German words of prepare-db. Saving changes the
// shared database, so it runs once, on the desktop project.
test("an admin moves a word by its number, saves, and puts the old order back from the change log", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the order is shared");

  await page.goto("/admin/order?list=words&lang=de&level=A1");
  await page.getByLabel("شماره موبایل").fill(E2E_ADMINS.order);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page.getByRole("heading", { name: "ترتیب", level: 1 })).toBeVisible();

  const sein = page.getByLabel("جای sein");
  await expect(sein).toHaveValue("۲");
  await sein.fill("۱");
  await sein.press("Enter");
  await expect(page.getByText(/جای تازه دارد/)).toBeVisible();
  await page.getByRole("button", { name: "ذخیره ترتیب" }).click();
  await expect(page.getByText("ترتیب ذخیره شد.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("جای sein")).toHaveValue("۱");

  await page.goto("/admin/log");
  const entry = page.getByRole("listitem").filter({ hasText: /ترتیب کلمه‌ها، سطح \u2066?A1/ });
  await expect(entry).toHaveCount(1);
  await entry.getByRole("button", { name: "برگردان" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "برگردان" }).click();
  await expect(entry.getByRole("status")).toHaveText("برگردانده شد.");
  await expect(page.getByRole("listitem").filter({ hasText: /ترتیب کلمه‌ها، سطح \u2066?A1/ })).toHaveCount(2);

  await page.goto("/admin/order?list=words&lang=de&level=A1");
  await expect(page.getByLabel("جای sein")).toHaveValue("۲");
});

import { expect, test } from "@playwright/test";
import { E2E_ADMINS } from "./database";

// «انتشار» (PRD §13.5) on the German drafts of prepare-db: nothing is approved yet, so nothing can be
// published, A1 cannot open, and German cannot show in the app. The page only reads, so both sizes run it.
test("the publish page says what is missing before a level or a language can open", async ({ page }) => {
  await page.goto("/admin/publish?lang=de");
  await page.getByLabel("شماره موبایل").fill(E2E_ADMINS.publish);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page.getByRole("heading", { name: "انتشار", level: 1 })).toBeVisible();

  await expect(page.getByText(/هیچ آیتم تأییدشده‌ای منتظر انتشار نیست/)).toBeVisible();
  const a1 = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: /^A1$/ }) });
  await expect(a1.getByText("هنوز هیچ آیتمی در این سطح منتشر نشده")).toBeVisible();
  await expect(a1.getByRole("button", { name: /باز کردن سطح/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "نمایش آلمانی در اپ" })).toBeDisabled();
});

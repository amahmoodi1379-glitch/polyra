import { expect, test } from "@playwright/test";
import { E2E_ADMINS } from "./database";

// «تنظیمات موتور» and «تنظیمات عمومی» (PRD §13.2): a value outside its range is refused next to the
// field, a valid change is saved, shows in «تاریخچه تغییرها» and goes back with «برگردان». It changes
// the shared database, so it runs once, on the desktop.
test("an admin changes an engine number and a chatbot list, then puts the number back", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the settings are shared");

  await page.goto("/admin/settings/engine");
  await page.getByLabel("شماره موبایل").fill(E2E_ADMINS.settings);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page.getByRole("heading", { name: "تنظیمات موتور", level: 1 })).toBeVisible();

  const hours = page.locator("#setting-session\\.resume_hours");
  await hours.getByRole("textbox").fill("۹۹");
  await expect(hours.getByRole("alert")).toHaveText("باید بین ۱ و ۴۸ باشد.");
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("۱ مورد درست نیست");

  await hours.getByRole("textbox").fill("۸");
  await expect(hours.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("ذخیره شد.");
  await page.reload();
  await expect(page.locator("#setting-session\\.resume_hours-control")).toHaveValue("۸");

  await page.goto("/admin/settings/general?lang=fr");
  const bots = page.locator("#chatbot_names textarea");
  await bots.fill("ChatGPT\nClaude\nGemini\nDeepSeek");
  await expect(page.locator("#chatbot_names")).toContainText("۴ مورد");
  await page.getByRole("button", { name: "ذخیره", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("ذخیره شد.");

  await page.goto("/admin/log?kind=settings");
  const hoursRow = page.locator("li").filter({ hasText: "جلسه نیمه‌کاره تا چند ساعت قابل ادامه است." });
  await expect(page.locator("li").filter({ hasText: "اضافه شد: DeepSeek" })).toBeVisible();
  await hoursRow.getByRole("button", { name: "برگردان" }).click();
  await page.getByRole("button", { name: "برگردان" }).click();
  await expect(hoursRow.getByRole("status")).toContainText("برگردانده شد.");
  await page.goto("/admin/settings/engine");
  await expect(page.locator("#setting-session\\.resume_hours-control")).toHaveValue("۶");
});

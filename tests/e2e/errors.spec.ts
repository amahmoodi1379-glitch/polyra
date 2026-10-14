import { expect, test } from "@playwright/test";
import { E2E_ADMINS } from "./database";

// «خطاها» (PRD §15.9): an error in the browser is stored with a short code and shows on the errors page
// with «کپی برای Claude Code». «سلامت محتوا» opens on its usable-sentences part. Runs once, on the desktop.

// Signs in from its own address: the suite asks for more codes than one address may in an hour (PRD §15.5).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.0.0.13" } });

test("a browser error reaches «خطاها» with its code, and «سلامت محتوا» opens", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the error list is shared");

  await page.goto("/admin/errors");
  await page.getByLabel("شماره موبایل").fill(E2E_ADMINS.errors);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page.getByRole("heading", { name: "خطاها", level: 1 })).toBeVisible();

  const message = `e2e: player.start is not a function ${Date.now()}`;
  const reported = page.waitForResponse((response) => response.url().endsWith("/api/errors") && response.request().method() === "POST");
  await page.evaluate((text) => setTimeout(() => Promise.reject(new TypeError(text))), message);
  const { code } = await (await reported).json();
  expect(code).toMatch(/^E[2-9A-Z]{6}$/);

  await page.goto(`/admin/errors?q=${code}`);
  const entry = page.locator("li").filter({ hasText: message });
  await expect(entry).toBeVisible();
  await expect(entry).toContainText(code);
  await expect(entry).toContainText("مرورگر");
  await expect(entry.getByRole("button", { name: "کپی برای Claude Code" })).toBeVisible();

  await page.goto("/admin/health?lang=fr");
  await expect(page.getByRole("heading", { name: "جمله قابل‌استفاده هر کلمه" })).toBeVisible();
});

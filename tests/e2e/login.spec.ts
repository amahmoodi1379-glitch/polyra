import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMINS } from "./database";

// Each browser project logs in with its own phone, so the per-phone code limit (PRD §15.5) is never shared.
const learnerPhones = { phone: "09120000021", desktop: "09120000022" } as const;
type Project = keyof typeof learnerPhones;

async function requestCode(page: Page, phone: string) {
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await expect(page.getByRole("heading", { name: "کد را بنویس" })).toBeVisible();
  const code = await page.locator("[data-test-code]").getAttribute("data-test-code");
  expect(code).toMatch(/^\d{5}$/);
  return code!;
}

test("an admin reaches the panel with the SMS code", async ({ page }, testInfo) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);

  // Persian digits are accepted as typed on a Persian keyboard.
  const phone = E2E_ADMINS[testInfo.project.name as Project].replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
  await requestCode(page, phone);
  await page.locator("[data-test-code]").click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "میز کار", level: 1 })).toBeVisible();
});

test("a wrong code is explained, and a learner without admin rights cannot open the panel", async ({ page }, testInfo) => {
  await page.goto("/login?next=/admin");
  const code = await requestCode(page, learnerPhones[testInfo.project.name as Project]);

  const wrong = code.replace(/\d$/, (d) => String((Number(d) + 1) % 10));
  await page.getByLabel("کد پیامکی").fill(wrong);
  await expect(page.getByRole("alert").filter({ hasText: "کد درست نیست" })).toBeVisible();

  await page.locator("[data-test-code]").click();
  await expect(page).toHaveURL(/\/no-access$/);
  await expect(page.getByRole("heading", { name: "این بخش برای معلم‌هاست" })).toBeVisible();
});

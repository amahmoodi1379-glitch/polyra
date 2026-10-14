import { expect, test, type Page } from "@playwright/test";
import { E2E_TESTERS } from "./database";

/**
 * The learner app on the French demo (phase 3 exit condition): a tester starts French from zero,
 * plays a whole first session, loses the connection in the middle without losing answers, sees the
 * end of the session from the server, and finds the new words in «کلمه‌های من».
 */

async function signIn(page: Page, phone: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
}

test("a tester starts French, plays a whole session through a lost connection and finds the new words", async ({ page, context }, testInfo) => {
  test.setTimeout(240_000);
  await signIn(page, E2E_TESTERS[testInfo.project.name as keyof typeof E2E_TESTERS]);

  // A tester sees every language; French, then the session length, then «از صفر».
  await expect(page.getByRole("heading", { name: "کدام زبان را می‌خواهی یاد بگیری؟" })).toBeVisible();
  await page.getByRole("link", { name: /فرانسوی/ }).click();
  await expect(page.getByRole("heading", { name: "هر بار چقدر وقت داری؟" })).toBeVisible();
  await page.getByRole("radio", { name: /۱۰ دقیقه/ }).click();
  await page.getByRole("button", { name: "ادامه" }).click();
  await page.getByRole("button", { name: /از صفر شروع می‌کنم/ }).click();

  await expect(page).toHaveURL(/\/learn\/fr$/);
  await expect(page.getByText("حساب آزمایش‌کننده", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "شروع جلسه" }).click();
  await expect(page).toHaveURL(/\/learn\/fr\/session(\?scope=mixed)?$/);

  const end = page.getByRole("heading", { name: "جلسه تمام شد" });
  const next = page.locator(".fb").getByRole("button", { name: "ادامه" });
  const seen = page.getByRole("button", { name: /^(یاد گرفتم، برو تمرین|فهمیدم، برو تمرین|فهمیدم)$/ });
  const option = page.locator(".opts .opt:not([disabled])").first();
  const idk = page.getByRole("button", { name: "نمی‌دانم", exact: true });
  const offline = page.getByRole("status").filter({ hasText: "اتصال قطع است" });

  let answered = 0;
  for (let step = 0; step < 150; step++) {
    await expect(end.or(next).or(seen).or(option).or(idk).first()).toBeVisible();
    if (await end.isVisible()) break;
    if (await next.isVisible()) {
      await next.click();
      continue;
    }
    if (await seen.isVisible()) {
      await seen.click();
      continue;
    }
    answered++;
    // Some answers are given with no connection; they wait on the phone and go when it is back.
    if (answered === 3) {
      await context.setOffline(true);
      await expect(offline).toBeVisible();
    }
    if (answered === 6) {
      await context.setOffline(false);
      await expect(offline).toBeHidden();
    }
    // Every other answer is «نمی‌دانم», the rest the first choice, so the session meets both kinds of feedback.
    if (answered % 2 === 0 && (await idk.isVisible())) await idk.click();
    else if (await option.isVisible()) await option.click();
    else await idk.click();
  }
  await expect(end).toBeVisible();
  expect(answered).toBeGreaterThan(5);

  // The end screen's second half comes from the server once every answer is saved.
  await expect(page.getByText(/^فردا/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/کلمه تازه/)).toBeVisible();

  await page.getByRole("button", { name: "برگشت" }).click();
  await expect(page).toHaveURL(/\/learn\/fr$/);
  await page.getByRole("link", { name: /کلمه‌های من/ }).click();
  await expect(page.getByRole("heading", { name: "کلمه‌های من" })).toBeVisible();
  const words = page.locator(".entries a.entry");
  expect(await words.count()).toBeGreaterThan(3);
  await words.first().click();
  await expect(page).toHaveURL(/\/learn\/fr\/words\/\d+$/);
  await expect(page.locator(".headword")).toBeVisible();
});

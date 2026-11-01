import { expect, test, type Page } from "@playwright/test";
import { E2E_READERS } from "./database";

/**
 * A text in the learner app (PRD §7.3–7.5) on the French demo: a reader who knows every demo word
 * opens a reading session, leaves the first round half-way and finds it again where it was (T91),
 * then answers it, changes answers with help, and reads the review page.
 */

async function signIn(page: Page, phone: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
}

test("a reader leaves a text half-way, finds it again, answers it with and without help and reads its review", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await signIn(page, E2E_READERS[testInfo.project.name as keyof typeof E2E_READERS]);
  await expect(page).toHaveURL(/\/learn\/fr$/);
  // The reading tile is open and says a text waits (PRD §10.4).
  await expect(page.getByText("یک متن منتظر توست").first()).toBeVisible();

  await page.goto("/learn/fr/session?scope=reading");
  const first = page.getByText("اول یک بار بدون کمک امتحان کن. بعدش همه کمک‌ها باز می‌شود.");
  await expect(first).toBeVisible();
  await expect(page.locator(".tx-line").first()).toBeVisible();
  // No help in the first round: no translation, no word meanings.
  await expect(page.getByRole("button", { name: "ترجمه", exact: true })).toHaveCount(0);
  await expect(page.locator(".tx-body .gl")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("text-first.png"), fullPage: true });

  // One answer, then the session is closed: the place is kept (PRD §7.4, «تلاش نیمه‌تمام»).
  const option = page.locator(".tx-q .opt").first();
  const noted = page.waitForResponse((response) => response.url().endsWith("/api/learn/text-progress") && response.ok());
  await option.click();
  await expect(option).toHaveAttribute("aria-pressed", "true");
  await noted;
  await page.getByRole("button", { name: "بستن جلسه" }).click();
  await expect(page).toHaveURL(/\/learn\/fr$/);

  await page.goto("/learn/fr/session?scope=reading");
  await expect(first).toBeVisible();
  await expect(page.locator('.tx-q .opt[aria-pressed="true"]')).toHaveCount(1);
  await expect(page.getByText(/سؤال بی‌جواب مانده/)).toBeVisible();
  await page.getByRole("button", { name: "ثبت جواب‌ها" }).click();

  // With help: the same questions with the answers given, translations and word meanings open.
  await expect(page.getByText(/^حالا با کمک/)).toBeVisible();
  await expect(page.locator('.tx-q .opt[aria-pressed="true"]')).toHaveCount(1);
  const translate = page.getByRole("button", { name: "ترجمه", exact: true }).first();
  await translate.click();
  await expect(page.locator(".tx-line .tr").first()).toBeVisible();
  await expect(page.locator(".tx-body .gl").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("text-help.png"), fullPage: true });
  await page.getByRole("button", { name: "ثبت جواب‌ها" }).click();

  // The review page: both scores, the whole text with translations, every answer with its explanation.
  await expect(page.getByRole("heading", { name: "مرور متن" })).toBeVisible();
  await expect(page.getByText(/^دور اول بدون کمک: /)).toBeVisible();
  await expect(page.getByText(/^تلاش بعدی این متن ۳ روز دیگر می‌آید/)).toBeVisible();
  await expect(page.locator(".tx-r").first()).toBeVisible();
  await expect(page.locator(".tx-why").first()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("text-review.png"), fullPage: true });
  await page.getByRole("button", { name: "ادامه" }).click();

  // Whatever else the session holds, «نمی‌دانم» and «ادامه» take it to its end.
  const end = page.getByRole("heading", { name: "جلسه تمام شد" });
  for (let step = 0; step < 12 && !(await end.isVisible()); step++) {
    const idk = page.getByRole("button", { name: "نمی‌دانم", exact: true });
    const next = page.getByRole("button", { name: "ادامه", exact: true });
    await expect(end.or(idk).or(next).first()).toBeVisible();
    if (await end.isVisible()) break;
    if (await idk.isVisible()) await idk.click();
    else await next.click();
  }
  await expect(end).toBeVisible();
});

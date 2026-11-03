import { expect, test, type Page } from "@playwright/test";
import { E2E_EXAMINERS, E2E_IKNOW } from "./database";

/**
 * The level tools on the French demo:
 * - «این را بلدم» (PRD §5.6, §11.5) on a new word's card: the word is not taught, today's presses count
 *   down, and the word waits in «کلمه‌های من» as a word to check later.
 * - The skip exam (PRD §11.6) of reading for a tester who knows every word (the learner database moves the
 *   demo's last text to A2): the vocabulary sheet says the next level is coming, the reading sheet offers
 *   the exam, the first text is left for later and found again, one answer in each text is a fail,
 *   and the sheet then says when the next try opens.
 */

// Its own address: the learner server allows 10 code requests an hour from one (PRD §15.5).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.0.1.55" } });

async function signIn(page: Page, phone: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page).toHaveURL(/\/learn\/fr$/);
}

test("«این را بلدم» skips teaching a new word and keeps it for a later check", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await signIn(page, E2E_IKNOW[testInfo.project.name as keyof typeof E2E_IKNOW]);
  await page.getByRole("button", { name: "شروع جلسه" }).click();
  await expect(page).toHaveURL(/\/learn\/fr\/session(\?scope=mixed)?$/);

  const iknow = page.locator("[data-iknow]");
  const end = page.getByRole("heading", { name: "جلسه تمام شد" });
  const next = page.locator(".fb").getByRole("button", { name: "ادامه" });
  const seen = page.getByRole("button", { name: /^(یاد گرفتم، برو تمرین|فهمیدم، برو تمرین|فهمیدم)$/ });
  const idk = page.getByRole("button", { name: "نمی‌دانم", exact: true });
  const option = page.locator(".opts .opt:not([disabled])").first();

  /** Plays on («نمی‌دانم», «ادامه», «فهمیدم») until a card with «این را بلدم» or the end. */
  async function toNextIknow() {
    for (let step = 0; step < 80; step++) {
      await expect(end.or(iknow).or(next).or(seen).or(idk).or(option).first()).toBeVisible();
      if ((await end.isVisible()) || (await iknow.isVisible())) return;
      if (await next.isVisible()) await next.click();
      else if (await seen.isVisible()) await seen.click();
      else if (await idk.isVisible()) await idk.click();
      else await option.click();
    }
  }

  await toNextIknow();
  await expect(iknow).toBeVisible();
  // Ten a day (iknow.daily): this press leaves nine.
  await expect(iknow).toHaveAttribute("title", "امروز ۹ بار دیگر می‌توانی «این را بلدم» بزنی.");
  const word = ((await page.locator(".headword").first().textContent()) ?? "").trim();
  expect(word.length).toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath("iknow.png"), fullPage: true });
  await iknow.click();

  // No exercise of that word follows: the next new word's card, with one press fewer.
  await toNextIknow();
  await expect(iknow).toBeVisible();
  await expect(page.locator(".headword").first()).not.toHaveText(word);
  await expect(iknow).toHaveAttribute("title", "امروز ۸ بار دیگر می‌توانی «این را بلدم» بزنی.");

  // The rest of the session without pressing it, to the end.
  for (let step = 0; step < 150 && !(await end.isVisible()); step++) {
    await expect(end.or(next).or(seen).or(idk).or(option).first()).toBeVisible();
    if (await end.isVisible()) break;
    if (await next.isVisible()) await next.click();
    else if (await seen.isVisible()) await seen.click();
    else if (await idk.isVisible()) await idk.click();
    else await option.click();
  }
  await expect(end).toBeVisible();
  await expect(page.getByText(/^فردا/)).toBeVisible({ timeout: 20_000 });

  // The word claimed known is in «کلمه‌های من»: it has a card, checked later by writing (PRD §5.6).
  await page.goto("/learn/fr/words");
  await expect(page.getByRole("heading", { name: "کلمه‌های من" })).toBeVisible();
  await expect(page.locator(".entries a.entry").filter({ hasText: word }).first()).toBeVisible();
});

test("the reading skip exam: offered on the sheet, left half-way, found again, failed, then a date for the next try", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await signIn(page, E2E_EXAMINERS[testInfo.project.name as keyof typeof E2E_EXAMINERS]);

  // Vocabulary: A2 has no words yet, so the sheet says the next level is coming and has no exam.
  await page.getByRole("button", { name: "جزئیات واژگان" }).click();
  await expect(page.locator('[data-exam="soon"]')).toHaveText("سطح بعد به‌زودی");
  await expect(page.locator('a[data-exam]')).toHaveCount(0);
  await page.goto("/learn/fr");

  // Reading: the exam to A2 is on offer.
  await page.getByRole("button", { name: "جزئیات خواندن" }).click();
  const offer = page.locator('a[data-exam="ready"]');
  await expect(offer).toHaveText("پرش به A2");
  await page.screenshot({ path: testInfo.outputPath("exam-offer.png"), fullPage: true });
  await offer.click();
  await expect(page).toHaveURL(/\/learn\/fr\/exam\/reading$/);
  await expect(page.locator("[data-exam-intro]")).toHaveText("پرش از A1 به A2");
  await page.getByRole("button", { name: "شروع آزمون" }).click();

  // The first text, under its last attempt's conditions: no help, no translation.
  const part = page.locator("[data-exam-part]");
  await expect(part).toContainText(/متن (1|۱) از (2|۲)/);
  await expect(page.locator(".tx-line").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "ترجمه", exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("exam-text.png"), fullPage: true });

  // «بعداً ادامه می‌دهم»: home, and the sheet now resumes the exam.
  await page.getByRole("button", { name: "بعداً ادامه می‌دهم" }).click();
  await expect(page).toHaveURL(/\/learn\/fr$/);
  await page.getByRole("button", { name: "جزئیات خواندن" }).click();
  const resume = page.locator('a[data-exam="running"]');
  await expect(resume).toHaveText("ادامه آزمون پرش");
  await resume.click();
  await expect(part).toContainText(/متن (1|۱) از (2|۲)/);

  // One answer in each text and the rest left: too few right for the 80% a pass needs.
  await page.locator(".tx-q .opt").first().click();
  await page.getByRole("button", { name: "ثبت جواب‌ها" }).click();
  await expect(part).toContainText(/متن (2|۲) از (2|۲)/);
  await page.locator(".tx-q .opt").first().click();
  await page.getByRole("button", { name: "ثبت جواب‌ها" }).click();
  const result = page.locator("[data-exam-result]");
  await expect(result).toHaveAttribute("data-exam-result", "failed");
  await expect(page.getByText(/٪ درست$/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("exam-failed.png"), fullPage: true });
  await page.getByRole("button", { name: "برگشت به خانه" }).click();
  await expect(page).toHaveURL(/\/learn\/fr$/);

  // Seven days before another try (exam.cooldown_days): the date instead of the button.
  await page.getByRole("button", { name: "جزئیات خواندن" }).click();
  await expect(page.locator('[data-exam="wait"]')).toContainText("آزمون پرش به A2 را از");
  await expect(page.locator('a[data-exam]')).toHaveCount(0);
});

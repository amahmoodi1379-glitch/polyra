import { expect, test, type Page } from "@playwright/test";
import { E2E_ACCOUNT_ADMINS, E2E_LOST, E2E_LOST_NEW, E2E_MOVER_NEW, E2E_MOVERS } from "./database";

/**
 * The account (PRD §15.5) and the settings' other rows, one run per browser size:
 * - a learner moves to a new number from the settings (the code goes to the new number), reads
 *   «پشتیبانی» and «قوانین و حریم خصوصی», deletes the account, and the number then starts empty;
 * - a teacher gives a learner who lost their number a new one from «کاربران», and the learner signs in
 *   with it to the same home; the change shows in «تاریخچه تغییرها».
 */

// Its own address: the learner server allows 10 code requests an hour from one (PRD §15.5).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.0.1.83" } });

type Project = keyof typeof E2E_MOVERS;
/** «09120000083» as the app shows it: «۰۹۱۲ ۰۰۰ ۰۰۸۳». */
const shown = (phone: string) => `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`.replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);

async function signIn(page: Page, phone: string, next: string, landing: RegExp) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page).toHaveURL(landing);
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "تنظیمات" }).click();
  await expect(page.getByRole("heading", { name: "تنظیمات" })).toBeVisible();
}

test("a learner moves to a new number, reads support and the terms, then deletes the account", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const project = testInfo.project.name as Project;
  const old = E2E_MOVERS[project];
  const fresh = E2E_MOVER_NEW[project];
  await signIn(page, old, "/learn/fr", /\/learn\/fr$/);

  // «تغییر شماره»: the number already in use is refused before any code is sent.
  await openSettings(page);
  await page.getByRole("link", { name: "تغییر شماره" }).click();
  await expect(page).toHaveURL(/\/learn\/fr\/phone$/);
  await expect(page.getByText(shown(old))).toBeVisible();
  await page.getByLabel("شماره تازه").fill(E2E_ACCOUNT_ADMINS[project]);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await expect(page.locator(".form-error")).toContainText("این شماره حساب دیگری در پلیرا دارد");
  await page.getByLabel("شماره تازه").fill(fresh);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await expect(page.locator(".account-lead")).toContainText("کد ۵ رقمی را که به");
  await expect(page.locator(".account-lead")).toContainText(shown(fresh));
  await page.screenshot({ path: testInfo.outputPath("phone-code.png"), fullPage: true });
  await page.locator("[data-test-code]").click();
  await expect(page.locator("[data-phone-done]")).toContainText("شماره‌ات");
  await expect(page.locator("[data-phone-done]")).toContainText(shown(fresh));
  await page.getByRole("link", { name: "برگشت به خانه" }).click();
  await expect(page).toHaveURL(/\/learn\/fr$/);

  // «پشتیبانی» without a text from the teachers yet, and the default terms.
  await openSettings(page);
  await page.getByRole("link", { name: "پشتیبانی" }).click();
  await expect(page.getByText("راه تماس با پشتیبانی هنوز اینجا نوشته نشده.")).toBeVisible();
  await expect(page.getByText("«گزارش اشکال» را بزن")).toBeVisible();
  await page.goto("/terms");
  await expect(page.getByRole("heading", { name: "حریم خصوصی", exact: true })).toBeVisible();
  await expect(page.locator("[data-privacy]")).toContainText("فقط شماره موبایلت");
  await expect(page.getByRole("heading", { name: "قوانین استفاده", exact: true })).toBeVisible();

  // «حذف حساب»: two presses; the login page then says it is done.
  await page.goto("/learn/fr");
  await openSettings(page);
  await page.getByRole("link", { name: "حذف حساب" }).click();
  await expect(page).toHaveURL(/\/learn\/fr\/delete$/);
  await page.locator("[data-delete-account]").click();
  await expect(page.locator(".confirm")).toContainText("مطمئنی؟ این کار برنمی‌گردد.");
  await page.screenshot({ path: testInfo.outputPath("delete-confirm.png"), fullPage: true });
  await page.getByRole("button", { name: "نه، بمانَد" }).click();
  await expect(page.locator(".confirm")).toHaveCount(0);
  await page.locator("[data-delete-account]").click();
  await page.getByRole("button", { name: "بله، برای همیشه حذف کن" }).click();
  await expect(page).toHaveURL(/\/login\?deleted=1$/);
  await expect(page.locator("[data-deleted]")).toHaveText("حسابت حذف شد. اگر روزی برگشتی، با همین صفحه دوباره شروع کن.");

  // The account is gone: the cookie no longer opens the app, and the number starts a new, empty account.
  await page.goto("/learn/fr");
  await expect(page).toHaveURL(/\/login/);
  await signIn(page, fresh, "/", /\/start$/);
});

test("a teacher gives a learner who lost their number a new one, and the learner signs in with it", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const project = testInfo.project.name as Project;
  const lost = E2E_LOST[project];
  const fresh = E2E_LOST_NEW[project];

  // The learner is signed in on a phone they no longer have.
  const learner = await browser.newContext({ ...testInfo.project.use, extraHTTPHeaders: { "x-forwarded-for": "10.0.1.84" } });
  const old = await learner.newPage();
  await signIn(old, lost, "/learn/fr", /\/learn\/fr$/);

  await signIn(page, E2E_ACCOUNT_ADMINS[project], "/admin/users", /\/admin\/users$/);
  // Typed in the search box and opened as soon as it shows (the search once pulled this click back).
  await page.getByRole("searchbox").fill(lost);
  await page.getByRole("link", { name: new RegExp(`دیدن حساب.*${shown(lost)}`) }).click();
  await expect(page).toHaveURL(/\/admin\/users\/\d+$/);
  const form = page.locator("[data-phone-form]");
  await form.getByLabel("شماره تازه").fill(fresh);
  await form.getByRole("button", { name: "عوض کن" }).click();
  await expect(form).toContainText("مطمئنی؟ همه دستگاه‌های این حساب خارج می‌شوند");
  await form.getByRole("button", { name: "بله، عوض کن" }).click();
  await expect(form.getByRole("status")).toContainText(shown(fresh));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(shown(fresh));
  await page.screenshot({ path: testInfo.outputPath("admin-phone.png"), fullPage: true });

  await page.goto("/admin/log?kind=users");
  await expect(page.getByText("تغییر شماره").first()).toBeVisible();

  // The lost phone is signed out; the new number opens the same French home.
  await old.goto("/learn/fr");
  await expect(old).toHaveURL(/\/login/);
  await learner.close();
  const again = await browser.newContext({ ...testInfo.project.use, extraHTTPHeaders: { "x-forwarded-for": "10.0.1.84" } });
  const now = await again.newPage();
  await signIn(now, fresh, "/", /\/learn\/fr$/);
  await again.close();
});

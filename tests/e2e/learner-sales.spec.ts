import { expect, test, type Page } from "@playwright/test";
import { E2E_BUYERS, E2E_PLAN, E2E_SELLERS } from "./database";

/**
 * Sales with the test gateway (PRD §12, §13.2), one run per browser size:
 * - a teacher adds a plan (a price below the floor is refused), takes it off sale, and adds a 20% code;
 *   the same code again is refused, and the change log names both;
 * - a learner whose three free days are over sees the lock page, cancels at the bank once (failed, no
 *   subscription), then pays the plan with the code and is open again; the code is not taken twice;
 * - the teacher finds the order, asks the gateway about the failed one, then grants ten days on the account
 *   and cancels what is left.
 */

// Its own address: the learner server allows 10 code requests an hour from one (PRD §15.5).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.0.1.63" } });
test.describe.configure({ mode: "serial" });

type Project = keyof typeof E2E_BUYERS;
const tag = (project: string) => project.replace("learner-", "").toUpperCase();

async function signIn(page: Page, phone: string, next: string, landing: RegExp) {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page).toHaveURL(landing);
}

test("a teacher adds a plan and a discount code; a too-low price and a taken code are refused", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const project = testInfo.project.name as Project;
  const name = `سه‌ماهه ${tag(project)}`;
  const code = `BAHAR-${tag(project)}`;
  await signIn(page, E2E_SELLERS[project], "/admin/sales", /\/admin\/sales$/);

  await expect(page.locator(`[data-plan-row="${E2E_PLAN.name}"]`)).toContainText("۲۹۰٬۰۰۰ تومان");

  await page.locator("[data-add-plan]").click();
  const form = page.locator("[data-plan-form]");
  await form.getByLabel("نام پلن").fill(name);
  await form.getByLabel("مدت (روز)").fill("۹۰");
  await form.getByLabel("قیمت (تومان)").fill("۵۰۰");
  await form.getByRole("button", { name: "ذخیره" }).click();
  await expect(form.getByText("قیمت باید عددی بین ۱٬۰۰۰ و ۱۰۰٬۰۰۰٬۰۰۰ تومان باشد.")).toBeVisible();
  await form.getByLabel("قیمت (تومان)").fill("۷۵۰٬۰۰۰");
  await form.getByRole("button", { name: "ذخیره" }).click();
  await expect(form).toBeHidden();
  const row = page.locator(`[data-plan-row="${name}"]`);
  await expect(row).toContainText("۷۵۰٬۰۰۰ تومان");
  await expect(row).toContainText("۹۰ روز");

  // Off sale: still listed for the teacher, gone from the learner's plans.
  await row.getByRole("button", { name: `ویرایش ${name}` }).click();
  await page.locator("[data-plan-form]").getByRole("switch", { name: "در فروش" }).click();
  await page.locator("[data-plan-form]").getByRole("button", { name: "ذخیره" }).click();
  await expect(page.locator(`[data-plan-row="${name}"]`)).toContainText("خاموش");

  await page.locator("[data-add-code]").click();
  const codeForm = page.locator("[data-code-form]");
  await codeForm.getByLabel("کد", { exact: true }).fill(code.toLowerCase());
  await codeForm.getByLabel("مقدار تخفیف").fill("20");
  await codeForm.getByLabel("مهلت (چند روز از امروز)").fill("30");
  await codeForm.getByLabel("ظرفیت کل (اختیاری)").fill("5");
  await codeForm.getByRole("button", { name: "ذخیره" }).click();
  await expect(codeForm).toBeHidden();
  const codeRow = page.locator(`[data-code-row="${code}"]`);
  await expect(codeRow).toContainText("۲۰٪");
  await expect(codeRow).toContainText("۰ از ۵ بار استفاده شده");
  await expect(codeRow).toContainText("همه پلن‌ها");

  await page.locator("[data-add-code]").click();
  await page.locator("[data-code-form]").getByLabel("کد", { exact: true }).fill(code);
  await page.locator("[data-code-form]").getByLabel("مقدار تخفیف").fill("10");
  await page.locator("[data-code-form]").getByRole("button", { name: "ذخیره" }).click();
  await expect(page.locator("[data-code-form]").getByText("این کد را قبلاً ساخته‌ای. کد دیگری بنویس.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("sales.png"), fullPage: true });
  await page.locator("[data-code-form]").getByRole("button", { name: "انصراف" }).click();

  await page.goto("/admin/log?kind=sales");
  await expect(page.getByText(code).first()).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();
});

test("a learner whose free days ended cancels at the bank once, then buys with the code and is open again", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const project = testInfo.project.name as Project;
  const code = `bahar-${tag(project).toLowerCase()}`;
  await signIn(page, E2E_BUYERS[project], "/", /\/learn\/fr$/);

  await page.locator("[data-lock-link]").click();
  await expect(page.locator("[data-lock-page]")).toBeVisible();
  await expect(page.getByRole("heading", { name: "دوره رایگان این زبان تمام شده" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("lock.png"), fullPage: true });
  await page.getByRole("link", { name: "ادامه می‌دهم" }).click();
  await expect(page).toHaveURL(/\/learn\/fr\/plans\?plans=1$/);
  // The plan off sale is not offered.
  await expect(page.getByRole("radio", { name: /سه‌ماهه/ })).toHaveCount(0);

  const choose = async () => {
    await page.getByRole("radio", { name: new RegExp(E2E_PLAN.name) }).click();
    await page.getByLabel("کد تخفیف (اگر داری)").fill(code);
    await page.getByRole("button", { name: "اعمال کد" }).click();
    await expect(page.locator("[data-total]")).toContainText("۲۳۲٬۰۰۰ تومان");
    await expect(page.locator("[data-total]")).toContainText("۵۸٬۰۰۰ تومان تخفیف");
    await page.getByRole("button", { name: "پرداخت" }).click();
    await expect(page).toHaveURL(/\/pay\/mock\?/);
    await expect(page.getByText("مبلغ: ۲۳۲٬۰۰۰ تومان")).toBeVisible();
  };

  await choose();
  await page.getByRole("button", { name: "انصراف" }).click();
  await expect(page).toHaveURL(/\/learn\/fr\/subscription\?order=\d+$/);
  await expect(page.locator('[data-pay-result="failed"]')).toBeVisible();
  await expect(page.locator('[data-order][data-status="failed"]')).toHaveCount(1);

  await page.goto("/learn/fr/plans?plans=1");
  await choose();
  await page.getByRole("button", { name: "پرداخت موفق" }).click();
  await expect(page).toHaveURL(/\/learn\/fr\/subscription\?order=\d+$/);
  await expect(page.locator('[data-pay-result="paid"]')).toBeVisible();
  await expect(page.locator('[data-access="fr"]')).toContainText("اشتراک تا");
  await expect(page.locator('[data-order][data-status="paid"]')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath("paid.png"), fullPage: true });

  // A refresh of the return page changes nothing (T43): still one paid order.
  await page.reload();
  await expect(page.locator('[data-order][data-status="paid"]')).toHaveCount(1);

  await page.goto("/learn/fr");
  await expect(page.locator('[data-plan-line="subscription"]')).toBeVisible();
  await expect(page.locator("[data-lock-link]")).toHaveCount(0);

  // One use per person.
  await page.goto("/learn/fr/plans");
  await page.getByLabel("کد تخفیف (اگر داری)").fill(code);
  await page.getByRole("button", { name: "اعمال کد" }).click();
  await expect(page.locator("[data-total]")).toContainText("این کد تخفیف را قبلاً استفاده کرده‌ای.");
});

test("the teacher finds the order, asks the gateway about the failed one, grants ten days and cancels the rest", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const project = testInfo.project.name as Project;
  const code = `BAHAR-${tag(project)}`;
  await signIn(page, E2E_SELLERS[project], "/admin/orders", /\/admin\/orders$/);

  await page.getByRole("link", { name: "ناموفق" }).click();
  const failed = page.locator('[data-order-row][data-status="failed"]', { hasText: code });
  await expect(failed).toHaveCount(1);
  await failed.getByRole("button", { name: "استعلام دوباره" }).click();
  await expect(failed.getByText("درگاه می‌گوید پرداخت نشده.")).toBeVisible();

  await page.getByRole("link", { name: "پرداخت‌شده" }).click();
  const paid = page.locator('[data-order-row][data-status="paid"]', { hasText: code });
  await expect(paid).toContainText("۲۳۲٬۰۰۰ تومان");
  await expect(paid).toContainText("قیمت ۲۹۰٬۰۰۰ تومان");
  await paid.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/admin\/users\/\d+$/);

  const subscriptions = page.locator("[data-subscriptions] [data-subscription]");
  await expect(subscriptions).toHaveCount(1);

  const grant = page.locator("[data-grant-form]");
  await grant.getByRole("radio", { name: "تعداد روز دلخواه" }).click();
  await grant.getByLabel("تعداد روز").fill("10");
  await grant.getByRole("button", { name: "اعطا کن" }).click();
  await expect(grant.getByText("این را خالی نگذار.")).toBeVisible();
  await grant.getByLabel("یادداشت").fill("هدیه آزمایشی");
  await grant.getByRole("button", { name: "اعطا کن" }).click();
  await expect(grant.getByText("ذخیره شد.")).toBeVisible();
  await expect(subscriptions).toHaveCount(2);
  await expect(page.getByText("هدیه آزمایشی").first()).toBeVisible();

  const shorten = page.locator("[data-shorten-form]");
  await shorten.getByRole("radio", { name: "همه باقی‌مانده لغو شود" }).click();
  await shorten.getByLabel("یادداشت").fill("بازپرداخت");
  await shorten.getByRole("button", { name: "لغو کن" }).click();
  await expect(shorten.getByText("مطمئنی؟ دسترسی فرانسوی این حساب از همین الان بسته می‌شود.")).toBeVisible();
  await shorten.getByRole("button", { name: "بله، لغو کن" }).click();
  await expect(shorten.getByText("انجام شد.")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("account-sales.png"), fullPage: true });

  await page.goto("/admin/log?kind=users");
  await expect(page.getByText("باقی‌مانده اشتراک لغو شد").first()).toBeVisible();
  await expect(page.getByText("۱۰ روز اشتراک").first()).toBeVisible();
});

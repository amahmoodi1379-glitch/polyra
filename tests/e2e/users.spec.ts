import { expect, test } from "@playwright/test";
import { E2E_ADMINS } from "./database";

// «کاربران» and «خروجی و ورود فایل» (PRD §13.2, §14.7). A new phone becomes a tester, then a teacher,
// and both changes show in «تاریخچه تغییرها». A word file is checked, then imported. They change the
// shared database, so they run once, on the desktop, from their own address (PRD §15.5).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.0.0.15" } });

const signIn = async (page: import("@playwright/test").Page, path: string, heading: string) => {
  await page.goto(path);
  await page.getByLabel("شماره موبایل").fill(E2E_ADMINS.users);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
};

test("an admin adds a tester, makes them a teacher and finds both changes in the log", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the accounts are shared");
  await signIn(page, "/admin/users", "کاربران");
  await expect(page.getByRole("heading", { name: /معلم‌ها/ })).toBeVisible();

  await page.getByRole("searchbox").fill("۰۹۱۲ ۷۷۷ ۶۶۵۵");
  await expect(page.getByRole("heading", { name: "این شماره هنوز حساب ندارد" })).toBeVisible();
  await page.getByRole("button", { name: "بساز، به‌عنوان آزمایش‌کننده" }).click();
  await expect(page).toHaveURL(/\/admin\/users\/\d+$/);
  await expect(page.getByRole("switch", { name: "آزمایش‌کننده" })).toHaveAttribute("aria-checked", "true");

  await page.getByRole("switch", { name: "معلم (دسترسی به پنل)" }).click();
  await expect(page.getByRole("alertdialog")).toContainText("معلم شود؟");
  await page.getByRole("button", { name: "بله، معلم شود" }).click();
  await expect(page.getByRole("status")).toHaveText("ذخیره شد.");
  await page.getByRole("radiogroup", { name: "پنل با این زبان باز می‌شود" }).getByRole("radio", { name: "آلمانی" }).click();
  await expect(page.getByRole("status")).toHaveText("ذخیره شد.");

  await page.goto("/admin/log?kind=users");
  await expect(page.getByText("حساب تازه").first()).toBeVisible();
  await expect(page.getByText("دسترسی").first()).toBeVisible();

  await page.goto("/admin/users");
  await page.getByRole("link", { name: /۰۹۱۲ ۰۰۰ ۰۰۱۵/ }).click();
  await expect(page.getByRole("switch", { name: "معلم (دسترسی به پنل)" })).toBeDisabled();
});

test("a word file is checked first, then imported", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the words are shared");
  await signIn(page, "/admin/transfer?lang=fr", "خروجی و ورود فایل");

  const file = ["code,lemma,pos,gender,number,meaning_fa,level,concept_fa", "chaise,chaise,noun,f,sg,صندلی,A1,صندلی", "lune,lune,noun,x,sg,ماه,A1,ماه"].join("\n");
  await page.locator('input[type="file"]').setInputFiles({ name: "mots.csv", mimeType: "text/csv", buffer: Buffer.from(file) });
  await expect(page.getByText("اگر وارد کنی:")).toBeVisible();
  await expect(page.getByText("۱ کلمه تازه")).toBeVisible();
  await expect(page.getByText("۱ ردیف رد می‌شود")).toBeVisible();
  await page.getByRole("button", { name: "وارد کن" }).click();
  await expect(page.getByText("فایل وارد شد.")).toBeVisible();

  const response = await page.request.get("/admin/transfer/file?lang=fr&type=words&format=csv");
  expect(response.headers()["content-disposition"]).toMatch(/polyra-fr-words-\d{4}-\d{2}-\d{2}\.csv/);
  expect(await response.text()).toContain("chaise,chaise,noun,f,sg");
});

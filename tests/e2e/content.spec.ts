import { expect, test } from "@playwright/test";
import { E2E_ADMINS } from "./database";

// The four-step path (PRD §13.9) with a word list. It uses the one shared frequency list, so it runs
// once, on the desktop project; the phone layout of these pages is checked by eye.
test.use({ permissions: ["clipboard-read", "clipboard-write"] });

const answer = (items: object[]) => `Here is the list:\n\`\`\`json\n${JSON.stringify({ items, issues: [] }, null, 2)}\n\`\`\``;

test("an admin makes a word list: copy, paste a cut answer, fix the rejected record, finish", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one run is enough for the shared list");

  // A signed-out admin who opens a panel page comes back to that page after login.
  await page.goto("/admin/create");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fcreate$/);
  await page.getByLabel("شماره موبایل").fill(E2E_ADMINS.desktop);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page.getByRole("heading", { name: "ساخت محتوا", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: /^ساخت فهرست .* کلمه بعدی$/ }).click();
  await expect(page).toHaveURL(/\/admin\/batches\/\d+$/);
  await expect(page.getByRole("heading", { name: /فهرست کلمه‌ها/, level: 1 })).toBeVisible();

  await page.locator("label", { hasText: "Gemini" }).click();
  await page.getByRole("button", { name: "کپی پرامپت" }).click();
  await expect(page.getByText("کپی شد برای Gemini")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("maison");

  const items = [
    { lemma: "être", keep: true, pos: "verb", level: "A1", no_card: false, reason: null },
    { lemma: "maison", keep: true, pos: "noun", level: "A1", no_card: false, reason: null },
    { lemma: "une", keep: false, pos: null, level: null, no_card: false, reason: "صورت مؤنث un" },
    { lemma: "manger", keep: true, pos: null, level: "A1", no_card: false, reason: null },
    { lemma: "petit", keep: true, pos: "adj", level: "A1", no_card: false, reason: null },
    { lemma: "aller", keep: true, pos: "verb", level: "A1", no_card: false, reason: null },
  ];
  const full = answer(items);
  const cutAt = full.indexOf('"petit"');

  // The answer arrives in two parts: the chatbot stopped and was told «ادامه بده».
  await page.getByLabel("جواب چت‌بات").fill(full.slice(0, cutAt));
  await page.getByRole("button", { name: "بررسی و ورود" }).click();
  await expect(page.getByText(/بخش اول جواب رسید/)).toBeVisible();
  await page.getByLabel("ادامه جواب").fill(full.slice(cutAt));
  await page.getByRole("button", { name: "بررسی و ورود" }).click();

  await expect(page.getByText("۱ رکورد رد شد", { exact: false })).toBeVisible();
  await expect(page.getByText("«نوع کلمه» نیامده یا خالی است.")).toBeVisible();

  await page.getByRole("button", { name: "کپی پرامپت اصلاحی" }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('"manger"');
  await page.getByLabel("جواب اصلاحی چت‌بات").fill(answer([{ ...items[3], pos: "verb" }]));
  await page.getByRole("button", { name: "ورود جواب اصلاحی" }).click();

  await expect(page.getByRole("heading", { name: "این دسته تمام شد" })).toBeVisible();
  await expect(page.getByText("همه رکوردها ثبت شدند.")).toBeVisible();

  // The workbench now asks for the information of the five new words.
  await page.getByRole("link", { name: "برگشت به میز کار" }).click();
  await expect(page.getByText("۵ کلمه A1 هنوز اطلاعات ندارند")).toBeVisible();
  await expect(page.getByRole("button", { name: "ساخت ۵ کلمه بعدی" })).toBeVisible();
});

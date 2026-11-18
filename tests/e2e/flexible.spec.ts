import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { E2E_ADMINS } from "./database";

// The owner's «more flexible panel» (DECISIONS.md, 18 November): a word and a sentence made by hand, the word
// deleted with the sentence made for it after the panel says so, everything put back from the change log,
// and the full backup downloaded. Shared data, so desktop only.
test("an admin adds a word and a sentence by hand, deletes the word with its sentence, puts both back, and downloads a full backup", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the content is shared");

  await page.goto("/admin/content?lang=de&type=words");
  await page.getByLabel("شماره موبایل").fill(E2E_ADMINS.library);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page.getByRole("heading", { name: "همه محتوا", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "کلمه یا عبارت تازه" }).click();
  await page.getByLabel("کلمه یا عبارت (شکل فرهنگ‌لغتی)").fill("Haus");
  await page.getByLabel("جنس").selectOption("das");
  await page.getByLabel("معنی فارسی (اختیاری)").fill("خانه");
  await page.getByRole("button", { name: "بساز و باز کن" }).click();
  await expect(page).toHaveURL(/\/admin\/content\/words\/\d+$/);

  await page.goto("/admin/content?lang=de&type=sentences");
  await page.getByRole("button", { name: "جمله تازه" }).click();
  await page.getByLabel("جمله", { exact: true }).fill("Das Haus ist neu.");
  await page.getByLabel("ترجمه فارسی").fill("خانه نو است.");
  await page.getByRole("button", { name: "انتخاب کلمه" }).click();
  await page.getByLabel("جست‌وجو در فهرست واژگان").fill("Haus");
  await page.getByRole("button", { name: /Haus/ }).first().click();
  await page.getByLabel("گزینه غلط ۱").fill("Auto");
  await page.getByLabel("گزینه غلط ۲").fill("Buch");
  await page.getByLabel("گزینه غلط ۳").fill("Kind");
  await page.getByRole("button", { name: "بساز و باز کن" }).click();
  await expect(page).toHaveURL(/\/admin\/content\/sentences\/\d+$/);

  await page.goto("/admin/content?lang=de&type=words&q=Haus");
  await page.getByRole("checkbox", { name: "انتخاب Haus" }).check();
  await page.getByRole("button", { name: "وضعیت دیگر" }).click();
  await page.getByRole("menuitem", { name: "حذف" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("۱ مورد برای همیشه حذف می‌شود.");
  await expect(dialog).toContainText("۱ جمله که فقط برای همین‌ها ساخته شده بود");
  await dialog.getByRole("button", { name: "حذف کن" }).click();
  await expect(page.getByText("۱ مورد حذف شد.")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "انتخاب Haus" })).toHaveCount(0);

  await page.goto("/admin/log?kind=words");
  const entry = page.getByRole("listitem").filter({ hasText: "Haus" }).filter({ hasText: "حذف شد." });
  await expect(entry).toContainText("همراهش: ۱ جمله");
  await entry.getByRole("button", { name: "برگردان" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "برگردان" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "حذف برگشت (۱ مورد)." })).toBeVisible();
  await page.goto("/admin/content?lang=de&type=sentences&q=Haus");
  await expect(page.getByText("Das Haus ist neu.")).toBeVisible();

  await page.goto("/admin/transfer");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /دانلود پشتیبان کامل/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^polyra-backup-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.polyra$/);
  const lines = gunzipSync(readFileSync((await download.path())!)).toString("utf8").split("\n");
  expect(lines[0]).toBe("polyra-backup 1");
  expect(lines.some((line) => line.startsWith("T\tword\t") && line.includes('"lemma": "Haus"'))).toBe(true);
  expect(lines.filter(Boolean).at(-1)).toMatch(/^E\t/);
});

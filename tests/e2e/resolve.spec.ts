import { expect, test } from "@playwright/test";
import { E2E_ADMINS } from "./database";

// The resolve page (PRD §13.9) on the German open items of prepare-db. Settling changes the shared
// database, so it runs once, on the desktop project.
test("an admin settles a name, a missing word and a suspect form, each with one decision", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the open items are shared");

  await page.goto("/admin/resolve?lang=de");
  await page.getByLabel("شماره موبایل").fill(E2E_ADMINS.desktop);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page.getByRole("heading", { name: "موارد منتظر تصمیم", level: 1 })).toBeVisible();

  const item = (text: string) => page.locator("[data-item]:not([inert])", { hasText: text });
  const candidates = page.getByRole("region", { name: /کاندیدها/ });
  await expect(candidates.locator("[data-item]")).toHaveCount(2);

  // A plural marked as a name is the listed word.
  await item("Tische").getByRole("button", { name: "همین کلمه فهرست است" }).click();
  await expect(item("Tische")).toHaveCount(0);

  // One missing word in two sentences: the chatbot's code gives the lemma and the word type.
  const brot = item("Brot").first();
  await expect(brot.getByText("در ۲ جمله آمده؛ یک تصمیم برای همه.")).toBeVisible();
  await brot.getByRole("button", { name: "به فهرست اضافه کن" }).click();
  await expect(page.getByLabel("شکل پایه کلمه")).toHaveValue("Brot");
  await expect(brot.getByRole("radio", { name: "اسم", exact: true })).toBeChecked();
  // A2, so the German A1 order that library.spec moves at the same time stays as that test left it.
  await brot.locator("label").filter({ hasText: /^A2$/ }).click();
  await expect(brot.getByRole("radio", { name: "A2" })).toBeChecked();
  await brot.getByRole("button", { name: "اضافه کن", exact: true }).click();
  await expect(page.getByRole("region", { name: /کاندیدها/ })).toHaveCount(0);

  // The suspect form is right.
  await item("«ist»").getByRole("button", { name: "بله، درست است" }).click();
  await expect(page.getByText("فعلاً چیزی منتظر تصمیم نیست.")).toBeVisible();

  // Reloaded, nothing comes back. The list empties as soon as a button is pressed, so the last decision
  // may still be on its way when the page reloads.
  await expect(async () => {
    await page.reload();
    await expect(page.getByText("فعلاً چیزی منتظر تصمیم نیست.")).toBeVisible({ timeout: 1000 });
  }).toPass();
});

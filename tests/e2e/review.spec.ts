import { expect, test } from "@playwright/test";
import { E2E_ADMINS } from "./database";

// «بازبینی» (PRD §13.4, §13.9 step 4): the word prepare-db left waiting is marked «مشکوک» in «همه محتوا»,
// opens on «بازبینی» the way the learner sees it, and is approved there. It changes the shared database,
// so it runs once, on the desktop, from its own address (PRD §15.5).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.0.0.17" } });

test("an admin finds a flagged word, checks it as the learner sees it and approves it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the word is shared");
  await page.goto("/admin/content?lang=fr&type=words&q=pomme");
  await page.getByLabel("شماره موبایل").fill(E2E_ADMINS.review);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page.getByRole("heading", { name: "همه محتوا", level: 1 })).toBeVisible();

  const row = page.getByRole("listitem").filter({ hasText: "pomme" });
  await expect(row.getByText("مشکوک ۱")).toBeVisible();
  await expect(row.getByText("منتظر بازبینی")).toBeVisible();
  await row.getByRole("link").click();
  await expect(page.getByText("معنی دوم آن در «pomme de terre» نیامده.")).toBeVisible();
  await page.getByRole("link", { name: "بازبینی کن" }).click();

  await expect(page.getByRole("heading", { name: "بازبینی", level: 1 })).toBeVisible();
  await expect(page.getByText("معنی دوم آن در «pomme de terre» نیامده.")).toBeVisible();
  const phone = page.locator("[data-phone]");
  await expect(phone.getByText("pomme").first()).toBeVisible();
  await expect(phone.getByText("سیب").first()).toBeVisible();

  await page.getByRole("button", { name: "تأیید", exact: true }).click();
  await expect(page.getByText("pomme", { exact: true })).toHaveCount(0);

  await page.goto("/admin/content?lang=fr&type=words&q=pomme");
  await expect(page.getByRole("listitem").filter({ hasText: "pomme" }).getByText("تأییدشده")).toBeVisible();
  await expect(page.getByText("مشکوک ۱")).toHaveCount(0);
});

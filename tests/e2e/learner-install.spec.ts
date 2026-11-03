import { expect, test, type Page } from "@playwright/test";
import { E2E_INSTALLERS } from "./database";

/**
 * Installing the app (PRD §3.11 row 7, §15.6 «PWA»):
 * - the manifest, its icons and the service worker are served, without the staging password too;
 * - on Chrome for Android the end of the first session offers «نصب», which opens Chrome's install window;
 * - on an iPhone «نصب» shows Safari's two steps instead.
 * A computer's browser never hears it (the other learner tests end sessions on one without it).
 */

// Its own address: the learner server allows 10 code requests an hour from one (PRD §15.5).
test.use({ extraHTTPHeaders: { "x-forwarded-for": "10.0.1.79" } });

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

async function signIn(page: Page, phone: string) {
  await page.goto("/login?next=%2Flearn%2Ffr");
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page).toHaveURL(/\/learn\/fr$/);
}

/** Plays the first session to its end with «نمی‌دانم», «ادامه» and «فهمیدم». */
async function playToEnd(page: Page) {
  const end = page.getByRole("heading", { name: "جلسه تمام شد" });
  const next = page.locator(".fb").getByRole("button", { name: "ادامه" });
  const seen = page.getByRole("button", { name: /^(یاد گرفتم، برو تمرین|فهمیدم، برو تمرین|فهمیدم)$/ });
  const idk = page.getByRole("button", { name: "نمی‌دانم", exact: true });
  const option = page.locator(".opts .opt:not([disabled])").first();
  for (let step = 0; step < 200; step++) {
    await expect(end.or(next).or(seen).or(idk).or(option).first()).toBeVisible();
    if (await end.isVisible()) return;
    if (await next.isVisible()) await next.click();
    else if (await seen.isVisible()) await seen.click();
    else if (await idk.isVisible()) await idk.click();
    else await option.click();
  }
  await expect(end).toBeVisible();
}

test("the manifest, its icons and the service worker are served", async ({ request }) => {
  const manifest = await request.get("/manifest.webmanifest");
  expect(manifest.ok()).toBe(true);
  const body = await manifest.json();
  expect(body).toMatchObject({ name: "polyra", start_url: "/", display: "standalone", dir: "rtl", lang: "fa" });
  for (const icon of body.icons as { src: string; sizes: string }[]) {
    const file = await request.get(icon.src);
    expect(file.ok(), icon.src).toBe(true);
    expect(file.headers()["content-type"]).toBe("image/png");
  }
  expect((await request.get("/icons/apple-touch-icon.png")).ok()).toBe(true);

  const worker = await request.get("/sw.js");
  expect(worker.ok()).toBe(true);
  expect(worker.headers()["content-type"]).toContain("javascript");
  expect(await worker.text()).toContain("polyra-media");
});

test.describe("on a phone", () => {
  // A phone's install window; the desktop run checks the files only.
  test.beforeEach(({}, testInfo) => test.skip(testInfo.project.name !== "learner-phone", "phone only"));

  test("Chrome on Android: «نصب» after the first session opens the install window", async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    // Chrome's own event, as Chrome sends it on every page that can be installed; «نصب» calls its prompt().
    // Sent again every little while, so the page has its listener ready whatever its speed.
    await page.addInitScript(() => {
      const state = window as unknown as { prompted?: boolean };
      const send = () => {
        if (state.prompted) return;
        const event = new Event("beforeinstallprompt") as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
        event.prompt = async () => {
          state.prompted = true;
        };
        event.userChoice = Promise.resolve({ outcome: "accepted" });
        window.dispatchEvent(event);
      };
      window.setInterval(send, 300);
    });
    await signIn(page, E2E_INSTALLERS.android);
    await page.getByRole("button", { name: "شروع جلسه" }).click();
    await expect(page).toHaveURL(/\/learn\/fr\/session/);
    await playToEnd(page);

    const note = page.locator('.end-note[data-message="install"]');
    await expect(note).toContainText("اپ را به صفحه گوشی‌ات اضافه کن تا با یک لمس باز شود.");
    await page.screenshot({ path: testInfo.outputPath("install-android.png"), fullPage: true });
    await note.getByRole("button", { name: "نصب" }).click();
    await expect(page.locator('.end-note[data-message="install"]')).toContainText("اپ روی صفحه گوشی‌ات نشست.");
    expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);
  });

  test.describe("Safari on an iPhone", () => {
    test.use({ userAgent: IPHONE_UA });

    test("«نصب» shows the two steps, and «باشه» closes them", async ({ page }, testInfo) => {
      test.setTimeout(240_000);
      await signIn(page, E2E_INSTALLERS.ios);
      await page.getByRole("button", { name: "شروع جلسه" }).click();
      await expect(page).toHaveURL(/\/learn\/fr\/session/);
      await playToEnd(page);

      const note = page.locator('.end-note[data-message="install"]');
      await expect(note).toBeVisible();
      await note.getByRole("button", { name: "نصب" }).click();
      const steps = note.locator(".install-steps li");
      await expect(steps.nth(0)).toContainText("دکمه اشتراک‌گذاری");
      await expect(steps.nth(1)).toContainText("Add to Home Screen");
      await page.screenshot({ path: testInfo.outputPath("install-ios.png"), fullPage: true });
      await note.getByRole("button", { name: "باشه" }).click();
      await expect(note).toHaveCount(0);
    });
  });
});

import { expect, test } from "@playwright/test";
import { E2E_ADMINS } from "./database";

/** A tone as a 16-bit mono WAV file, which every Chromium can decode. */
function wav(ms: number, rate = 24000) {
  const samples = Math.round((ms / 1000) * rate);
  const bytes = Buffer.alloc(44 + samples * 2);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + samples * 2, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(rate, 24);
  bytes.writeUInt32LE(rate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) bytes.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 220 * i) / rate)), 44 + i * 2);
  return bytes;
}

// «صدا» (PRD §13.8) on the German verb of prepare-db: a teacher's file is prepared in the browser,
// sent, then heard on the word's page. It changes the shared database, so it runs once, on the desktop.
test("an admin puts a recording on a word and marks it heard", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the recording is shared");

  await page.goto("/admin/audio?lang=de&tab=none&type=words");
  await page.getByLabel("شماره موبایل").fill(E2E_ADMINS.audio);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
  await expect(page.getByRole("heading", { name: "صدا", level: 1 })).toBeVisible();

  const rows = page.locator("[data-audio-slot]").filter({ hasText: "sein" });
  await rows.locator('input[type="file"]').setInputFiles({ name: "sein.wav", mimeType: "audio/wav", buffer: wav(900) });
  await expect(rows.getByText("صدای تازه")).toBeVisible();
  await rows.getByRole("button", { name: "نگه دار" }).click();
  // It has a file now, so it leaves «بدون فایل» for «شنیدن».
  await expect(rows).toHaveCount(0);

  await page.getByRole("link", { name: /^شنیدن/ }).click();
  const heard = page.locator("[data-audio-slot]").filter({ hasText: "sein" });
  await expect(heard.getByText("هنوز شنیده نشده")).toBeVisible();
  await heard.getByRole("link", { name: "sein" }).click();
  await expect(page.getByRole("heading", { name: "sein" })).toBeVisible();
  const card = page.locator("[data-audio-slot]").first();
  await card.getByRole("button", { name: "شنیدم، درست است" }).click();
  await expect(card.getByText("شنیده شد")).toBeVisible();

  await page.goto("/admin/audio?lang=de&tab=listen&type=words");
  await expect(page.getByText("فایلی منتظر شنیدن نیست.")).toBeVisible();
});

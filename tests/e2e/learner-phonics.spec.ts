import { expect, test, type Page } from "@playwright/test";
import { E2E_PHONICS } from "./database";

/**
 * «الفبا و تلفظ» (PRD §8) on the French demo's three lessons, one of each kind: without a voice for French
 * the round leaves the session and says why; with one, a learner from zero plays round 1 of the rule,
 * contrast and liaison lessons from the lessons page, and the opened lessons can be read again.
 */

async function signIn(page: Page, phone: string) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
  await page.getByLabel("شماره موبایل").fill(phone);
  await page.getByRole("button", { name: "دریافت کد" }).click();
  await page.locator("[data-test-code]").click();
}

/** A French voice for the browser, which has none here: it "reads" every text at once. */
function fakeFrenchVoice() {
  const voice = { lang: "fr-FR", name: "Test", voiceURI: "test", localService: true, default: true };
  class Utterance {
    text: string;
    lang = "";
    rate = 1;
    voice: unknown = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: () => [voice],
    speak: (utterance: Utterance) => window.setTimeout(() => utterance.onend?.(), 30),
    cancel: () => {},
    pause: () => {},
    resume: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
  Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
}

/** Answers one round to its end: the first choice, the first sound with «بررسی», or the first gap with «ثبت». */
async function playRound(page: Page): Promise<string[]> {
  const end = page.getByRole("heading", { name: "جلسه تمام شد" });
  const next = page.locator(".fb").getByRole("button", { name: "ادامه" });
  const sound = page.locator(".opts.snd3 .opt").first();
  const tie = page.locator(".liaison .tie").first();
  const option = page.locator(".opts .opt:not([disabled])").first();
  const kinds: string[] = [];
  for (let step = 0; step < 30; step++) {
    await expect(end.or(next).or(sound).or(tie).or(option).first()).toBeVisible();
    if (await end.isVisible()) return kinds;
    if (await next.isVisible()) {
      await next.click();
      continue;
    }
    if (await sound.isVisible()) {
      kinds.push("sound");
      await sound.click();
      await expect(sound).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "بررسی" }).click();
    } else if (await tie.isVisible()) {
      kinds.push("liaison");
      await tie.click();
      await expect(tie).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("button", { name: "ثبت", exact: true }).click();
    } else {
      kinds.push((await page.locator(".snd-row").isVisible()) ? "same" : "spelling");
      await option.click();
    }
    await expect(next).toBeVisible();
  }
  throw new Error("The round did not end");
}

test("a learner from zero plays round 1 of each kind of phonics lesson and reads them again", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  await signIn(page, E2E_PHONICS[testInfo.project.name as keyof typeof E2E_PHONICS]);
  await expect(page).toHaveURL(/\/learn\/fr$/);

  // No French voice in this browser: the round cannot be heard, so it leaves the session and the lesson waits.
  await page.goto("/learn/fr/session?scope=phonics");
  await expect(page.getByRole("heading", { name: "درس تلفظ بدون صدا نمی‌شود" })).toBeVisible();
  await expect(page.getByText(/صدای فرانسوی ندارد/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phonics-no-voice.png"), fullPage: true });
  await page.getByRole("link", { name: "الفبا و تلفظ" }).click();
  await expect(page).toHaveURL(/\/learn\/fr\/phonics$/);
  const lessons = page.getByRole("list", { name: "درس‌ها" }).locator(".entry");
  await expect(lessons).toHaveCount(3);
  await expect(lessons.nth(0)).toContainText("درس بعدی");
  await expect(lessons.nth(1)).toContainText("بعد از درس قبلی");
  await expect(page.locator("a.entry")).toHaveCount(0);

  // With a voice: from the home page's link, three rounds one after the other.
  await page.addInitScript(fakeFrenchVoice);
  await page.goto("/learn/fr");
  await page.getByRole("link", { name: /الفبا و تلفظ/ }).click();
  await expect(page).toHaveURL(/\/learn\/fr\/phonics$/);
  await page.screenshot({ path: testInfo.outputPath("phonics-page.png"), fullPage: true });

  const rounds = [
    { label: "حرف‌های خاموش: آخر کلمه و h", kinds: ["spelling"] },
    { label: "u و ou", kinds: ["spelling", "sound"] },
    { label: "liaison و enchaînement", kinds: ["liaison"] },
  ];
  for (const [index, round] of rounds.entries()) {
    await page.getByRole("link", { name: /^شروع درس/ }).click();
    await expect(page).toHaveURL(/\/learn\/fr\/session\?scope=phonics$/);
    await expect(page.getByRole("heading", { name: round.label })).toBeVisible();
    // Opened from the lessons page, the round is not the auto one: no «بعداً».
    await expect(page.getByRole("button", { name: "بعداً" })).toHaveCount(0);
    if (index === 2) await expect(page.locator(".phon-list li")).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath(`phonics-lead-${index + 1}.png`), fullPage: true });
    await page.getByRole("button", { name: "شروع", exact: true }).click();
    const kinds = await playRound(page);
    expect(kinds).toHaveLength(index === 2 ? 4 : 6);
    expect([...new Set(kinds)].sort()).toEqual([...round.kinds].sort());
    // The answers are saved before the next round is asked for.
    await expect(page.getByText(/^فردا/)).toBeVisible({ timeout: 20_000 });
    await page.goto("/learn/fr/phonics");
  }

  // Every round 1 done today: round 2 opens tomorrow, and each lesson can be read and heard again.
  await expect(page.getByText("دور بعدی از فردا")).toBeVisible();
  await expect(page.locator("a.entry")).toHaveCount(3);
  for (const entry of await page.locator("a.entry").all()) await expect(entry).toContainText("دور دوم از فردا");
  await page.locator("a.entry").nth(1).click();
  await expect(page).toHaveURL(/\/learn\/fr\/phonics\/\d+$/);
  await expect(page.getByRole("heading", { name: "u و ou" })).toBeVisible();
  // The whole lesson: its example words and its pairs, which no round's start shows.
  await expect(page.locator(".phon-list li.pair")).toHaveCount(6);
  await page.screenshot({ path: testInfo.outputPath("phonics-lesson.png"), fullPage: true });
});

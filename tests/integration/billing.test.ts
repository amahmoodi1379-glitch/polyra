import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { tehranDate } from "@/engine/time";
import { grantAccess, savePlan, saveCode, shortenSubscription, checkPlan } from "@/server/billing/admin";
import { mockGateway, mockPay, useGateway, type PaymentGateway } from "@/server/billing/gateway";
import { followUpMine, quote, returnFromGateway, startOrder, sweepOrders } from "@/server/billing/orders";
import { accessEnd } from "@/server/billing/subscriptions";
import { loadDemo } from "@/server/content/demo";
import { listLog } from "@/server/content/library/history";
import { db } from "@/server/db";
import { canPractice } from "@/server/learn/access";
import { forgetContent, learnerContent } from "@/server/learn/content";
import { startFromZero } from "@/server/learn/enroll";
import { homeData } from "@/server/learn/home";
import { submitAnswer } from "@/server/learn/answer";
import { startSession } from "@/server/learn/session";
import { saveItemState } from "@/server/learn/writes";
import { newItemState } from "@/engine/answer";
import { resetDb, testDb } from "./db";

/**
 * Sales (PRD §12): the free period from the end of the first session, access per language, plans with
 * the validity rule, discount codes, the payment flow with verify, a repeated return, the follow-up of
 * an order nobody came back from, manual grants and refunds, and separate modules.
 */

const NOW = new Date("2026-11-01T08:00:00Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let phones = 0;
let admin: { id: number };

type Person = { id: number; is_admin: boolean; is_tester: boolean; phone: string };

async function person(): Promise<Person> {
  const phone = `+98912700${String(++phones).padStart(4, "0")}`;
  const user = await testDb.user.create({ data: { phone, session_length_min: 10 } });
  return { id: user.id, is_admin: false, is_tester: false, phone };
}

async function enrolled(language: "fr" | "de" = "fr", at = NOW): Promise<Person> {
  const user = await person();
  await startFromZero(user, language, at);
  return user;
}

/** Makes the demo content public: published and A1 released, as a teacher would on «انتشار». */
async function publishDemo() {
  const tables = await testDb.$queryRawUnsafe<{ table_name: string }[]>(
    "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'status' AND udt_name = 'content_status'",
  );
  for (const { table_name } of tables) await testDb.$executeRawUnsafe(`UPDATE "public"."${table_name}" SET status = 'published' WHERE status = 'approved'`);
  await testDb.levelRelease.create({ data: { language: "fr", level: "A1" } });
  forgetContent();
}

const plan = (over: Partial<{ language: string; duration_days: number; price_toman: number; name_fa: string }> = {}) =>
  testDb.plan.create({ data: { language: "fr", name_fa: "ماهانه", duration_days: 30, price_toman: 200_000, module_codes: [], ...over } });

beforeAll(async () => {
  await resetDb();
  await testDb.language.createMany({ data: [{ code: "fr" }, { code: "de" }] });
  expect(await loadDemo()).toMatchObject({ kind: "loaded" });
  await publishDemo();
  admin = await testDb.user.create({ data: { phone: "+989127999999", session_length_min: 15, is_admin: true, admin_language: "all" } });
}, 120_000);

afterEach(() => useGateway(null));
afterAll(() => testDb.$disconnect());

describe("the free period and access (PRD §12.1, §12.5)", () => {
  it("T93: no free period until the first session closes, even after placement days; it starts when the session expires", { timeout: 60_000 }, async () => {
    const user = await enrolled();
    const later = new Date(NOW.getTime() + 2 * DAY);
    const started = await startSession(user, { language: "fr", scope: "mixed", noAudio: false, cap: "more" }, later);
    expect(started.kind).toBe("session");
    expect(await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } })).toMatchObject({ trial_started_at: null });
    // The session left alone is closed six hours after it was made: the free period starts then and lasts 72 hours.
    const sixLater = new Date(later.getTime() + 7 * HOUR);
    const next = await startSession(user, { language: "fr", scope: "mixed", noAudio: false, cap: "more" }, sixLater);
    expect(next.kind).toBe("session");
    const row = await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id } });
    expect(row.trial_started_at).not.toBeNull();
    expect(row.trial_ends_at!.getTime() - row.trial_started_at!.getTime()).toBe(72 * HOUR);
    expect(await testDb.trialLedger.count()).toBeGreaterThan(0);
  });

  it("T40: a session made a minute before the end is allowed, a minute after is locked, and answers to the earlier one are taken after the end", { timeout: 60_000 }, async () => {
    const user = await enrolled();
    const end = new Date(NOW.getTime() + 10 * HOUR);
    await testDb.enrollment.updateMany({ where: { user_id: user.id }, data: { trial_started_at: new Date(end.getTime() - 72 * HOUR), trial_ends_at: end } });
    const before = await startSession(user, { language: "fr", scope: "mixed", noAudio: false, cap: "more" }, new Date(end.getTime() - 60_000));
    if (before.kind !== "session") throw new Error(before.kind);
    const card = before.bundle.plan.queue[0];
    const after = new Date(end.getTime() + 60_000);
    const answer = await submitAnswer(user, { sessionId: before.bundle.id, answerId: randomUUID(), seq: before.bundle.nextSeq, cardId: card.id, answer: { seen: true }, latencyMs: 3000, elapsedSec: 3, at: after.toISOString(), shown: null }, after);
    expect(answer.kind).toBe("ok");
    // A new session after the end (the open one replaced) is locked.
    expect((await startSession(user, { language: "fr", scope: "mixed", noAudio: false, cap: "more", replace: true }, after)).kind).toBe("locked");
  });

  it("T41: an active French subscription and a German free period that ended: French open, German locked", async () => {
    const user = await enrolled("fr");
    await startFromZero(user, "de", NOW);
    await testDb.enrollment.updateMany({ where: { user_id: user.id }, data: { trial_started_at: new Date(NOW.getTime() - 100 * HOUR), trial_ends_at: new Date(NOW.getTime() - 28 * HOUR) } });
    await testDb.subscription.create({ data: { user_id: user.id, language: "fr", starts_at: NOW, ends_at: new Date(NOW.getTime() + 30 * DAY), source: "manual" } });
    const fr = await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id, language: "fr" } });
    const de = await testDb.enrollment.findFirstOrThrow({ where: { user_id: user.id, language: "de" } });
    expect(await canPractice(db, user, fr, NOW)).toBe(true);
    expect(await canPractice(db, user, de, NOW)).toBe(false);
  });

  it("the lock page's summary: words learned, reviews waiting and the streak's last day; none while open", { timeout: 60_000 }, async () => {
    const user = await enrolled();
    expect((await homeData(user, "fr", NOW))?.lockSummary).toBeNull();
    const words = await testDb.word.findMany({ where: { language: "fr", no_card: false }, take: 5, orderBy: { intro_order: "asc" } });
    await db.$transaction(async (tx) => {
      for (const word of words) await saveItemState(tx, { userId: user.id, language: "fr" }, newItemState("word", word.id, new Date(NOW.getTime() - 5 * DAY)));
    });
    const yesterday = tehranDate(new Date(NOW.getTime() - DAY));
    await testDb.enrollment.updateMany({
      where: { user_id: user.id },
      data: { trial_started_at: new Date(NOW.getTime() - 100 * HOUR), trial_ends_at: new Date(NOW.getTime() - HOUR), streak_count: 4, streak_last_date: new Date(`${yesterday}T00:00:00Z`) },
    });
    const home = await homeData(user, "fr", NOW);
    expect(home?.locked).toBe(true);
    expect(home?.lockSummary).toMatchObject({ words: 5, reviews: 5, streak: { count: 4 } });
  });
});

describe("plans, prices and codes (PRD §12.2, §12.3)", () => {
  it("T42: a 30-day plan bought in the free period ends 30 days after the free period", async () => {
    const user = await enrolled();
    const trialEnd = new Date(NOW.getTime() + 50 * HOUR);
    await testDb.enrollment.updateMany({ where: { user_id: user.id }, data: { trial_started_at: new Date(NOW.getTime() - 22 * HOUR), trial_ends_at: trialEnd } });
    const monthly = await plan();
    const started = await startOrder(user, monthly.id, null, "http://localhost/pay/return", NOW, mockGateway);
    if (started.kind !== "redirect") throw new Error(started.kind);
    const order = await testDb.order.findUniqueOrThrow({ where: { id: started.orderId } });
    expect(mockPay(order.authority!)).toBe(true);
    expect((await returnFromGateway(user.id, order.id, NOW, mockGateway)).kind).toBe("paid");
    const sub = await testDb.subscription.findFirstOrThrow({ where: { user_id: user.id } });
    expect(sub.ends_at.getTime()).toBe(trialEnd.getTime() + 30 * DAY);
    // Renewing early adds after the current end: no day is lost.
    const again = await startOrder(user, monthly.id, null, "http://localhost/pay/return", NOW, mockGateway);
    if (again.kind !== "redirect") throw new Error(again.kind);
    mockPay((await testDb.order.findUniqueOrThrow({ where: { id: again.orderId } })).authority!);
    await returnFromGateway(user.id, again.orderId, NOW, mockGateway);
    expect((await accessEnd(db, user.id, "fr")).subscriptionEnd!.getTime()).toBe(trialEnd.getTime() + 60 * DAY);
  });

  it("T43: the return address opened twice (a refresh) makes one subscription; another person's return does nothing", async () => {
    const user = await enrolled();
    const monthly = await plan();
    const started = await startOrder(user, monthly.id, null, "http://localhost/pay/return", NOW, mockGateway);
    if (started.kind !== "redirect") throw new Error(started.kind);
    mockPay((await testDb.order.findUniqueOrThrow({ where: { id: started.orderId } })).authority!);
    const other = await enrolled();
    expect((await returnFromGateway(other.id, started.orderId, NOW, mockGateway)).kind).toBe("unknown");
    const [a, b] = await Promise.all([returnFromGateway(user.id, started.orderId, NOW, mockGateway), returnFromGateway(user.id, started.orderId, NOW, mockGateway)]);
    expect([a.kind, b.kind]).toEqual(["paid", "paid"]);
    expect((await returnFromGateway(user.id, started.orderId, NOW, mockGateway)).kind).toBe("paid");
    expect(await testDb.subscription.count({ where: { user_id: user.id } })).toBe(1);
    expect(await testDb.order.findUniqueOrThrow({ where: { id: started.orderId } })).toMatchObject({ status: "paid", gateway_ref: expect.any(String) });
  });

  it("cancelled at the bank: failed, no subscription; the price comes from the plan, never the browser", async () => {
    const user = await enrolled();
    const monthly = await plan({ price_toman: 150_000 });
    const started = await startOrder(user, monthly.id, null, "http://localhost/pay/return", NOW, mockGateway);
    if (started.kind !== "redirect") throw new Error(started.kind);
    expect(await testDb.order.findUniqueOrThrow({ where: { id: started.orderId } })).toMatchObject({ amount_toman: 150_000, final_amount: 150_000, status: "pending" });
    expect((await returnFromGateway(user.id, started.orderId, NOW, mockGateway)).kind).toBe("failed");
    expect(await testDb.subscription.count({ where: { user_id: user.id } })).toBe(0);
    // An inactive plan is not sold.
    await testDb.plan.update({ where: { id: monthly.id }, data: { active: false } });
    expect((await startOrder(user, monthly.id, null, "http://localhost/pay/return", NOW, mockGateway)).kind).toBe("refused");
  });

  it("T44: a code with one use in all: the second person is refused with its reason; a use counts only when paid", async () => {
    const monthly = await plan();
    await testDb.discountCode.create({ data: { code: "ONCE", type: "percent", value: 20, max_uses_total: 1 } });
    const first = await enrolled();
    const second = await enrolled();
    // Typed in lower case with spaces: the same code. 20% of 200,000.
    expect(await quote(db, first.id, monthly.id, " once ", NOW)).toMatchObject({ ok: true, off: 40_000, final: 160_000 });
    const left = await startOrder(first, monthly.id, "once", "http://localhost/pay/return", NOW, mockGateway);
    if (left.kind !== "redirect") throw new Error(left.kind);
    // Not paid yet: the code is still free for the second person.
    expect(await quote(db, second.id, monthly.id, "ONCE", NOW)).toMatchObject({ ok: true });
    mockPay((await testDb.order.findUniqueOrThrow({ where: { id: left.orderId } })).authority!);
    await returnFromGateway(first.id, left.orderId, NOW, mockGateway);
    expect(await testDb.discountUse.count()).toBe(1);
    expect(await quote(db, second.id, monthly.id, "ONCE", NOW)).toEqual({ ok: false, reason: "code", code: "full" });
    const refused = await startOrder(second, monthly.id, "ONCE", "http://localhost/pay/return", NOW, mockGateway);
    expect(refused).toMatchObject({ kind: "refused", quote: { reason: "code", code: "full" } });
  });

  it("codes: unknown, inactive, not started, ended, another plan, used by this person; a fixed amount; 100% needs no gateway", async () => {
    const monthly = await plan();
    const yearly = await plan({ name_fa: "سالانه", duration_days: 365, price_toman: 1_500_000 });
    const user = await enrolled();
    await testDb.discountCode.createMany({
      data: [
        { code: "OFF", type: "percent", value: 10, active: false },
        { code: "SOON", type: "percent", value: 10, valid_from: new Date(NOW.getTime() + DAY) },
        { code: "OLD", type: "percent", value: 10, valid_to: new Date(NOW.getTime() - DAY) },
        { code: "YEAR", type: "percent", value: 10, plan_ids: [yearly.id] },
        { code: "FIXED", type: "amount", value: 50_000 },
        { code: "GIFT", type: "percent", value: 100 },
      ],
    });
    const reason = async (code: string, planId = monthly.id) => {
      const result = await quote(db, user.id, planId, code, NOW);
      return result.ok ? "ok" : result.reason === "code" ? result.code : result.reason;
    };
    expect(await reason("NOPE")).toBe("unknown");
    expect(await reason("OFF")).toBe("inactive");
    expect(await reason("SOON")).toBe("early");
    expect(await reason("OLD")).toBe("expired");
    expect(await reason("YEAR")).toBe("plan");
    expect(await reason("YEAR", yearly.id)).toBe("ok");
    expect(await quote(db, user.id, monthly.id, "fixed", NOW)).toMatchObject({ ok: true, final: 150_000 });
    const gift = await startOrder(user, monthly.id, "GIFT", "http://localhost/pay/return", NOW, mockGateway);
    expect(gift.kind).toBe("free");
    expect(await testDb.subscription.count({ where: { user_id: user.id } })).toBe(1);
    // Once per person by default.
    expect(await reason("GIFT")).toBe("used");
  });
});

describe("an order nobody came back from (PRD §12.4 steps 6–7)", () => {
  it("T77: a 30-minute pending order the gateway says was paid becomes paid with its subscription; one it says was not, expires", async () => {
    const monthly = await plan();
    const paidUser = await enrolled();
    const lostUser = await enrolled();
    const paid = await startOrder(paidUser, monthly.id, null, "http://localhost/pay/return", NOW, mockGateway);
    const lost = await startOrder(lostUser, monthly.id, null, "http://localhost/pay/return", NOW, mockGateway);
    if (paid.kind !== "redirect" || lost.kind !== "redirect") throw new Error("no redirect");
    mockPay((await testDb.order.findUniqueOrThrow({ where: { id: paid.orderId } })).authority!);
    // Before 30 minutes nothing is asked.
    expect(await sweepOrders(new Date(NOW.getTime() + 10 * 60_000), mockGateway)).toEqual({ paid: 0, expired: 0, waiting: 0 });
    const counts = await sweepOrders(new Date(NOW.getTime() + 31 * 60_000), mockGateway);
    expect(counts).toMatchObject({ paid: 1, expired: 1 });
    expect(await testDb.order.findUniqueOrThrow({ where: { id: paid.orderId } })).toMatchObject({ status: "paid" });
    expect(await testDb.subscription.count({ where: { user_id: paidUser.id } })).toBe(1);
    expect(await testDb.order.findUniqueOrThrow({ where: { id: lost.orderId } })).toMatchObject({ status: "expired" });
    expect(await testDb.subscription.count({ where: { user_id: lostUser.id } })).toBe(0);
  });

  it("«پیگیری پرداخت»: an expired order paid after all becomes paid; a day later it is no longer offered; a gateway that cannot say leaves it", async () => {
    const monthly = await plan();
    const user = await enrolled();
    const order = await startOrder(user, monthly.id, null, "http://localhost/pay/return", NOW, mockGateway);
    if (order.kind !== "redirect") throw new Error(order.kind);
    await sweepOrders(new Date(NOW.getTime() + 31 * 60_000), mockGateway);
    expect(await testDb.order.findUniqueOrThrow({ where: { id: order.orderId } })).toMatchObject({ status: "expired" });
    const silent: PaymentGateway = { ...mockGateway, inquire: async () => "unknown" };
    useGateway(silent);
    expect(await followUpMine(user.id, order.orderId, new Date(NOW.getTime() + HOUR))).toBe("waiting");
    useGateway(mockGateway);
    mockPay((await testDb.order.findUniqueOrThrow({ where: { id: order.orderId } })).authority!);
    expect(await followUpMine(user.id, order.orderId, new Date(NOW.getTime() + 2 * HOUR))).toBe("paid");
    expect(await testDb.subscription.count({ where: { user_id: user.id } })).toBe(1);
    // Someone else's order, and an order over a day old, cannot be followed up.
    const other = await enrolled();
    expect(await followUpMine(other.id, order.orderId, NOW)).toBe("gone");
    const late = await startOrder(user, monthly.id, null, "http://localhost/pay/return", NOW, mockGateway);
    if (late.kind !== "redirect") throw new Error(late.kind);
    expect(await followUpMine(user.id, late.orderId, new Date(NOW.getTime() + 25 * HOUR))).toBe("gone");
  });
});

describe("manual grants and refunds (PRD §12.3)", () => {
  it("a grant of a plan or of days with a note, logged; shortening and cancelling what is left", async () => {
    const user = await enrolled();
    const monthly = await plan();
    expect(await grantAccess(admin.id, user.id, { language: "fr", days: 10, note: "" }, NOW)).toMatchObject({ ok: false, errors: { note: "required" } });
    expect(await grantAccess(admin.id, user.id, { language: "fr", days: 0, note: "هدیه" }, NOW)).toMatchObject({ ok: false, errors: { days: "days" } });
    const granted = await grantAccess(admin.id, user.id, { language: "fr", planId: monthly.id, note: "جبران قطعی" }, NOW);
    expect(granted).toMatchObject({ ok: true });
    expect(await testDb.subscription.findFirstOrThrow({ where: { user_id: user.id } })).toMatchObject({ source: "manual", granted_by: admin.id, note: "جبران قطعی", plan_id: monthly.id });
    await grantAccess(admin.id, user.id, { language: "fr", days: 10, note: "هدیه" }, NOW);
    expect((await accessEnd(db, user.id, "fr")).subscriptionEnd!.getTime()).toBe(NOW.getTime() + 40 * DAY);
    // Fifteen days off come from the end; then a cancel leaves nothing active.
    expect(await shortenSubscription(admin.id, user.id, { language: "fr", days: 15, note: "بازپرداخت" }, NOW)).toMatchObject({ ok: true });
    expect((await accessEnd(db, user.id, "fr")).subscriptionEnd!.getTime()).toBe(NOW.getTime() + 25 * DAY);
    expect(await shortenSubscription(admin.id, user.id, { language: "fr", cancel: true, note: "بازپرداخت کامل" }, NOW)).toMatchObject({ ok: true });
    expect(await testDb.subscription.count({ where: { user_id: user.id, ends_at: { gt: NOW } } })).toBe(0);
    expect(await shortenSubscription(admin.id, user.id, { language: "fr", cancel: true, note: "دوباره" }, NOW)).toMatchObject({ ok: false, errors: { form: "none" } });
    const logs = await testDb.adminLog.findMany({ where: { entity: "user", entity_id: String(user.id) }, orderBy: { id: "asc" } });
    expect(logs.map((row) => row.action)).toEqual(["grant", "grant", "shorten", "shorten"]);
    // «تاریخچه تغییرها» › «کاربران» says each one in Persian: what, the new end, the note.
    const shown = (await listLog("users", 1)).items.filter((item) => item.href === `/admin/users/${user.id}`);
    expect(shown.map((item) => item.actionLabel)).toEqual(["کم کردن اشتراک", "کم کردن اشتراک", "اعطای اشتراک", "اعطای اشتراک"]);
    const [cancelled, , , first] = shown;
    expect(cancelled.lines.map((line) => line.note ?? line.after?.text)).toContain("باقی‌مانده اشتراک لغو شد");
    expect(first.lines[0]).toMatchObject({ label: "فرانسوی", note: "روزهای پلن «ماهانه»، ۳۰ روز" });
    expect(first.lines.find((line) => line.key === "note")).toMatchObject({ note: "جبران قطعی" });
  });

  it("a plan's fields are checked; a code must be unique, case-insensitive", async () => {
    expect(checkPlan({ language: "xx", name_fa: "", duration_days: "0", price_toman: "۵۰۰" })).toMatchObject({ ok: false, errors: { language: "language", name_fa: "required", duration_days: "days", price_toman: "price" } });
    expect(checkPlan({ language: "fr", name_fa: "سه‌ماهه", duration_days: "۹۰", price_toman: "۴۵۰٬۰۰۰" })).toMatchObject({ ok: true, data: { duration_days: 90, price_toman: 450_000 } });
    const saved = await savePlan(admin.id, null, { language: "fr", name_fa: "سه‌ماهه", duration_days: 90, price_toman: 450_000, badge_fa: "پیشنهاد ما" });
    expect(saved.ok).toBe(true);
    expect(await saveCode(admin.id, null, { code: "spring 25", type: "percent", value: 25 })).toMatchObject({ ok: true });
    expect(await saveCode(admin.id, null, { code: "SPRING25", type: "amount", value: 1000 })).toMatchObject({ ok: false, errors: { code: "taken" } });
    expect(await saveCode(admin.id, null, { code: "X", type: "percent", value: 120 })).toMatchObject({ ok: false, errors: { code: "code", value: "percent" } });
    expect(await testDb.adminLog.count({ where: { entity: "sales" } })).toBe(2);
    // An edit is logged with before and after; the change log shows plans and codes by name, never as an item or an order.
    expect(saved.ok && (await savePlan(admin.id, saved.id, { language: "de", name_fa: "سه‌ماهه", duration_days: 90, price_toman: 400_000, badge_fa: "پیشنهاد ما", active: false }))).toMatchObject({ ok: true });
    expect(saved.ok && (await testDb.plan.findUniqueOrThrow({ where: { id: saved.id } }))).toMatchObject({ language: "fr", price_toman: 400_000, active: false });
    const log = await listLog("sales", 1);
    expect(log.items.map((item) => [item.actionLabel, item.kindLabel, item.title?.text])).toEqual([
      ["ویرایش", "پلن", "سه‌ماهه"],
      ["افزودن", "کد تخفیف", "SPRING25"],
      ["افزودن", "پلن", "سه‌ماهه"],
    ]);
    expect(log.items[0].lines).toEqual([
      expect.objectContaining({ key: "price_toman", before: { text: "۴۵۰٬۰۰۰ تومان", voice: "fa" }, after: { text: "۴۰۰٬۰۰۰ تومان", voice: "fa" } }),
      expect.objectContaining({ key: "active", before: { text: "بله", voice: "fa" }, after: { text: "نه", voice: "fa" } }),
    ]);
    expect(log.items.every((item) => item.revert === "no")).toBe(true);
    expect((await listLog(null, 1)).items.filter((item) => item.kindLabel === "پلن" || item.kindLabel === "کد تخفیف")).toHaveLength(3);
  });
});

describe("separate modules (PRD §12.2, T104)", () => {
  it("T104: a separate module's word is hidden with a plain plan and seen with a plan that has the module; common content with both", async () => {
    await testDb.module.create({ data: { code: "exam-prep", language: "fr", name_fa: "آمادگی آزمون", separate: true } });
    const word = await testDb.word.findFirstOrThrow({ where: { language: "fr", no_card: false }, orderBy: { intro_order: "desc" } });
    const common = await testDb.word.findFirstOrThrow({ where: { language: "fr", no_card: false }, orderBy: { intro_order: "asc" } });
    await testDb.word.update({ where: { id: word.id }, data: { module_code: "exam-prep" } });
    forgetContent();
    const plain = await learnerContent("fr", "public", []);
    const withModule = await learnerContent("fr", "public", ["exam-prep"]);
    expect(plain.words.has(word.id)).toBe(false);
    expect(withModule.words.has(word.id)).toBe(true);
    expect(plain.words.has(common.id) && withModule.words.has(common.id)).toBe(true);
    expect((await learnerContent("fr", "tester")).words.has(word.id)).toBe(true);
    await testDb.word.update({ where: { id: word.id }, data: { module_code: null } });
    forgetContent();
  });
});

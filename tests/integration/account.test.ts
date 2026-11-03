import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newItemState } from "@/engine/answer";
import { listLog } from "@/server/content/library/history";
import { phoneHash, startTrialIfFirst } from "@/server/learn/access";
import { changePhone, deleteAccount, deletionNotes, phoneFree } from "@/server/learn/account";
import { startFromZero } from "@/server/learn/enroll";
import { saveItemState } from "@/server/learn/writes";
import { findOrCreateUser } from "@/server/users";
import { resetDb, testDb } from "./db";

/**
 * The account itself (PRD §15.5): a new phone number from the app (the code goes to the new number) or
 * from «کاربران», and deleting the account, with the trial ledger that stops a second free period (§12.1).
 */

const NOW = new Date("2026-11-02T08:00:00Z");
const DAY = 86_400_000;
let phones = 0;
let admin: { id: number };

const nextPhone = () => `+98912800${String(++phones).padStart(4, "0")}`;
/** The same number as a person types it. */
const typed = (phone: string) => `0${phone.slice(3)}`;

async function learner(extra: { is_admin?: boolean; is_tester?: boolean } = {}) {
  const phone = nextPhone();
  const user = await testDb.user.create({ data: { phone, session_length_min: 15, ...extra } });
  return { id: user.id, phone, is_admin: user.is_admin, is_tester: user.is_tester };
}

/** A learner who has started French and whose free period began (their number is in the ledger). */
async function startedLearner() {
  const user = await learner();
  await startFromZero(user, "fr", NOW);
  await testDb.$transaction((tx) => startTrialIfFirst(tx, user.id, "fr", NOW, 72));
  return user;
}

const device = (userId: number, name: string) =>
  testDb.authDevice.create({ data: { user_id: userId, refresh_token_hash: randomUUID() + name, last_seen_at: NOW, created_at: NOW } });

const ledger = (phone: string, language = "fr") => testDb.trialLedger.findUnique({ where: { phone_hash_language: { phone_hash: phoneHash(phone), language } } });

beforeAll(async () => {
  await resetDb();
  await testDb.language.createMany({ data: [{ code: "fr" }, { code: "de" }] });
  admin = await testDb.user.create({ data: { phone: "+989128999999", session_length_min: 15, is_admin: true, admin_language: "all" } });
});
afterAll(() => testDb.$disconnect());

describe("a new phone number (PRD §15.5)", () => {
  it("is checked before a code is sent: not a number, the same number, a number with an account", async () => {
    const user = await learner();
    const other = await learner();
    expect(await phoneFree(user.id, "12345")).toEqual({ ok: false, reason: "invalid" });
    expect(await phoneFree(user.id, typed(user.phone))).toEqual({ ok: false, reason: "same" });
    expect(await phoneFree(user.id, typed(other.phone))).toEqual({ ok: false, reason: "taken" });
    const fresh = nextPhone();
    expect(await phoneFree(user.id, typed(fresh))).toEqual({ ok: true, phone: fresh });
  });

  it("from the app: progress and subscriptions stay, other devices sign out, and the new number joins the ledger", async () => {
    const user = await startedLearner();
    const here = await device(user.id, "here");
    await device(user.id, "phone");
    await device(user.id, "laptop");
    await testDb.$transaction((tx) => saveItemState(tx, { userId: user.id, language: "fr" }, newItemState("word", 41, NOW)));
    await testDb.subscription.create({ data: { user_id: user.id, language: "fr", starts_at: NOW, ends_at: new Date(NOW.getTime() + 30 * DAY), source: "manual" } });
    const fresh = nextPhone();

    expect(await changePhone(user.id, typed(fresh), { keepDevice: here.id, adminId: null }, NOW)).toEqual({ ok: true, phone: fresh });
    expect((await testDb.user.findUniqueOrThrow({ where: { id: user.id } })).phone).toBe(fresh);
    expect((await testDb.authDevice.findMany({ where: { user_id: user.id } })).map((row) => row.id)).toEqual([here.id]);
    expect(await testDb.itemState.count({ where: { user_id: user.id } })).toBe(1);
    expect(await testDb.subscription.count({ where: { user_id: user.id } })).toBe(1);
    // Both numbers are in the ledger: neither gets French free again.
    expect(await ledger(user.phone)).not.toBeNull();
    expect(await ledger(fresh)).not.toBeNull();
    // A language not started yet adds nothing.
    expect(await ledger(fresh, "de")).toBeNull();
    // The old number is free for someone else.
    const newcomer = await findOrCreateUser(user.phone);
    expect(newcomer.id).not.toBe(user.id);
    // Nothing in the teachers' change log: the learner did it.
    expect(await testDb.adminLog.count({ where: { entity: "user", entity_id: String(user.id) } })).toBe(0);
  });

  it("a number another account took in between is refused when saving", async () => {
    const user = await learner();
    const other = await learner();
    expect(await changePhone(user.id, other.phone, { keepDevice: null, adminId: null }, NOW)).toEqual({ ok: false, reason: "taken" });
    expect((await testDb.user.findUniqueOrThrow({ where: { id: user.id } })).phone).toBe(user.phone);
  });

  it("from «کاربران»: every device signs out and the change shows in the change log", async () => {
    const user = await startedLearner();
    await device(user.id, "lost");
    const fresh = nextPhone();
    expect(await changePhone(user.id, typed(fresh), { keepDevice: null, adminId: admin.id }, NOW)).toEqual({ ok: true, phone: fresh });
    expect(await testDb.authDevice.count({ where: { user_id: user.id } })).toBe(0);
    const row = await testDb.adminLog.findFirstOrThrow({ where: { entity: "user", entity_id: String(user.id) } });
    expect(row).toMatchObject({ admin_id: admin.id, action: "phone", before: { phone: user.phone }, after: { phone: fresh } });
    const log = await listLog("users", 1);
    expect(JSON.stringify(log)).toContain("تغییر شماره");
  });
});

describe("deleting the account (PRD §15.5)", () => {
  it("clears the number and every state, keeps answers and orders without the person, and gives no second free period", async () => {
    const user = await startedLearner();
    await device(user.id, "phone");
    await testDb.$transaction((tx) => saveItemState(tx, { userId: user.id, language: "fr" }, newItemState("word", 7, NOW)));
    await testDb.writingEntry.create({ data: { user_id: user.id, writing_task_id: 1, text: "Je suis là." } });
    await testDb.session.create({ data: { user_id: user.id, language: "fr", scope: "mixed", planned_length_min: 15, plan: {} } });
    const answer = randomUUID();
    await testDb.reviewLog.create({ data: { id: answer, user_id: user.id, language: "fr", kind: "review", item_type: "word", item_id: 7, result: "correct", ts: NOW } });
    await testDb.contentReport.create({ data: { user_id: user.id, review_log_id: answer, item_type: "word", item_id: 7, reason: "answer_wrong" } });
    const plan = await testDb.plan.create({ data: { language: "fr", name_fa: "ماهانه", duration_days: 30, price_toman: 200_000, module_codes: [] } });
    await testDb.order.create({ data: { user_id: user.id, plan_id: plan.id, language: "fr", amount_toman: 200_000, final_amount: 200_000, status: "paid", gateway: "mock", paid_at: NOW } });
    await testDb.subscription.create({ data: { user_id: user.id, language: "fr", starts_at: NOW, ends_at: new Date(NOW.getTime() + 30 * DAY), source: "payment" } });
    await testDb.event.create({ data: { user_id: user.id, name: "signup" } });

    // The confirmation says the active subscription goes too.
    expect(await deletionNotes(user.id, NOW)).toEqual({ teacher: false, activeLanguages: ["fr"] });
    expect(await deleteAccount(user.id, NOW)).toEqual({ ok: true });

    const row = await testDb.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(row).toMatchObject({ phone: null, deleted_at: NOW });
    for (const count of [
      testDb.authDevice.count({ where: { user_id: user.id } }),
      testDb.enrollment.count({ where: { user_id: user.id } }),
      testDb.itemState.count({ where: { user_id: user.id } }),
      testDb.writingEntry.count({ where: { user_id: user.id } }),
      testDb.session.count({ where: { user_id: user.id } }),
      testDb.subscription.count({ where: { user_id: user.id } }),
      testDb.event.count({ where: { user_id: user.id } }),
    ]) {
      expect(await count).toBe(0);
    }
    // Answers and the report stay without the person; the order stays as a money record.
    expect(await testDb.reviewLog.findUniqueOrThrow({ where: { id: answer } })).toMatchObject({ user_id: null, result: "correct" });
    expect(await testDb.contentReport.count({ where: { review_log_id: answer, user_id: null } })).toBe(1);
    expect(await testDb.order.count({ where: { user_id: user.id, status: "paid" } })).toBe(1);
    expect(await ledger(user.phone)).not.toBeNull();
    expect(await testDb.otpCode.count({ where: { phone: user.phone } })).toBe(0);

    // Signing up again with the same number: a new, empty account, and French has no free period.
    const again = await findOrCreateUser(user.phone);
    expect(again.id).not.toBe(user.id);
    await startFromZero({ id: again.id, is_admin: false, is_tester: false, phone: user.phone }, "fr", NOW);
    const enrollment = await testDb.enrollment.findFirstOrThrow({ where: { user_id: again.id, language: "fr" } });
    expect(enrollment.trial_ends_at).not.toBeNull();
    expect(enrollment.trial_ends_at!.getTime()).toBeLessThanOrEqual(NOW.getTime());

    // A deleted account cannot be deleted or renumbered again.
    expect(await deleteAccount(user.id, NOW)).toEqual({ ok: false, reason: "gone" });
    expect(await changePhone(user.id, nextPhone(), { keepDevice: null, adminId: admin.id }, NOW)).toEqual({ ok: false, reason: "gone" });
  });

  it("a learner who never finished a session is not in the ledger and gets the free period on a new account", async () => {
    const user = await learner();
    await startFromZero(user, "fr", NOW);
    expect(await deleteAccount(user.id, NOW)).toEqual({ ok: true });
    expect(await ledger(user.phone)).toBeNull();
  });

  it("a teacher's account is not deleted from the app", async () => {
    const teacher = await learner({ is_admin: true });
    expect(await deletionNotes(teacher.id, NOW)).toMatchObject({ teacher: true });
    expect(await deleteAccount(teacher.id, NOW)).toEqual({ ok: false, reason: "teacher" });
    expect((await testDb.user.findUniqueOrThrow({ where: { id: teacher.id } })).phone).toBe(teacher.phone);
  });
});

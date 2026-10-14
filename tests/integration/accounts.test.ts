import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accountDetail, accountLists, createAccount, phoneDigits, searchAccounts, setAccess } from "@/server/accounts";
import { listLog } from "@/server/content/library/history";
import { resetDb, testDb } from "./db";

beforeEach(resetDb);
afterAll(() => testDb.$disconnect());

const user = (phone: string | null, extra: Record<string, unknown> = {}) => testDb.user.create({ data: { phone, session_length_min: 15, ...extra } });

describe("finding accounts (PRD §13.2)", () => {
  it("reads what people type as digits of the number", () => {
    expect(phoneDigits("۰۹۱۲ ۳۴۵-۶۷۸۹")).toBe("9123456789");
    expect(phoneDigits("+98 912 345 6789")).toBe("9123456789");
    expect(phoneDigits("00989123456789")).toBe("9123456789");
    expect(phoneDigits("6789")).toBe("6789");
    expect(phoneDigits("۰۹")).toBeNull();
  });

  it("finds numbers by any part, never a deleted account, and offers a whole new number", async () => {
    await user("+989121110000");
    await user("+989351110000");
    await user(null, { deleted_at: new Date() });

    const found = await searchAccounts("۱۱۱۰۰۰۰");
    expect(found.state === "found" && found.rows.map((row) => row.phone)).toEqual(["+989351110000", "+989121110000"]);
    expect(found.state === "found" && found.newPhone).toBeNull();

    const fresh = await searchAccounts("0912 999 8877");
    expect(fresh).toMatchObject({ state: "found", rows: [], newPhone: "+989129998877" });
    expect(await searchAccounts("12")).toEqual({ state: "short" });
  });

  it("lists teachers, testers and the newest sign-ups apart", async () => {
    await user("+989120000001", { is_admin: true, admin_language: "fr" });
    await user("+989120000002", { is_tester: true });
    await user("+989120000003");
    const lists = await accountLists();
    expect(lists.admins.map((row) => row.phone)).toEqual(["+989120000001"]);
    expect(lists.testers.map((row) => row.phone)).toEqual(["+989120000002"]);
    expect(lists.recent.map((row) => row.phone)).toEqual(["+989120000003"]);
    expect(lists.total).toBe(3);
  });
});

describe("access", () => {
  it("turns tester and admin on and off, and logs each change", async () => {
    const admin = await user("+989120000001", { is_admin: true, admin_language: "fr" });
    const other = await user("+989120000002");

    expect(await setAccess(admin.id, other.id, { is_tester: true })).toEqual({ ok: true, changed: true });
    expect(await setAccess(admin.id, other.id, { is_admin: true })).toEqual({ ok: true, changed: true });
    expect(await testDb.user.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ is_tester: true, is_admin: true, admin_language: "all" });
    expect(await setAccess(admin.id, other.id, { admin_language: "de" })).toEqual({ ok: true, changed: true });
    expect(await setAccess(admin.id, other.id, { is_admin: false })).toEqual({ ok: true, changed: true });
    expect(await testDb.user.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ is_admin: false, admin_language: null });
    expect(await setAccess(admin.id, other.id, { is_tester: true })).toEqual({ ok: true, changed: false });

    const logs = await testDb.adminLog.findMany({ orderBy: { id: "asc" } });
    expect(logs.map((log) => [log.action, log.entity, log.entity_id, log.after])).toEqual([
      ["access", "user", String(other.id), { is_tester: true }],
      ["access", "user", String(other.id), { is_admin: true, admin_language: "all" }],
      ["access", "user", String(other.id), { admin_language: "de" }],
      ["access", "user", String(other.id), { is_admin: false, admin_language: null }],
    ]);
  });

  it("never lets an admin take away their own panel access, nor touch a deleted account", async () => {
    const admin = await user("+989120000001", { is_admin: true, admin_language: "fr" });
    const gone = await user(null, { deleted_at: new Date() });
    expect(await setAccess(admin.id, admin.id, { is_admin: false })).toEqual({ ok: false, reason: "self" });
    expect(await setAccess(admin.id, gone.id, { is_tester: true })).toEqual({ ok: false, reason: "gone" });
    expect(await setAccess(admin.id, admin.id, { admin_language: "xx" as "fr" })).toEqual({ ok: false, reason: "invalid" });
    expect(await setAccess(admin.id, admin.id, { is_tester: true })).toEqual({ ok: true, changed: true });
  });

  it("adds a phone as a teacher or a tester before its first sign-in", async () => {
    const admin = await user("+989120000001", { is_admin: true, admin_language: "fr" });
    const made = await createAccount(admin.id, { phone: "۰۹۱۲ ۵۵۵ ۴۴۳۳", role: "admin", language: "de" });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(await testDb.user.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ phone: "+989125554433", is_admin: true, admin_language: "de", is_tester: false });
    expect(await createAccount(admin.id, { phone: "09125554433", role: "tester" })).toEqual({ ok: false, reason: "exists", id: made.id });
    expect(await createAccount(admin.id, { phone: "1234", role: "tester" })).toEqual({ ok: false, reason: "phone" });

    const tester = await createAccount(admin.id, { phone: "09126667788", role: "tester" });
    expect(tester.ok && (await testDb.user.findUniqueOrThrow({ where: { id: tester.id } }))).toMatchObject({ is_tester: true, is_admin: false, admin_language: null });
    const log = await testDb.adminLog.findFirstOrThrow({ where: { action: "account" }, orderBy: { id: "asc" } });
    expect(log).toMatchObject({ entity: "user", before: null, after: { phone: "+989125554433", is_admin: true, admin_language: "de", is_tester: false } });
  });

  it("shows an account with its languages and devices", async () => {
    const account = await user("+989120000002", { is_tester: true });
    await testDb.enrollment.create({ data: { user_id: account.id, language: "fr" } });
    await testDb.skillLevel.create({ data: { user_id: account.id, language: "fr", skill: "vocab", level: "A1" } });
    await testDb.authDevice.create({ data: { user_id: account.id, refresh_token_hash: "x", user_agent: "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36" } });
    const detail = await accountDetail(account.id);
    expect(detail).toMatchObject({ phone: "+989120000002", isTester: true, deleted: false });
    expect(detail?.languages).toMatchObject([{ language: "fr", skills: [{ skill: "vocab", level: "A1" }], subscription: null }]);
    expect(detail?.devices).toHaveLength(1);
    expect(await accountDetail(9999)).toBeNull();
  });
});

describe("account rows in the change log", () => {
  it("names the account by its number and shows each flag before and after", async () => {
    const admin = await user("+989120000001", { is_admin: true, admin_language: "fr" });
    const other = await user("+989121234567");
    await setAccess(admin.id, other.id, { is_admin: true, admin_language: "fr" });
    await createAccount(admin.id, { phone: "09127654321", role: "tester" });

    const page = await listLog("users", 1);
    expect(page.total).toBe(2);
    const [created, access] = page.items;
    expect(created).toMatchObject({ actionLabel: "حساب تازه", kindLabel: "حساب", revert: "no" });
    expect(created.title?.text).toContain("۰۹۱۲ ۷۶۵ ۴۳۲۱");
    expect(created.lines.find((line) => line.key === "is_tester")?.note).toBe("بله");
    expect(access).toMatchObject({ actionLabel: "دسترسی", href: `/admin/users/${other.id}` });
    expect(access.lines.map((line) => [line.key, line.before?.text, line.after?.text])).toEqual([
      ["is_admin", "نه", "بله"],
      ["admin_language", undefined, "فرانسوی"],
    ]);
    expect((await listLog("words", 1)).total).toBe(0);
  });
});

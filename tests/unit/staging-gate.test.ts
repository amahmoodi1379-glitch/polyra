import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const basic = (password: string) => `Basic ${Buffer.from(`any:${password}`).toString("base64")}`;

describe("staging gate (SITE_PASSWORD)", () => {
  beforeEach(() => {
    process.env.SITE_PASSWORD = "open-sesame";
  });
  afterEach(() => {
    delete process.env.SITE_PASSWORD;
  });

  it("asks for the password without it", async () => {
    const response = await proxy(new NextRequest("http://localhost/admin"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
  });

  it("refuses a wrong password and a wrong cookie", async () => {
    expect((await proxy(new NextRequest("http://localhost/admin", { headers: { authorization: basic("nope") } }))).status).toBe(401);
    expect((await proxy(new NextRequest("http://localhost/admin", { headers: { cookie: "polyra_gate=forged" } }))).status).toBe(401);
  });

  it("remembers the right password in a year-long cookie that opens the site without the login box", async () => {
    const first = await proxy(new NextRequest("http://localhost/admin", { headers: { authorization: basic("open-sesame") } }));
    expect(first.status).toBe(200);
    const cookie = first.cookies.get("polyra_gate");
    expect(cookie?.value).toBeTruthy();
    expect(cookie?.value).not.toContain("open-sesame");
    expect(cookie?.maxAge).toBe(365 * 24 * 60 * 60);
    expect(cookie?.httpOnly).toBe(true);

    const later = await proxy(new NextRequest("http://localhost/learn/fr", { headers: { cookie: `polyra_gate=${cookie!.value}` } }));
    expect(later.status).toBe(200);
  });

  it("asks everyone again once the password changes", async () => {
    const first = await proxy(new NextRequest("http://localhost/admin", { headers: { authorization: basic("open-sesame") } }));
    const value = first.cookies.get("polyra_gate")!.value;
    process.env.SITE_PASSWORD = "new-password";
    expect((await proxy(new NextRequest("http://localhost/admin", { headers: { cookie: `polyra_gate=${value}` } }))).status).toBe(401);
  });

  it("lets everything through when no password is set", async () => {
    delete process.env.SITE_PASSWORD;
    expect((await proxy(new NextRequest("http://localhost/admin"))).status).toBe(200);
  });
});

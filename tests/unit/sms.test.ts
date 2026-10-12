import { describe, expect, it } from "vitest";
import { kavenegarSmsProvider, SmsSendError } from "@/server/sms/provider";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; body: string }[] = [];
  const fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

describe("Kavenegar SMS", () => {
  it("sends the code through the verify template", async () => {
    const { fetch, calls } = fakeFetch(200, { return: { status: 200, message: "تایید شد" }, entries: [] });
    await kavenegarSmsProvider({ apiKey: "KEY", template: "polyra-login", fetch }).sendLoginCode("+989121234567", "48213");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.kavenegar.com/v1/KEY/verify/lookup.json");
    expect(Object.fromEntries(new URLSearchParams(calls[0].body))).toEqual({
      receptor: "09121234567",
      token: "48213",
      template: "polyra-login",
    });
  });

  it("fails loudly when Kavenegar refuses", async () => {
    const { fetch } = fakeFetch(424, { return: { status: 424, message: "الگو یافت نشد" }, entries: null });
    const sending = kavenegarSmsProvider({ apiKey: "KEY", template: "wrong", fetch }).sendLoginCode("09121234567", "1");
    await expect(sending).rejects.toBeInstanceOf(SmsSendError);
    await expect(sending).rejects.toMatchObject({ status: 424 });
  });

  it("fails loudly when Kavenegar cannot be reached", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    const sending = kavenegarSmsProvider({ apiKey: "KEY", template: "t", fetch }).sendLoginCode("09121234567", "1");
    await expect(sending).rejects.toMatchObject({ name: "SmsSendError", status: null });
  });
});

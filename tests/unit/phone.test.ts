import { describe, expect, it } from "vitest";
import { formatMobileFa, normalizeMobile } from "@/lib/phone";

describe("mobile numbers", () => {
  it.each([
    ["09121234567", "+989121234567"],
    ["۰۹۱۲۱۲۳۴۵۶۷", "+989121234567"],
    ["+98 912 123 4567", "+989121234567"],
    ["00989121234567", "+989121234567"],
    ["989121234567", "+989121234567"],
    ["9121234567", "+989121234567"],
    ["0912-123-4567", "+989121234567"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeMobile(input)).toBe(expected);
  });

  it.each(["", "0212345678", "0912123456", "091212345678", "abc", "08121234567"])("rejects %s", (input) => {
    expect(normalizeMobile(input)).toBeNull();
  });

  it("formats for display in Persian digits", () => {
    expect(formatMobileFa("+989121234567")).toBe("۰۹۱۲ ۱۲۳ ۴۵۶۷");
  });
});

import { describe, expect, it } from "vitest";
import { isolateLatin } from "@/lib/bidi";

describe("Latin inside Persian text", () => {
  it("isolates each Latin run with its leading hyphen", () => {
    expect(isolateLatin("گذشته با avoir (فعل‌های -er)")).toBe("گذشته با \u2066avoir\u2069 (فعل‌های \u2066-er\u2069)");
    expect(isolateLatin("منفی با ne pas دور فعل")).toBe("منفی با \u2066ne pas\u2069 دور فعل");
    expect(isolateLatin("بدون کلمه لاتین")).toBe("بدون کلمه لاتین");
    expect(isolateLatin("۲ واحد A1؛ بعدی: «منفی با ne ... pas»")).toBe("۲ واحد \u2066A1\u2069؛ بعدی: «منفی با \u2066ne ... pas\u2069»");
  });
});

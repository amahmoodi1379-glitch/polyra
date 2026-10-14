import { describe, expect, it } from "vitest";
import { isolateLatin, splitLatin } from "@/lib/bidi";

describe("Latin inside Persian text", () => {
  it("isolates each Latin run with its leading hyphen", () => {
    expect(isolateLatin("گذشته با avoir (فعل‌های -er)")).toBe("گذشته با \u2066avoir\u2069 (فعل‌های \u2066-er\u2069)");
    expect(isolateLatin("منفی با ne pas دور فعل")).toBe("منفی با \u2066ne pas\u2069 دور فعل");
    expect(isolateLatin("بدون کلمه لاتین")).toBe("بدون کلمه لاتین");
    expect(isolateLatin("۲ واحد A1؛ بعدی: «منفی با ne ... pas»")).toBe("۲ واحد \u2066A1\u2069؛ بعدی: «منفی با \u2066ne ... pas\u2069»");
    expect(isolateLatin("فرق دارد: nous: avons faits ≠ avons fait، vous: avez fait.")).toBe(
      "فرق دارد: \u2066nous: avons faits ≠ avons fait\u2069، \u2066vous: avez fait\u2069.",
    );
    expect(isolateLatin("نیامده: il_elle_on، sie_Sie.")).toBe("نیامده: \u2066il_elle_on\u2069، \u2066sie_Sie\u2069.");
  });

  it("splits the same runs into pieces for their own typeface", () => {
    expect(splitLatin("منفی با ne pas دور فعل")).toEqual([
      { text: "منفی با ", latin: false },
      { text: "ne pas", latin: true },
      { text: " دور فعل", latin: false },
    ]);
    expect(splitLatin("-er")).toEqual([{ text: "-er", latin: true }]);
    expect(splitLatin("")).toEqual([]);
  });
});

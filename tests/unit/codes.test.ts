import { describe, expect, it } from "vitest";
import { freeCode, readCode, senseCode } from "@/server/content/codes";
import { posValues } from "@/schemas/common";

describe("word codes", () => {
  it("picks the first free code for a new word or a new sense", () => {
    const taken = new Set(["glace", "glace-noun"]);
    expect(freeCode("glace", "noun", taken)).toBe("glace-noun-2");
    expect(freeCode("aller", "verb", taken)).toBe("aller");
    expect(senseCode("glace", taken)).toBe("glace-2");
  });

  it("reads the lemma and word type back from a code a chatbot gave", () => {
    expect(readCode("fromage", posValues)).toEqual({ lemma: "fromage", pos: null });
    expect(readCode("aller-verb-2", posValues)).toEqual({ lemma: "aller", pos: "verb" });
    expect(readCode("peut-être", posValues)).toEqual({ lemma: "peut-être", pos: null });
    expect(readCode("glace-2", posValues)).toEqual({ lemma: "glace", pos: null });
    expect(readCode("est-ce que-phrase", posValues)).toEqual({ lemma: "est-ce que", pos: "phrase" });
  });
});

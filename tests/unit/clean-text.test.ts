import { describe, expect, it } from "vitest";
import { cleanDeep, cleanText } from "@/lib/clean-text";
import { cleanPaste } from "@/server/content/paste";

describe("cleanText: every saved text", () => {
  it("writes the Persian ی and ک in place of the Arabic letters", () => {
    expect(cleanText("كتاب يك مرد")).toBe("کتاب یک مرد");
    expect(cleanText("مصطفى")).toBe("مصطفی");
  });

  it("drops direction marks, soft hyphens and byte-order marks, and keeps the zero-width non-joiner", () => {
    expect(cleanText("‏می‌خواهم‎")).toBe("می‌خواهم");
    expect(cleanText("⁧le chat⁩ و ‫sea‬")).toBe("le chat و sea");
    expect(cleanText("Haus­tür﻿")).toBe("Haustür");
  });

  it("writes plain spaces for non-breaking and wide ones, and keeps line breaks", () => {
    expect(cleanText("Ça va ? « oui »")).toBe("Ça va ? « oui »");
    expect(cleanText("un\ndeux")).toBe("un\ndeux");
  });

  it("joins a letter and its separate accent into one character (NFC)", () => {
    expect(cleanText("été")).toBe("été");
  });

  it("cleans every string of a nested value and leaves numbers, booleans and null alone", () => {
    expect(cleanDeep({ a: ["يك", { b: "é" }], n: 3, ok: true, none: null })).toEqual({ a: ["یک", { b: "é" }], n: 3, ok: true, none: null });
  });

  it("is applied to a pasted chatbot answer, also outside the JSON strings", () => {
    const pasted = cleanPaste('{ "words": [{"meaning_fa": "كتاب‏"}]}', "words");
    expect(pasted.state === "ok" && pasted.value).toEqual({ words: [{ meaning_fa: "کتاب" }] });
  });
});

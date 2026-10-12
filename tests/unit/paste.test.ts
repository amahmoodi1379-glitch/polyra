import { describe, expect, it } from "vitest";
import { cleanPaste, joinPaste } from "@/server/content/paste";

const answer = { words: [{ code: "voiture", lemma: "voiture" }, { code: "maison", lemma: "maison" }], issues: [] };
const json = JSON.stringify(answer, null, 2);

describe("cleanPaste (PRD §13.9 step 2)", () => {
  it("removes greetings, fences and notes around the answer", () => {
    const pasted = `Sure! Here is the JSON:\n\n\`\`\`json\n${json}\n\`\`\`\n\nLet me know if you need more.`;
    expect(cleanPaste(pasted)).toMatchObject({ state: "ok", value: answer });
  });

  it("tolerates trailing commas and a byte-order mark", () => {
    expect(cleanPaste('﻿{"words": [{"code": "a",},], "issues": [],}')).toMatchObject({
      state: "ok",
      value: { words: [{ code: "a" }], issues: [] },
    });
  });

  it("skips a brace in the chatbot's own words before the answer", () => {
    expect(cleanPaste(`I used {{ }} for blanks. ${json}`)).toMatchObject({ state: "ok", value: answer });
  });

  it("says when the answer is cut off and when there is nothing", () => {
    expect(cleanPaste(json.slice(0, 60)).state).toBe("cut");
    expect(cleanPaste("Sorry, I cannot help with that.").state).toBe("empty");
  });

  it("finds the answer behind a stray brace when the main key is known", () => {
    const pasted = `Blanks start with { in the text.\n${json}`;
    expect(cleanPaste(pasted, "words")).toMatchObject({ state: "ok", value: answer });
    expect(cleanPaste(pasted).state).toBe("cut");
  });

  it("never takes a record inside a cut answer for the answer", () => {
    const cut = json.slice(0, json.indexOf("maison") + 3);
    expect(cleanPaste(cut).state).toBe("cut");
    expect(cleanPaste(cut, "words").state).toBe("cut");
  });

  it("does not count braces inside text values", () => {
    expect(cleanPaste('{"marked_text": "Je veux {{manger}}.", "x": "}"}')).toMatchObject({ state: "ok" });
  });
});

describe("joinPaste", () => {
  const cutAt = json.indexOf("maison") + 3;
  const first = json.slice(0, cutAt);

  it("continues exactly where the answer stopped", () => {
    expect(joinPaste(first, json.slice(cutAt))).toMatchObject({ state: "ok", value: answer });
  });

  it("handles a continuation that repeats the last characters, inside a fence", () => {
    expect(joinPaste(first, "```json\n" + json.slice(cutAt - 20) + "\n```")).toMatchObject({ state: "ok", value: answer });
  });

  it("handles a continuation that closes the code block and adds a note after it", () => {
    const pasted = cleanPaste("Here you go:\n```json\n" + first, "words");
    expect(pasted.state).toBe("cut");
    if (pasted.state !== "cut") return;
    const rest = json.slice(cutAt) + "\n```\n\nTell me if you need more.";
    expect(joinPaste(pasted.text, rest, "words")).toMatchObject({ state: "ok", value: answer });
  });

  it("handles a continuation that restarts the unfinished record", () => {
    const recordStart = json.lastIndexOf("{", cutAt);
    expect(joinPaste(first, json.slice(recordStart))).toMatchObject({ state: "ok", value: answer });
  });

  it("handles a continuation that is the whole answer again", () => {
    expect(joinPaste(first, json)).toMatchObject({ state: "ok", value: answer });
  });

  it("stays cut when the continuation is cut too", () => {
    const second = json.slice(cutAt, cutAt + 10);
    const joined = joinPaste(first, second);
    expect(joined.state).toBe("cut");
    if (joined.state !== "cut") return;
    expect(joinPaste(joined.text, json.slice(cutAt + 10))).toMatchObject({ state: "ok", value: answer });
  });
});

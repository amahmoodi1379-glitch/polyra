import { describe, expect, it } from "vitest";
import { buildWordEx } from "@/engine/build";
import type { ItemHistory } from "@/engine/state";
import { buildRound, pickWordEx, stepOrder } from "@/engine/pick";
import { content, env, frenchSet, sentence, settings, target, unit, word } from "./kit";

const codesOver = (run: (seed: string) => string | undefined, times = 60) => new Set(Array.from({ length: times }, (_, i) => run(`s${i}`)));

describe("exercise choice (PRD §9.3)", () => {
  const set = frenchSet();
  const data = content(set);
  const voiture = data.words.get(1)!;

  it("follows the step order: lower steps first, then higher; a followup only goes up", () => {
    expect(stepOrder(4, 6, "review")).toEqual([4, 3, 2, 1, 5, 6]);
    expect(stepOrder(1, 6, "practice")).toEqual([1, 2, 3, 4, 5, 6]);
    expect(stepOrder(5, 6, "followup")).toEqual([5, 6]);
  });

  it("T17: step 3 review without four companions for W3d picks W3b or W3c, never W3a, the less seen one", () => {
    const few = { introduced: [1, 2, 3] };
    const codes = codesOver((seed) => pickWordEx(env(data, { ...few, seed }), voiture, 3, "review", { audio: true })?.code);
    expect(codes).toEqual(new Set(["W3b", "W3c"]));
    const history: Record<string, ItemHistory> = { "w:1": { codeCounts: { W3b: 2, W3c: 1 }, lastCode: "W3b", recentSentences: [] } };
    const lessSeen = codesOver((seed) => pickWordEx(env(data, { ...few, seed, history }), voiture, 3, "review", { audio: true })?.code);
    expect(lessSeen).toEqual(new Set(["W3c"]));
  });

  it("T18: no image means no W2b or W2c; homophones mean no W1b or W5b", () => {
    const ecole = data.words.get(3)!;
    const pain = data.words.get(7)!;
    const e = env(data);
    expect(buildWordEx(e, ecole, "W2b")).toBeNull();
    expect(buildWordEx(e, ecole, "W2c")).toBeNull();
    expect(buildWordEx(e, voiture, "W2c")).not.toBeNull();
    expect(buildWordEx(e, pain, "W1b")).toBeNull();
    expect(buildWordEx(e, pain, "W5b")).toBeNull();
    const step2 = codesOver((seed) => pickWordEx(env(data, { seed }), ecole, 2, "practice", { audio: true })?.code);
    expect([...step2].some((code) => code === "W2b" || code === "W2c")).toBe(false);
  });

  it("T19: a code switched off in the panel is never chosen", () => {
    const off = settings({ "exercise.W3d.enabled": false });
    const codes = codesOver((seed) => pickWordEx(env(data, { seed, settings: off }), voiture, 3, "review", { audio: true })?.code, 80);
    expect(codes.has("W3d")).toBe(false);
    expect(codes.size).toBeGreaterThan(0);
  });

  it("T53: a review at step 4 uses a meaning exercise of step 3", () => {
    const codes = codesOver((seed) => pickWordEx(env(data, { seed }), voiture, 4, "review", { audio: true })?.code);
    for (const code of codes) expect(["W3b", "W3c", "W3d"]).toContain(code);
  });

  it("T08 (choice): a followup on the last step is a form exercise of that step (W6b)", () => {
    const codes = codesOver((seed) => pickWordEx(env(data, { seed }), voiture, 6, "followup", { formOnly: true, audio: true })?.code);
    expect(codes).toEqual(new Set(["W6b"]));
    // Without sound there is no form exercise left on step 6, so no followup.
    expect(pickWordEx(env(data), voiture, 6, "followup", { formOnly: true, audio: false })).toBeNull();
  });

  it("drops the last code unless it is the only one", () => {
    const history: Record<string, ItemHistory> = { "w:1": { codeCounts: {}, lastCode: "W1a", recentSentences: [] } };
    const codes = codesOver((seed) => pickWordEx(env(data, { seed, history }), voiture, 1, "review", { audio: true })?.code);
    expect(codes).toEqual(new Set(["W1b"]));
    const silent = codesOver((seed) => pickWordEx(env(data, { seed, history }), voiture, 1, "review", { audio: false })?.code);
    expect(silent).toEqual(new Set(["W1a"]));
  });

  it("T85 (choice): a recognize word never gets a typing exercise; its followup on step 3 is W3a", () => {
    const rec = word(30, "néanmoins", "با این حال", { pos: "adv", mastery: "recognize" });
    const data2 = content({ ...set, words: [...set.words, rec] });
    for (const step of [1, 2, 3, 4, 5, 6]) {
      const codes = codesOver((seed) => pickWordEx(env(data2, { seed }), rec, step, "practice", { audio: true })?.code, 30);
      for (const code of codes) expect(["W4a", "W4b", "W4c", "W5a", "W5b", "W6a", "W6b"]).not.toContain(code);
    }
    const follow = codesOver((seed) => pickWordEx(env(data2, { seed }), rec, 3, "followup", { formOnly: true, audio: true })?.code);
    expect(follow).toEqual(new Set(["W3a"]));
  });
});

describe("wrong options (PRD §5.5)", () => {
  it("T86: a new sense with the same lemma is never a wrong option", () => {
    const set = frenchSet();
    const glace = word(40, "glace", "بستنی", { gender: "f" });
    const glace2 = word(41, "glace", "آینه", { gender: "f", code: "glace-2", senseOf: "glace" });
    const data = content({ ...set, words: [...set.words, glace, glace2] });
    for (let i = 0; i < 40; i++) {
      const ex = buildWordEx(env(data, { seed: `g${i}` }), glace, "W2a")!;
      if (ex.a.kind !== "choice") throw new Error("W2a is a choice");
      expect(ex.a.options.map((option) => option.wordId)).not.toContain(41);
      expect(ex.a.options.map((option) => option.text).filter((text) => text === "glace")).toHaveLength(1);
    }
  });

  it("the other word of a confusion pair is always one of the wrong options", () => {
    const data = content(frenchSet());
    for (let i = 0; i < 20; i++) {
      const ex = buildWordEx(env(data, { seed: `c${i}`, partner: { 20: 21 } }), data.words.get(20)!, "W1a")!;
      if (ex.a.kind !== "choice") throw new Error("W1a is a choice");
      expect(ex.a.options.map((option) => option.wordId)).toContain(21);
    }
  });
});

describe("translation choice (W3c)", () => {
  it("T88: a grammar sentence without a word target can be chosen; a text sentence never", () => {
    const set = frenchSet();
    const extra = [
      sentence(20, "Le chat a une voiture rouge.", "گربه یک ماشین قرمز دارد.", set.words),
      sentence(21, "Il a un chat.", "او یک گربه دارد.", set.words, { bank: false }),
    ];
    const data = content({ ...set, sentences: [...set.sentences, ...extra] });
    const chat = data.words.get(5)!;
    const used = new Set<number>();
    for (let i = 0; i < 60; i++) {
      const ex = buildWordEx(env(data, { seed: `t${i}` }), chat, "W3c");
      if (ex?.sentenceId) used.add(ex.sentenceId);
    }
    expect(used.has(20)).toBe(true);
    expect(used.has(21)).toBe(false);
  });
});

describe("grammar round (PRD §6.5)", () => {
  const set = frenchSet();
  const grammarSentences = Array.from({ length: 8 }, (_, i) => sentence(100 + i, `Le chat est ${i % 2 ? "grand" : "petit"}.`, "گربه ... است.", set.words));
  const targets = grammarSentences.map((item, i) => target(200 + i, item.id, "grammar", 1, item.text.replace(/est/, "{{est}}"), ["est"], ["a", "sont", "es"], { hint: "(être)" }));
  const data = content({ ...set, sentences: [...set.sentences, ...grammarSentences], targets: [...set.targets, ...targets], units: [unit(1)] });

  it("asks five questions of one step, rotating codes", () => {
    const round = buildRound(env(data), data.units[0], 1, { audio: true })!;
    expect(round.step).toBe(1);
    expect(round.questions).toHaveLength(5);
    expect(new Set(round.questions.map((ex) => ex.code))).toEqual(new Set(["G1a", "G1b"]));
    expect(new Set(round.questions.map((ex) => ex.sentenceId)).size).toBe(5);
  });

  it("a unit without transform or translate items stops at step 5", () => {
    const round = buildRound(env(data), data.units[0], 6, { audio: true })!;
    expect(round.step).toBe(5);
    expect(round.questions.every((ex) => ex.typed)).toBe(true);
  });

  it("G3c without a readable sentence becomes G1a for the same sentence", () => {
    const round = buildRound(env(data, { known: [] }), data.units[0], 3, { audio: true })!;
    expect(round.step).toBe(3);
    expect(round.questions.some((ex) => ex.code === "G3c")).toBe(false);
    expect(round.questions.some((ex) => ex.code === "G1a")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { guidePages } from "@/app/admin/guide/links";
import fa from "@/i18n/fa.json";
import { pagesIn, parseBlocks, parseInline, type Inline } from "@/lib/guide-markup";

describe("guide markup", () => {
  it("reads buttons, page links, words, codes and bold", () => {
    expect(parseInline("بزن [[کپی پرامپت]] در {{order}} برای _maison_ یا `E7K2QXM` و **دیگر**.")).toEqual([
      { kind: "text", text: "بزن " },
      { kind: "button", text: "کپی پرامپت" },
      { kind: "text", text: " در " },
      { kind: "page", page: "order" },
      { kind: "text", text: " برای " },
      { kind: "word", text: "maison" },
      { kind: "text", text: " یا " },
      { kind: "code", text: "E7K2QXM" },
      { kind: "text", text: " و " },
      { kind: "bold", children: [{ kind: "text", text: "دیگر" }] },
      { kind: "text", text: "." },
    ]);
  });

  it("keeps an apostrophe inside a word", () => {
    expect(parseInline("مثل _s'il vous plaît_.")).toEqual([
      { kind: "text", text: "مثل " },
      { kind: "word", text: "s'il vous plaît" },
      { kind: "text", text: "." },
    ]);
  });

  it("splits paragraphs, lists and numbered lists", () => {
    const blocks = parseBlocks("یک\nدو\n\n- الف\n- ب\n\n1. اول\n2. دوم");
    expect(blocks.map((block) => block.kind)).toEqual(["p", "ul", "ol"]);
    expect(blocks[0]).toEqual({ kind: "p", inline: [{ kind: "text", text: "یک دو" }] });
    expect(blocks[1]).toMatchObject({ items: [[{ text: "الف" }], [{ text: "ب" }]] });
    expect(blocks[2]).toMatchObject({ items: [[{ text: "اول" }], [{ text: "دوم" }]] });
  });
});

/** Every text of the guide in fa.json. */
function texts(node: unknown, path = "admin.guide"): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => texts(value, `${path}.${key}`));
}

function plain(items: Inline[]): string {
  return items.map((item) => (item.kind === "bold" ? plain(item.children) : item.kind === "page" ? "" : item.text)).join("");
}

describe("guide texts", () => {
  const all = texts(fa.admin.guide);

  it("link only to pages the guide knows", () => {
    for (const [path, text] of all) {
      for (const page of pagesIn(text)) expect(Object.keys(guidePages), `${path}: {{${page}}}`).toContain(page);
    }
  });

  it("leave no markup unread", () => {
    for (const [path, text] of all) {
      for (const block of parseBlocks(text)) {
        const items = block.kind === "p" ? [block.inline] : block.items;
        for (const item of items) expect(plain(item), path).not.toMatch(/\*\*|\[\[|\]\]|\{\{|\}\}|`|(^|\s)_|_(\s|$)/);
      }
    }
  });

  it("name buttons the panel really has", () => {
    // A label with {placeholders} matches any value; one in brackets, such as «برگرد به پیش‌فرض ({value})», may be left out.
    const escape = (text: string) => text.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
    const patterns = texts(fa).flatMap(([, text]) => [text, text.replace(/\s*\(\{\w+\}\)/g, "")].map((template) => new RegExp(`^${escape(template).replace(/\{\w+\}/g, ".+")}$`)));
    for (const [path, text] of all) {
      for (const [, label] of text.matchAll(/\[\[(.+?)\]\]/g)) {
        expect(
          patterns.some((pattern) => pattern.test(label)),
          `${path}: [[${label}]]`,
        ).toBe(true);
      }
    }
  });
});

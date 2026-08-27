import { describe, expect, it } from "vitest";
import {
  declarationsIn,
  elementMatches,
  markupElements,
  outlineOf,
  searchPatternFor,
  selectorTargets,
  styleOutline,
} from "@adcode/structure";
import type { OutlineNode } from "@adcode/structure";

const names = (nodes: readonly OutlineNode[]): string[] => nodes.map((node) => node.name);

const SHEET = [
  ":root {",
  "  --accent: #007aff;",
  "}",
  "",
  "/* .commented { color: red } */",
  ".card {",
  "  display: flex;",
  "  gap: 12px;",
  "}",
  "",
  "@media (min-width: 600px) {",
  "  .card {",
  "    gap: 24px;",
  "  }",
  "}",
].join("\n");

describe("styleOutline", () => {
  it("lists rules and at-rules, nested by brace", () => {
    const outline = styleOutline(SHEET);

    expect(names(outline)).toEqual([":root", ".card", "@media (min-width: 600px)"]);
    expect(names(outline[2]?.children ?? [])).toEqual([".card"]);
  });

  it("gives a rule the span of its body", () => {
    const card = styleOutline(SHEET)[1];

    expect(card?.line).toBe(6);
    expect(card?.endLine).toBe(9);
  });

  it("lists a custom property, which other files refer to by name", () => {
    const accent = styleOutline(SHEET)[0]?.children[0];

    expect(accent?.name).toBe("--accent");
    expect(accent?.detail).toBe("#007aff");
  });

  it("ignores a commented-out rule", () => {
    expect(names(styleOutline(SHEET))).not.toContain(".commented");
  });

  it("does not let a preceding declaration leak into a nested rule's name", () => {
    const outline = styleOutline(".a {\n  color: red;\n  .b { top: 0; }\n}");

    expect(names(outline)).toEqual([".a"]);
    expect(names(outline[0]?.children ?? [])).toEqual([".b"]);
  });

  it("keeps a selector written across two lines as one row", () => {
    const outline = styleOutline(".a,\n.b {\n  color: red;\n}");

    expect(names(outline)).toEqual([".a, .b"]);
    expect(outline[0]?.line).toBe(1);
  });

  it("is what `outlineOf` uses for css, scss and less", () => {
    for (const language of ["css", "scss", "less"]) {
      expect(names(outlineOf(language, ".a { color: red }"))).toEqual([".a"]);
    }
  });
});

describe("declarationsIn", () => {
  it("reads back what a rule sets", () => {
    expect(declarationsIn(SHEET, 6, 9)).toEqual(["display: flex", "gap: 12px"]);
  });

  it("stops at a nested rule rather than claiming its declarations", () => {
    const sheet = ".a {\n  color: red;\n  .b { top: 0; }\n}";

    expect(declarationsIn(sheet, 1, 4)).toEqual(["color: red"]);
  });
});

describe("selectorTargets", () => {
  it("takes the rightmost compound, which is what the rule is about", () => {
    expect(selectorTargets(".page .card .title")).toEqual([{ kind: "class", name: "title" }]);
  });

  it("keeps every selector in a list", () => {
    expect(selectorTargets(".a, #b")).toEqual([
      { kind: "class", name: "a" },
      { kind: "id", name: "b" },
    ]);
  });

  it("strips pseudo-classes and their arguments", () => {
    expect(selectorTargets(".row:not(.header):hover")).toEqual([{ kind: "class", name: "row" }]);
  });

  it("strips attribute selectors", () => {
    expect(selectorTargets('input[type="text"]')).toEqual([{ kind: "tag", name: "input" }]);
  });

  it("does not search for a bare tag that only qualifies a class", () => {
    expect(selectorTargets("div.card")).toEqual([{ kind: "class", name: "card" }]);
  });

  it("returns nothing searchable for a selector that names nothing", () => {
    expect(selectorTargets("* > :first-child")).toEqual([]);
  });
});

describe("elementMatches", () => {
  const [card, plain] = markupElements('<div class="card hero" id="top"></div><div></div>');

  it("matches a class on the element", () => {
    expect(elementMatches(card!, ".card")).toBe(true);
    expect(elementMatches(plain!, ".card")).toBe(false);
  });

  it("requires every part of a compound", () => {
    expect(elementMatches(card!, "div.card.hero")).toBe(true);
    expect(elementMatches(card!, "div.card.missing")).toBe(false);
  });

  it("matches an id and a tag", () => {
    expect(elementMatches(card!, "#top")).toBe(true);
    expect(elementMatches(card!, "div")).toBe(true);
    expect(elementMatches(card!, "span")).toBe(false);
  });

  it("judges only the rightmost compound of a descendant selector", () => {
    // The ancestor cannot be checked from one element, and the panel says so rather than
    // silently dropping hits that are probably right.
    expect(elementMatches(card!, ".page .card")).toBe(true);
  });
});

describe("searchPatternFor", () => {
  it("bounds a class name so `card` does not match `cardboard`", () => {
    const pattern = new RegExp(searchPatternFor({ kind: "class", name: "card" }));

    expect(pattern.test('<div class="card">')).toBe(true);
    expect(pattern.test('<div class="cardboard">')).toBe(false);
  });

  it("looks for an id where an id is written", () => {
    const pattern = new RegExp(searchPatternFor({ kind: "id", name: "top" }));

    expect(pattern.test('<div id="top">')).toBe(true);
    expect(pattern.test('<div class="top">')).toBe(false);
  });

  it("escapes a name that contains regex syntax", () => {
    expect(() => new RegExp(searchPatternFor({ kind: "class", name: "a.b" }))).not.toThrow();
  });
});

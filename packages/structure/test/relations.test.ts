import { describe, expect, it } from "vitest";
import {
  callsWithin,
  canClassify,
  classifyReference,
  referenceGlobFor,
  referencePattern,
  sortRelations,
} from "@adcode/structure";
import type { RelationHit } from "@adcode/structure";

const SOURCE = [
  "function render(model) {",
  "  const text = format(model);",
  "  logger.write(text);",
  "  if (ready) {",
  "    render(model);",
  "  }",
  '  return escape("a(b)");',
  "}",
].join("\n");

describe("callsWithin", () => {
  it("lists what a body calls, in the order it calls them", () => {
    const calls = callsWithin(SOURCE, 1, 8, "render");

    expect(calls.map((call) => call.name)).toEqual(["format", "write", "escape"]);
  });

  it("leaves out control flow that merely looks like a call", () => {
    expect(callsWithin(SOURCE, 1, 8, "render").map((call) => call.name)).not.toContain("if");
  });

  it("leaves out the symbol's own recursive calls", () => {
    expect(callsWithin(SOURCE, 1, 8, "render").map((call) => call.name)).not.toContain("render");
  });

  it("does not read a call out of a string literal", () => {
    // `escape("a(b)")` must contribute `escape` and not `b`.
    expect(callsWithin(SOURCE, 1, 8, "render").map((call) => call.name)).not.toContain("b");
  });

  it("reports the line each call is on", () => {
    const [first] = callsWithin(SOURCE, 1, 8, "render");

    expect(first?.line).toBe(2);
  });

  it("respects the body's bounds", () => {
    expect(callsWithin(SOURCE, 3, 3, "render").map((call) => call.name)).toEqual(["write"]);
  });
});

describe("classifyReference", () => {
  it("calls the defining line a definition", () => {
    expect(classifyReference("render", "typescript", "export function render(model) {", 17)).toBe(
      "definition",
    );
  });

  it("calls an import an import", () => {
    expect(classifyReference("render", "typescript", "import { render } from './view';", 10)).toBe(
      "import",
    );
    expect(classifyReference("vector", "cpp", "#include <vector>", 11)).toBe("import");
  });

  it("calls a name followed by a parenthesis a call", () => {
    expect(classifyReference("render", "typescript", "  render(model);", 3)).toBe("call");
  });

  it("calls everything else a reference", () => {
    expect(classifyReference("render", "typescript", "  const fn = render;", 14)).toBe("reference");
  });

  it("reads the hit at its own column, not the first one on the line", () => {
    // `render` appears twice; the hit at column 10 is the argument, which is not a call.
    expect(classifyReference("render", "typescript", "  wrap(render, other);", 8)).toBe("reference");
  });
});

describe("referencePattern", () => {
  it("bounds the name so a longer one does not match", () => {
    const pattern = new RegExp(referencePattern("render"));

    expect(pattern.test("render(x)")).toBe(true);
    expect(pattern.test("rerender(x)")).toBe(false);
  });

  it("escapes regex syntax in the name", () => {
    expect(() => new RegExp(referencePattern("a.b"))).not.toThrow();
  });
});

describe("referenceGlobFor", () => {
  it("looks in the files a symbol could reach", () => {
    expect(referenceGlobFor("typescript")).toContain("tsx");
    expect(referenceGlobFor("css")).toContain("html");
  });

  it("returns an empty glob - meaning everywhere - for a language it has no list for", () => {
    expect(referenceGlobFor("plaintext")).toBe("");
  });
});

describe("canClassify", () => {
  it("is true where there are rules to judge a line against", () => {
    expect(canClassify("typescript")).toBe(true);
    expect(canClassify("html")).toBe(false);
    expect(canClassify("plaintext")).toBe(false);
  });
});

describe("sortRelations", () => {
  it("puts the definition first, then calls, then the rest", () => {
    const hits: RelationHit[] = [
      { kind: "import", path: "b.ts", line: 1, column: 1, text: "" },
      { kind: "reference", path: "a.ts", line: 9, column: 1, text: "" },
      { kind: "call", path: "a.ts", line: 4, column: 1, text: "" },
      { kind: "definition", path: "a.ts", line: 1, column: 1, text: "" },
    ];

    expect(sortRelations(hits).map((hit) => hit.kind)).toEqual([
      "definition",
      "call",
      "reference",
      "import",
    ]);
  });
});

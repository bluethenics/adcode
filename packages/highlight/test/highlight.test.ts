import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  encodeTokens,
  grammarFileFor,
  isOpaque,
  tokenFor,
  tokenIndex,
  TOKEN_TYPES,
  type Token,
  type TokenType,
} from "@adcode/highlight";

const node = (type: string, named = true, parentType?: string) => ({ type, named, parentType });

describe("tokenFor", () => {
  it("colours a comment in any language", () => {
    expect(tokenFor("rust", node("line_comment"))).toBe("comment");
    expect(tokenFor("python", node("comment"))).toBe("comment");
    expect(tokenFor("go", node("comment"))).toBe("comment");
  });

  it("colours the many spellings of a string", () => {
    expect(tokenFor("go", node("interpreted_string_literal"))).toBe("string");
    expect(tokenFor("rust", node("raw_string_literal"))).toBe("string");
    expect(tokenFor("javascript", node("template_string"))).toBe("string");
  });

  /*
   * The rule that makes this table work at all: tree-sitter has no keyword node type.
   * Keywords arrive as anonymous nodes whose type is the literal text.
   */
  it("treats an anonymous word node as a keyword", () => {
    expect(tokenFor("typescript", node("const", false))).toBe("keyword");
    expect(tokenFor("python", node("def", false))).toBe("keyword");
    expect(tokenFor("rust", node("impl", false))).toBe("keyword");
  });

  it("does not treat punctuation as a keyword", () => {
    expect(tokenFor("typescript", node("{", false))).toBeNull();
    expect(tokenFor("typescript", node("=>", false))).toBeNull();
    expect(tokenFor("typescript", node(";", false))).toBeNull();
  });

  it("uses the parent to tell a function name from a variable", () => {
    expect(tokenFor("go", node("identifier", true, "function_declaration"))).toBe("function");
    expect(tokenFor("go", node("identifier", true, "call_expression"))).toBe("function");
    expect(tokenFor("java", node("identifier", true, "class_declaration"))).toBe("class");
  });

  it("leaves an ordinary node alone", () => {
    // Most nodes are structure. Emitting a token for every one floods the editor and
    // overrides colouring Monaco already does well.
    expect(tokenFor("typescript", node("statement_block"))).toBeNull();
    expect(tokenFor("typescript", node("program"))).toBeNull();
  });

  it("lets a language override the shared table", () => {
    expect(tokenFor("css", node("tag_name"))).toBe("type");
    expect(tokenFor("html", node("attribute_name"))).toBe("property");
    expect(tokenFor("rust", node("macro_invocation"))).toBe("macro");
  });

  it("colours a python literal keyword", () => {
    expect(tokenFor("python", node("none"))).toBe("keyword");
  });

  it("never returns a type outside the legend", () => {
    fc.assert(
      fc.property(fc.string(), fc.boolean(), fc.string(), (type, named, parent) => {
        const result = tokenFor("typescript", node(type, named, parent));
        if (result !== null) expect(TOKEN_TYPES).toContain(result);
      }),
      { numRuns: 400 },
    );
  });
});

describe("isOpaque", () => {
  it("stops the walk inside strings and comments", () => {
    // Descending into these produces overlapping tokens, which render as a visible seam.
    expect(isOpaque("comment")).toBe(true);
    expect(isOpaque("string")).toBe(true);
    expect(isOpaque("statement_block")).toBe(false);
  });
});

describe("encodeTokens", () => {
  const decode = (data: Uint32Array): number[][] => {
    const rows: number[][] = [];
    for (let at = 0; at < data.length; at += 5) rows.push([...data.slice(at, at + 5)]);
    return rows;
  };

  const t = (line: number, column: number, length: number, type: TokenType): Token => ({
    line,
    column,
    length,
    type,
  });

  it("encodes the first token absolutely", () => {
    const data = encodeTokens([t(2, 4, 5, "keyword")]);
    expect(decode(data)).toEqual([[2, 4, 5, tokenIndex("keyword"), 0]]);
  });

  it("makes each token relative to the one before", () => {
    const data = encodeTokens([t(0, 0, 3, "keyword"), t(0, 5, 4, "string")]);
    expect(decode(data)).toEqual([
      [0, 0, 3, tokenIndex("keyword"), 0],
      [0, 5, 4, tokenIndex("string"), 0],
    ]);
  });

  /* The rule everybody gets wrong: the column delta restarts on a new line. */
  it("restarts the column on a new line", () => {
    const data = encodeTokens([t(0, 10, 3, "keyword"), t(1, 2, 4, "string")]);
    expect(decode(data)[1]).toEqual([1, 2, 4, tokenIndex("string"), 0]);
  });

  it("sorts tokens that arrive out of order", () => {
    // A tree walk is in tree order, which is not document order for every grammar - and an
    // out-of-order token encodes a negative delta and misplaces the rest of the file.
    const data = encodeTokens([t(5, 0, 2, "string"), t(1, 0, 3, "keyword")]);
    expect(decode(data)[0]).toEqual([1, 0, 3, tokenIndex("keyword"), 0]);
    expect(decode(data)[1]).toEqual([4, 0, 2, tokenIndex("string"), 0]);
  });

  it("drops zero-length tokens", () => {
    expect(encodeTokens([t(0, 0, 0, "keyword")])).toHaveLength(0);
  });

  it("returns nothing for nothing", () => {
    expect(encodeTokens([])).toHaveLength(0);
  });

  it("never encodes a negative delta", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            line: fc.nat({ max: 200 }),
            column: fc.nat({ max: 200 }),
            length: fc.integer({ min: 1, max: 20 }),
            type: fc.constantFrom(...TOKEN_TYPES),
          }),
          { maxLength: 60 },
        ),
        (tokens) => {
          const data = encodeTokens(tokens as Token[]);
          for (let at = 0; at < data.length; at += 5) {
            expect(data[at]).toBeGreaterThanOrEqual(0);
            expect(data[at + 1]).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe("grammarFileFor", () => {
  it("finds a grammar for a language it ships", () => {
    expect(grammarFileFor("rust")).toBe("tree-sitter-rust.wasm");
  });

  /*
   * Monaco and tree-sitter disagree about JSX. Monaco calls a `.tsx` file `typescript`;
   * tree-sitter has a separate `tsx` grammar, and parsing JSX with the plain TypeScript
   * grammar produces a tree full of errors for a perfectly valid file.
   */
  it("maps the React dialects onto the tsx grammar", () => {
    expect(grammarFileFor("typescriptreact")).toBe("tree-sitter-tsx.wasm");
    expect(grammarFileFor("javascriptreact")).toBe("tree-sitter-tsx.wasm");
  });

  it("borrows a close-enough grammar where one fits", () => {
    expect(grammarFileFor("scss")).toBe("tree-sitter-css.wasm");
    expect(grammarFileFor("jsonc")).toBe("tree-sitter-json.wasm");
  });

  it("returns null for a language with no grammar", () => {
    expect(grammarFileFor("cobol")).toBeNull();
  });
});

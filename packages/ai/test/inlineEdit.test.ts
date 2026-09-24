import { describe, expect, it } from "vitest";
import {
  INLINE_EDIT_CONTEXT_CHARS,
  buildInlineEditRequest,
  cleanInlineEditAnswer,
} from "../src/inlineEdit.ts";

const input = {
  instruction: "  add input validation  ",
  languageId: "typescript",
  path: "src/app.ts",
  before: "const x = 1;\n",
  selection: "foo();\n",
  after: "bar();\n",
};

describe("buildInlineEditRequest", () => {
  it("shapes a tool-free request with fenced context windows", () => {
    const request = buildInlineEditRequest("test-model", input);

    expect(request.model).toBe("test-model");
    expect(request.tools).toEqual([]);
    expect(request.maxTokens).toBeGreaterThan(0);
    expect(request.system).toContain("ONLY the replacement");
    const text = request.messages[0]?.content[0];
    expect(text?.type).toBe("text");
    if (text?.type === "text") {
      expect(text.text).toContain("File: src/app.ts");
      expect(text.text).toContain("Language: typescript");
      expect(text.text).toContain("<before-selection>");
      expect(text.text).toContain("<selection>");
      expect(text.text).toContain("foo();");
      expect(text.text).toContain("Instruction: add input validation");
    }
  });

  it("marks an empty selection as an insertion point", () => {
    const request = buildInlineEditRequest("test-model", { ...input, selection: "" });
    const text = request.messages[0]?.content[0];
    if (text?.type === "text") {
      expect(text.text).toContain('<selection empty="true"></selection>');
    } else {
      expect.unreachable();
    }
  });

  it("trims surrounding context to a bounded window", () => {
    const request = buildInlineEditRequest("test-model", {
      ...input,
      before: `prefix-${"x".repeat(INLINE_EDIT_CONTEXT_CHARS + 500)}`,
      after: `${"y".repeat(INLINE_EDIT_CONTEXT_CHARS + 500)}-suffix`,
    });
    const text = request.messages[0]?.content[0];
    if (text?.type === "text") {
      expect(text.text).not.toContain("prefix-");
      expect(text.text).not.toContain("-suffix");
      expect(text.text.length).toBeLessThan(INLINE_EDIT_CONTEXT_CHARS * 2 + 1000);
    } else {
      expect.unreachable();
    }
  });
});

describe("cleanInlineEditAnswer", () => {
  it("takes the fenced body when there is exactly one fence pair", () => {
    expect(cleanInlineEditAnswer("```ts\nconst x = 2;\n```", "const x = 1;\n")).toBe("const x = 2;\n");
  });

  it("drops a one-line preamble before the fence", () => {
    expect(cleanInlineEditAnswer("Here you go:\n```\nfoo();\n```", "foo();\n")).toBe("foo();\n");
  });

  it("keeps the answer as written when fences are absent or ambiguous", () => {
    expect(cleanInlineEditAnswer("foo();", "foo();\n")).toBe("foo();\n");
    expect(cleanInlineEditAnswer("```a\nx\n```\n```b\ny\n```", "z")).toBe("```a\nx\n```\n```b\ny\n```");
  });

  it("preserves the selection's trailing newline either way", () => {
    expect(cleanInlineEditAnswer("foo();\n\n", "foo();")).toBe("foo();");
    expect(cleanInlineEditAnswer("foo();", "foo();\n")).toBe("foo();\n");
    expect(cleanInlineEditAnswer("foo();\r\n", "foo();\r\n")).toBe("foo();\n");
  });
});

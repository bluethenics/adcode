import { describe, expect, it } from "vitest";
import { parseAiCompletionInput, parseAiInlineEditInput } from "../src/main/aiCompletionIpcValidation.ts";

describe("AI completion IPC validation", () => {
  it("accepts a bounded renderer request", () => {
    expect(parseAiCompletionInput({ requestId: 4, languageId: "ts", prefix: "const ", suffix: "" })).toEqual({
      requestId: 4,
      languageId: "ts",
      prefix: "const ",
      suffix: "",
    });
  });

  it("rejects oversized, malformed, and path-like language fields", () => {
    expect(() => parseAiCompletionInput({ requestId: 1, languageId: "C:\\secret", prefix: "x", suffix: "" })).toThrow();
    expect(() => parseAiCompletionInput({ requestId: 1, languageId: "ts", prefix: "x".repeat(6_001), suffix: "" })).toThrow();
    expect(() => parseAiCompletionInput({ requestId: -1, languageId: "ts", prefix: "x", suffix: "" })).toThrow();
  });
});

describe("AI inline-edit IPC validation", () => {
  const valid = {
    instruction: "add input validation",
    languageId: "ts",
    path: "src/app.ts",
    before: "const x = 1;\n",
    selection: "foo();\n",
    after: "bar();\n",
  };

  it("accepts a bounded rewrite request", () => {
    expect(parseAiInlineEditInput(valid)).toEqual(valid);
  });

  it("rejects empty instructions, bad languages, and oversized fields", () => {
    expect(() => parseAiInlineEditInput({ ...valid, instruction: "  " })).toThrow(/instruction/i);
    expect(() => parseAiInlineEditInput({ ...valid, instruction: "x".repeat(4_001) })).toThrow(/instruction/i);
    expect(() => parseAiInlineEditInput({ ...valid, languageId: "../secret" })).toThrow(/language/i);
    expect(() => parseAiInlineEditInput({ ...valid, path: "" })).toThrow(/path/i);
    expect(() => parseAiInlineEditInput({ ...valid, before: "x".repeat(12_001) })).toThrow(/context/i);
    expect(() => parseAiInlineEditInput({ ...valid, selection: "x".repeat(24_001) })).toThrow(/selection/i);
    expect(() => parseAiInlineEditInput(null)).toThrow();
    expect(() => parseAiInlineEditInput([])).toThrow();
  });
});

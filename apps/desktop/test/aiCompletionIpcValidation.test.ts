import { describe, expect, it } from "vitest";
import { parseAiCompletionInput } from "../src/main/aiCompletionIpcValidation.ts";

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

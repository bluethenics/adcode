import { describe, expect, it } from "vitest";
import {
  allowsAiCompletionForPath,
  completionContextAt,
} from "../src/renderer/editor/inlineCompletionContext.ts";

describe("inline completion context", () => {
  it("sends bounded text around the cursor and never a file path", () => {
    const text = `${"a".repeat(15_000)}CURSOR${"z".repeat(6_000)}`;
    const context = completionContextAt(text, 15_006, "typescript");
    expect(context.prefix.length).toBe(6_000);
    expect(context.suffix.length).toBe(2_000);
    expect(context.languageId).toBe("typescript");
    expect(JSON.stringify(context)).not.toContain("C:\\");
  });

  it("never offers provider completion for common credential files", () => {
    expect(allowsAiCompletionForPath("C:\\work\\.env.local")).toBe(false);
    expect(allowsAiCompletionForPath("/home/me/.ssh/id_rsa")).toBe(false);
    expect(allowsAiCompletionForPath("/work/server.pem")).toBe(false);
    expect(allowsAiCompletionForPath("/work/src/main.ts")).toBe(true);
  });

  it("clamps an invalid cursor offset instead of throwing", () => {
    expect(completionContextAt("const x = 1", 999, "javascript")).toEqual({
      languageId: "javascript",
      prefix: "const x = 1",
      suffix: "",
    });
  });
});

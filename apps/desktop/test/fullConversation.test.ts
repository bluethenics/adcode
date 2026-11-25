import { describe, expect, it } from "vitest";
import { countMatches, nextMatch } from "../src/renderer/ai/fullConversation.ts";

describe("finding in the whole conversation", () => {
  const text = "fix the pager. the pager test. done";

  it("finds the next match from where it is, and wraps round to the first", () => {
    expect(nextMatch(text, "pager", 0)).toBe(8);
    expect(nextMatch(text, "pager", 9)).toBe(19);
    expect(nextMatch(text, "pager", 20)).toBe(8);
    expect(nextMatch(text, "missing", 0)).toBe(-1);
    expect(nextMatch(text, "", 0)).toBe(-1);
  });

  it("counts matches, and stops counting at a cap so a one-letter search stays instant", () => {
    expect(countMatches(text, "pager")).toBe(2);
    expect(countMatches(text, "")).toBe(0);
    expect(countMatches("a".repeat(50_000), "a", 9_999)).toBe(9_999);
  });
});

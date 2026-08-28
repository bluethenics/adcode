import { describe, expect, it } from "vitest";
import { createAiUsageLimitReader, detectAiUsageLimit } from "@adcode/ai";

describe("AI usage-limit continuation detection", () => {
  it("recognises an explicit retry delay and clamps it to a safe range", () => {
    expect(detectAiUsageLimit("Usage limit reached. Try again in 12 minutes.", 1_000)).toEqual({
      retryAt: 721_000,
      reason: "Usage limit reached",
    });
    expect(detectAiUsageLimit("rate limit; retry after 2 seconds", 1_000)?.retryAt).toBe(61_000);
  });

  it("refuses to guess when the agent reports a limit without a reset time", () => {
    expect(detectAiUsageLimit("You've hit your usage limit", 1_000)).toBeNull();
  });

  it("does not react to ordinary output or the word limit in code", () => {
    expect(detectAiUsageLimit("Finished 12 tests successfully", 1_000)).toBeNull();
    expect(detectAiUsageLimit("const limit = 10;", 1_000)).toBeNull();
  });

  it("recognises a split terminal line but refuses a stale limit followed by a shell prompt", () => {
    const reader = createAiUsageLimitReader();
    expect(reader.push("Usage limit reached. Retry in ", 1_000)).toBeNull();
    expect(reader.push("12 minutes\r\n", 1_000)?.retryAt).toBe(721_000);
    expect(reader.push("PS C:\\project> ", 1_100)).toBeNull();
  });
});

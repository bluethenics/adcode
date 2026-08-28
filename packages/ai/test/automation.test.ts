import { describe, expect, it } from "vitest";
import {
  cancelAiAutomation,
  claimAiAutomation,
  completeAiAutomation,
  confirmMissedAiAutomation,
  createAiAutomation,
  missAiAutomation,
  retryAiAutomation,
} from "@adcode/ai";

describe("AI message automation", () => {
  const pending = () =>
    createAiAutomation({
      id: "automation-one",
      workspaceId: "workspace-one",
      message: "  Continue the parser work  ",
      targetId: "builtin:chat",
      targetLabel: "Built-in assistant",
      dueAt: 2_000,
      now: 1_000,
    });

  it("creates a bounded pending message without hidden execution", () => {
    const item = pending();
    expect(item).toMatchObject({
      message: "Continue the parser work",
      state: "pending",
      attempts: 0,
      dueAt: 2_000,
    });
    expect(() => createAiAutomation({ ...item, id: "../escape", now: 1_000 })).toThrow(/id/i);
    expect(() => createAiAutomation({ ...item, message: "x".repeat(8_001), now: 1_000 })).toThrow(
      /message/i,
    );
  });

  it("claims only due work and makes delivery outcomes explicit", () => {
    expect(claimAiAutomation(pending(), 1_999)).toBeNull();
    const claimed = claimAiAutomation(pending(), 2_000)!;
    expect(claimed).toMatchObject({ state: "delivering", attempts: 1 });
    expect(completeAiAutomation(claimed, 2_100).state).toBe("delivered");
  });

  it("retries with a future due time and supports cancellation", () => {
    const claimed = claimAiAutomation(pending(), 2_000)!;
    const retried = retryAiAutomation(claimed, "Target is not connected", 5_000, 2_100);
    expect(retried).toMatchObject({ state: "pending", dueAt: 5_000, lastError: "Target is not connected" });
    expect(cancelAiAutomation(retried, 2_200).state).toBe("cancelled");
  });

  it("requires an explicit confirmation before a missed message becomes due again", () => {
    const missed = missAiAutomation(pending(), 3_000);
    expect(missed.state).toBe("missed");
    expect(claimAiAutomation(missed, 3_000)).toBeNull();
    expect(confirmMissedAiAutomation(missed, 3_100)).toMatchObject({ state: "pending", dueAt: 3_100 });
  });
});

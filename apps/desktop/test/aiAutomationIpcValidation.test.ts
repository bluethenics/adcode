import { describe, expect, it } from "vitest";
import { parseAiAutomationCreate, validAiAutomationId } from "../src/main/aiAutomationIpcValidation.ts";

describe("AI automation IPC validation", () => {
  it("accepts only bounded messages, target metadata, and timestamps", () => {
    expect(
      parseAiAutomationCreate({
        message: "Continue",
        targetId: "builtin:chat",
        targetLabel: "Built-in assistant",
        dueAt: 2_000,
      }),
    ).toEqual({
      message: "Continue",
      targetId: "builtin:chat",
      targetLabel: "Built-in assistant",
      dueAt: 2_000,
    });
    expect(parseAiAutomationCreate({ message: "x".repeat(8_001), targetId: "x", dueAt: 1 })).toBeNull();
    expect(parseAiAutomationCreate({ message: "x", targetId: "../terminal", targetLabel: "x", dueAt: 1 })).toBeNull();
  });

  it("validates opaque automation ids before filesystem-backed lookups", () => {
    expect(validAiAutomationId("automation-123")).toBe(true);
    expect(validAiAutomationId("../automation-123")).toBe(false);
  });
});

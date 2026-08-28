import { describe, expect, it } from "vitest";
import type { AiAutomationView } from "../src/shared/api.ts";
import {
  aiAutomationCanCancel,
  aiAutomationCanRunMissed,
  summarizeAiAutomation,
} from "../src/renderer/ai/aiAutomationViewModel.ts";

const item = (state: AiAutomationView["state"], dueAt = 61_000): AiAutomationView => ({
  id: "automation-view",
  message: "Continue",
  targetId: "builtin:chat",
  targetLabel: "Built-in assistant",
  state,
  dueAt,
  attempts: 0,
  lastError: null,
  createdAt: 1_000,
  updatedAt: 1_000,
});

describe("AI automation presentation", () => {
  it("summarises pending and terminal states without exposing workspace paths", () => {
    expect(summarizeAiAutomation(item("pending"), 1_000)).toBe("Built-in assistant · in 1 min");
    expect(summarizeAiAutomation(item("delivering"), 1_000)).toBe("Built-in assistant · delivering");
    expect(summarizeAiAutomation(item("delivered"), 1_000)).toBe("Built-in assistant · delivered");
  });

  it("allows cancelling only work that has not finished", () => {
    expect(aiAutomationCanCancel(item("pending"))).toBe(true);
    expect(aiAutomationCanCancel(item("delivering"))).toBe(false);
    expect(aiAutomationCanCancel(item("delivered"))).toBe(false);
    expect(aiAutomationCanRunMissed(item("missed"))).toBe(true);
  });
});

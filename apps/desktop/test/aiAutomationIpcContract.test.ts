import { describe, expect, it } from "vitest";
import { createAiAutomation } from "@adcode/ai";
import { toAiAutomationView } from "../src/main/aiAutomationViews.ts";

describe("AI automation IPC contract", () => {
  it("omits the workspace identity while preserving delivery state", () => {
    const item = createAiAutomation({
      id: "automation-view",
      workspaceId: "workspace-private-hash",
      message: "Continue",
      targetId: "builtin:chat",
      targetLabel: "Built-in assistant",
      dueAt: 2_000,
      now: 1_000,
    });
    const encoded = JSON.stringify(toAiAutomationView(item));
    expect(encoded).not.toContain("workspace-private-hash");
    expect(encoded).toContain("builtin:chat");
  });
});

import { describe, expect, it } from "vitest";
import type { AiWorkspaceTaskView } from "../src/shared/api.ts";
import {
  aiWorkspaceActions,
  aiWorkspaceStateLabel,
  formatAiWorkspaceUsage,
  summarizeAiWorkspaceTask,
  traceTone,
} from "../src/renderer/ai/aiWorkspaceViewModel.ts";

const task = (state: AiWorkspaceTaskView["state"], changedPaths: string[] = []): AiWorkspaceTaskView => ({
  id: "task-view",
  prompt: "Fix the parser",
  mode: "single",
  reviewPolicy: "review",
  state,
  sandboxKind: "shadow-copy",
  changedPaths,
  usedTokens: 1_250,
  tokenLimit: 100_000,
  usedCostMicros: 250_000,
  costMicrosLimit: 2_000_000,
  checkpointPaths: state === "applied" ? ["src/parser.ts"] : [],
  createdAt: 1,
  updatedAt: 2,
});

describe("AI workspace task presentation", () => {
  it("uses plain state labels and useful file summaries", () => {
    expect(aiWorkspaceStateLabel("review")).toBe("Ready to review");
    expect(aiWorkspaceStateLabel("rolling-back")).toBe("Rolling back");
    expect(summarizeAiWorkspaceTask(task("review", ["a.ts", "b.ts"]))).toBe(
      "Ready to review · 2 files",
    );
    expect(summarizeAiWorkspaceTask(task("ready"))).toBe("Isolated workspace ready");
  });

  it("enables only actions that are legal for the current state", () => {
    expect(aiWorkspaceActions(task("review", ["a.ts"]))).toEqual({
      review: true,
      discard: true,
      rollback: false,
    });
    expect(aiWorkspaceActions(task("applied"))).toEqual({
      review: false,
      discard: false,
      rollback: true,
    });
    expect(aiWorkspaceActions(task("running"))).toEqual({
      review: false,
      discard: false,
      rollback: false,
    });
  });

  it("formats usage compactly while distinguishing budget from cost", () => {
    expect(formatAiWorkspaceUsage(task("review"))).toBe("1.3k / 100k tokens · $0.25 / $2.00");
  });

  it("maps operational outcomes to existing trace tones", () => {
    expect(traceTone("ok")).toBe("ok");
    expect(traceTone("pending")).toBe("running");
    expect(traceTone("blocked")).toBe("error");
    expect(traceTone("failed")).toBe("error");
  });
});

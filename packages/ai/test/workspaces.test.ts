import { describe, expect, it } from "vitest";
import {
  addUsage,
  canReserveUsage,
  createAiWorkspaceTask,
  createFileChange,
  createOperationalTrace,
  transitionTask,
  type AiWorkspaceTask,
} from "@adcode/ai";

const task = (): AiWorkspaceTask =>
  createAiWorkspaceTask({
    id: "task-abc123",
    workspaceId: "workspace-123",
    workspaceRoot: "C:/project",
    prompt: "Fix the failing parser test",
    now: 1_000,
  });

describe("AI workspace task", () => {
  it("starts as a conservative single-agent review task", () => {
    const created = task();

    expect(created.mode).toBe("single");
    expect(created.reviewPolicy).toBe("review");
    expect(created.state).toBe("preparing");
    expect(created.permissions).toEqual({
      readWorkspace: true,
      editSandbox: true,
      runCommands: false,
      networkRead: false,
      networkWrite: false,
    });
    expect(created.budget.tokenLimit).toBeGreaterThan(0);
    expect(created.budget.usedTokens).toBe(0);
  });

  it("records trusted review policy only when it is explicitly requested", () => {
    const trusted = createAiWorkspaceTask({
      id: "task-trusted",
      workspaceId: "workspace-123",
      workspaceRoot: "C:/project",
      prompt: "Apply this after the turn",
      reviewPolicy: "trusted",
      now: 1_000,
    });

    expect(trusted.reviewPolicy).toBe("trusted");
    expect(task().reviewPolicy).toBe("review");
    expect(() =>
      createAiWorkspaceTask({
        id: "task-invalid",
        workspaceId: "workspace-123",
        workspaceRoot: "C:/project",
        prompt: "Invalid policy",
        reviewPolicy: "automatic" as never,
        now: 1_000,
      }),
    ).toThrow(/review policy/i);
  });

  it("trims the prompt and rejects unsafe identifiers", () => {
    expect(task().prompt).toBe("Fix the failing parser test");
    expect(() =>
      createAiWorkspaceTask({ id: "../escape", workspaceId: "workspace-123", workspaceRoot: "C:/project", prompt: "x", now: 1 }),
    ).toThrow(/task id/i);
    expect(() =>
      createAiWorkspaceTask({ id: "task-ok", workspaceId: "", workspaceRoot: "C:/project", prompt: "x", now: 1 }),
    ).toThrow(/workspace/i);
  });

  it("permits only explicit lifecycle transitions", () => {
    const ready = transitionTask(task(), "ready", 1_100);
    const running = transitionTask(ready, "running", 1_200);
    const review = transitionTask(running, "review", 1_300);

    expect(review.state).toBe("review");
    expect(review.updatedAt).toBe(1_300);
    expect(() => transitionTask(task(), "applied", 1_100)).toThrow(/transition/i);
    expect(() => transitionTask(review, "running", 1_400)).toThrow(/transition/i);
  });

  it("recovers active work as paused instead of restarting it", () => {
    const running = transitionTask(transitionTask(task(), "ready", 1_001), "running", 1_002);
    const recovered = transitionTask(running, "paused", 1_003);
    expect(recovered.state).toBe("paused");
  });
});

describe("task budgets", () => {
  it("refuses a request before it can exceed either hard limit", () => {
    const budget = {
      tokenLimit: 1_000,
      costMicrosLimit: 10_000,
      usedTokens: 900,
      usedCostMicros: 8_000,
    } as const;

    expect(canReserveUsage(budget, { tokens: 100, costMicros: 2_000 })).toEqual({ ok: true });
    expect(canReserveUsage(budget, { tokens: 101, costMicros: 1 })).toEqual({
      ok: false,
      reason: "token-limit",
    });
    expect(canReserveUsage(budget, { tokens: 1, costMicros: 2_001 })).toEqual({
      ok: false,
      reason: "cost-limit",
    });
  });

  it("records actual usage without mutating the prior ledger", () => {
    const before = task().budget;
    const after = addUsage(before, { tokens: 72, costMicros: 340 });

    expect(after.usedTokens).toBe(72);
    expect(after.usedCostMicros).toBe(340);
    expect(before.usedTokens).toBe(0);
    expect(() => addUsage(before, { tokens: -1, costMicros: 0 })).toThrow(/usage/i);
  });
});

describe("workspace changes and operational traces", () => {
  it("stores portable relative paths and refuses sandbox escapes", () => {
    expect(createFileChange("src\\parser.ts", "before", "after").path).toBe("src/parser.ts");
    expect(() => createFileChange("../secret.txt", null, "x")).toThrow(/relative path/i);
    expect(() => createFileChange("C:\\secret.txt", null, "x")).toThrow(/relative path/i);
    expect(() => createFileChange("/etc/passwd", null, "x")).toThrow(/relative path/i);
  });

  it("records outcomes, not hidden reasoning, and redacts credentials", () => {
    const trace = createOperationalTrace({
      id: "trace-1",
      taskId: "task-abc123",
      at: 123,
      kind: "tool-result",
      summary: "Read src/parser.ts",
      detail: "Authorization: Bearer very-secret-token api_key=also-secret",
      outcome: "ok",
    });

    expect(trace.summary).toBe("Read src/parser.ts");
    expect(trace.detail).not.toContain("very-secret-token");
    expect(trace.detail).not.toContain("also-secret");
    expect(trace.detail).toContain("[redacted]");
    expect(() =>
      createOperationalTrace({ ...trace, kind: "reasoning" as never }),
    ).toThrow(/trace kind/i);
  });
});

import { describe, expect, it } from "vitest";
import { createTeamBudget, createTeamPlan, type TeamPlanInput } from "@adcode/ai";
import {
  createAiTeamRecord,
  type AiTeamRecord,
  type AiTeamTrace,
} from "../src/main/aiTeamStore.ts";
import {
  parseAiTeamConfigure,
  parseAiTeamSuggestion,
  validAiTeamId,
} from "../src/main/aiTeamIpcValidation.ts";
import { toAiTeamTraceView, toAiTeamView } from "../src/main/aiTeamViews.ts";
import { CHANNELS, type AiTeamConfigureInputView } from "../src/shared/api.ts";

const planInput = (): TeamPlanInput => ({
  id: "team-contract",
  prompt: "Update desktop and web",
  acceptanceCriteria: ["Both work"],
  concurrency: 2,
  roles: [
    { id: "desktop", label: "Desktop", objective: "Update desktop" },
    { id: "web", label: "Web", objective: "Update web" },
  ],
  nodes: [
    {
      id: "desktop-change",
      title: "Desktop",
      objective: "Update desktop",
      roleId: "desktop",
      dependsOn: [],
      acceptanceCriteria: ["Desktop works"],
      fileHints: ["apps/desktop"],
    },
    {
      id: "web-change",
      title: "Web",
      objective: "Update web",
      roleId: "web",
      dependsOn: [],
      acceptanceCriteria: ["Web works"],
      fileHints: ["apps/web"],
    },
  ],
});

const configureInput = (): AiTeamConfigureInputView => {
  const plan = planInput();
  return {
    ...plan,
    concurrency: plan.concurrency ?? 2,
    claims: [{ nodeId: "desktop-change", path: "apps/desktop", scope: "directory" }],
    tokenLimit: 100_000,
    costMicrosLimit: 20_000_000,
  };
};

describe("AI Team IPC channels", () => {
  it("uses a distinct channel for each command and notification", () => {
    const channels = [
      CHANNELS.aiTeamSuggest,
      CHANNELS.aiTeamConfigure,
      CHANNELS.aiTeamList,
      CHANNELS.aiTeamRead,
      CHANNELS.aiTeamStart,
      CHANNELS.aiTeamCancel,
      CHANNELS.aiTeamTraces,
      CHANNELS.aiTeamChanged,
    ];
    expect(new Set(channels).size).toBe(channels.length);
  });
});

describe("AI Team hostile-renderer validation", () => {
  it("accepts a bounded relative plan and creates hard parent and node budgets", () => {
    const parsed = parseAiTeamConfigure(configureInput(), "team-contract");
    expect(parsed?.plan.id).toBe("team-contract");
    expect(parsed?.claims[0]?.path).toBe("apps/desktop");
    expect(parsed?.budget.tokenLimit).toBe(100_000);
    expect(parsed?.budget.agentTokenLimits).toEqual({
      "desktop-change": 100_000,
      "web-change": 100_000,
    });
  });

  it("rejects traversal, absolute hints, cyclic graphs, huge limits, and unsafe ids", () => {
    const input = configureInput();
    expect(
      parseAiTeamConfigure(
        { ...input, nodes: [{ ...input.nodes[0]!, fileHints: ["../private"] }, input.nodes[1]!] },
        "team-contract",
      ),
    ).toBeNull();
    expect(
      parseAiTeamConfigure(
        { ...input, nodes: [{ ...input.nodes[0]!, fileHints: ["C:\\private"] }, input.nodes[1]!] },
        "team-contract",
      ),
    ).toBeNull();
    expect(
      parseAiTeamConfigure(
        {
          ...input,
          nodes: [
            { ...input.nodes[0]!, dependsOn: ["web-change"] },
            { ...input.nodes[1]!, dependsOn: ["desktop-change"] },
          ],
        },
        "team-contract",
      ),
    ).toBeNull();
    expect(parseAiTeamConfigure({ ...input, tokenLimit: Number.MAX_SAFE_INTEGER }, "team-contract")).toBeNull();
    expect(validAiTeamId("../team-contract")).toBe(false);
  });

  it("validates local suggestion input without retaining absolute file authority", () => {
    expect(
      parseAiTeamSuggestion({
        prompt: "Work in parallel",
        contextTokens: 10_000,
        fileHints: ["apps\\desktop", "apps/web"],
      }),
    ).toEqual({
      prompt: "Work in parallel",
      contextTokens: 10_000,
      fileHints: ["apps/desktop", "apps/web"],
    });
    expect(
      parseAiTeamSuggestion({ prompt: "Work", contextTokens: 1, fileHints: ["/private/project"] }),
    ).toBeNull();
  });
});

describe("renderer-safe AI Team views", () => {
  it("omits roots, child sandbox ids, base revisions, and full conflict file contents", () => {
    const root = "C:/private/project";
    const base = createAiTeamRecord({
      id: "team-contract",
      workspaceRoot: root,
      plan: createTeamPlan(planInput()),
      claims: [],
      budget: createTeamBudget({
        tokenLimit: 100_000,
        costMicrosLimit: 20_000_000,
        agentTokenLimits: { "desktop-change": 100_000, "web-change": 100_000 },
      }),
      now: 1,
    });
    const record: AiTeamRecord = {
      ...base,
      childTaskIds: { desktop: "task-private-child" },
      base: { kind: "git-revision", revision: "a".repeat(40), sizeBytes: 0 },
      merge: {
        state: "conflict",
        combinedTaskId: null,
        conflicts: [
          {
            path: "shared.txt",
            nodeIds: ["desktop-change", "web-change"],
            reason: "overlapping-hunks",
            original: "one\ntwo\n",
            proposals: ["one\nTWO-A\n", "one\nTWO-B\n"],
          },
        ],
      },
    };

    const view = toAiTeamView(record);
    const encoded = JSON.stringify(view);
    expect(encoded).not.toContain(root);
    expect(encoded).not.toContain("task-private-child");
    expect(encoded).not.toContain("a".repeat(40));
    expect(encoded).not.toContain('"original":"one');
    expect(view.merge.conflicts[0]?.proposals).toHaveLength(2);
    expect(view.merge.conflicts[0]?.proposals[0]?.hunks[0]?.replacement).toEqual(["TWO-A"]);
  });

  it("redacts roots and credential shapes from trace lanes", () => {
    const trace: AiTeamTrace = {
      id: "trace-contract",
      teamId: "team-contract",
      nodeId: "desktop-change",
      at: 1,
      kind: "agent",
      summary: "Read C:/private/project/src.ts",
      detail: "Authorization: Bearer secret-token",
      outcome: "ok",
    };
    const view = toAiTeamTraceView(trace, ["C:/private/project"]);
    expect(view.summary).toBe("Read [workspace]/src.ts");
    expect(view.detail).toBe("Authorization: Bearer [redacted]");
  });
});

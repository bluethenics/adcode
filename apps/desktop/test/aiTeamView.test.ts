import { describe, expect, it } from "vitest";
import type { AiTeamView } from "../src/shared/api.ts";
import {
  aiTeamActions,
  aiTeamStateLabel,
  buildAiTeamConfigureInput,
  extractTeamFileHints,
  formatAiTeamUsage,
  manualTeamSuggestion,
} from "../src/renderer/ai/aiTeamViewModel.ts";

const team = (state: AiTeamView["state"]): AiTeamView => ({
  id: "team-view",
  state,
  prompt: "Update desktop and web",
  acceptanceCriteria: ["Both work"],
  concurrency: 2,
  roles: [],
  nodes: [],
  handoffs: [],
  routes: {},
  budget: {
    usedTokens: 1_000,
    tokenLimit: 100_000,
    reservedTokens: 500,
    usedCostMicros: 0,
    costMicrosLimit: 20_000_000,
    reservedCostMicros: 0,
  },
  merge: { state: "idle", combinedTaskId: null, conflicts: [] },
  baseKind: null,
  confirmedAt: state === "configured" ? null : 2,
  createdAt: 1,
  updatedAt: 2,
});

describe("AI Team presentation", () => {
  it("uses plain state labels and counts reservations in visible usage", () => {
    expect(aiTeamStateLabel("configured")).toBe("Ready for confirmation");
    expect(aiTeamStateLabel("review")).toBe("Combined review ready");
    expect(formatAiTeamUsage(team("running"))).toBe("1.5k / 100k tokens");
  });

  it("keeps start explicit and exposes only legal actions", () => {
    expect(aiTeamActions(team("configured"))).toEqual({
      start: true,
      cancel: true,
      trace: false,
      review: false,
      conflict: false,
    });
    expect(
      aiTeamActions({
        ...team("review"),
        merge: { state: "review", combinedTaskId: "task-combined", conflicts: [] },
      }).review,
    ).toBe(true);
    expect(aiTeamActions(team("paused")).start).toBe(true);
  });

  it("extracts bounded portable hints and makes manual Team setup available", () => {
    expect(extractTeamFileHints("Change apps/desktop/src/a.ts and packages/ai/src/team.ts.")).toEqual([
      "apps/desktop/src/a.ts",
      "packages/ai/src/team.ts",
    ]);
    expect(manualTeamSuggestion("Investigate it").roles).toHaveLength(2);
  });

  it("builds bounded roles, reviewer dependencies, advisory claims, and budgets", () => {
    const suggestion = manualTeamSuggestion("Implement and review apps/desktop/src/a.ts");
    const input = buildAiTeamConfigureInput("Implement and review apps/desktop/src/a.ts", suggestion);
    expect(input.roles.map((role) => role.id)).toEqual(["implementer", "reviewer"]);
    expect(input.nodes.find((node) => node.id === "reviewer")?.dependsOn).toEqual(["implementer"]);
    expect(input.claims).toEqual([
      { nodeId: "implementer", path: "apps/desktop/src/a.ts", scope: "file" },
    ]);
    expect(input.concurrency).toBe(2);
    expect(input.tokenLimit).toBeGreaterThanOrEqual(25_000);
    expect(input.tokenLimit).toBeLessThanOrEqual(250_000);
  });
});

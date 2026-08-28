import { describe, expect, it } from "vitest";
import {
  createTeamPlan,
  suggestTeam,
  teamSuggestionDismissalKey,
  type TeamPlanInput,
} from "../src/team.ts";

const planInput = (): TeamPlanInput => ({
  id: "team-parser",
  prompt: "Improve the parser and prove it remains compatible",
  acceptanceCriteria: ["Existing syntax still parses", "New syntax has tests"],
  roles: [
    { id: "implementer", label: "Implementer", objective: "Update the parser" },
    { id: "tester", label: "Tester", objective: "Add independent compatibility tests" },
  ],
  nodes: [
    {
      id: "parser-change",
      title: "Parser change",
      objective: "Implement the syntax",
      roleId: "implementer",
      dependsOn: [],
      acceptanceCriteria: ["New syntax parses"],
      fileHints: ["packages/parser/src"],
    },
    {
      id: "parser-tests",
      title: "Parser tests",
      objective: "Prove old and new syntax",
      roleId: "tester",
      dependsOn: ["parser-change"],
      acceptanceCriteria: ["Focused tests pass"],
      fileHints: ["packages/parser/test"],
    },
  ],
});

describe("Team plan configuration", () => {
  it("uses a conservative concurrency default and preserves explicit assignments", () => {
    const plan = createTeamPlan(planInput());

    expect(plan.concurrency).toBe(2);
    expect(plan.nodes.map((node) => [node.id, node.roleId, node.dependsOn])).toEqual([
      ["parser-change", "implementer", []],
      ["parser-tests", "tester", ["parser-change"]],
    ]);
  });

  it("rejects unsafe ids, missing roles, missing dependencies, and empty acceptance criteria", () => {
    expect(() => createTeamPlan({ ...planInput(), id: "../team" })).toThrow(/team id/i);
    expect(() =>
      createTeamPlan({
        ...planInput(),
        nodes: [{ ...planInput().nodes[0]!, roleId: "invented" }, planInput().nodes[1]!],
      }),
    ).toThrow(/assigned role/i);
    expect(() =>
      createTeamPlan({
        ...planInput(),
        nodes: [planInput().nodes[0]!, { ...planInput().nodes[1]!, dependsOn: ["missing"] }],
      }),
    ).toThrow(/dependency/i);
    expect(() => createTeamPlan({ ...planInput(), acceptanceCriteria: [] })).toThrow(
      /acceptance criteria/i,
    );
  });

  it("bounds roles, nodes, concurrency, and user-authored text", () => {
    expect(() => createTeamPlan({ ...planInput(), roles: [planInput().roles[0]!] })).toThrow(
      /at least two roles/i,
    );
    expect(() => createTeamPlan({ ...planInput(), concurrency: 8 })).toThrow(/concurrency/i);
    expect(() =>
      createTeamPlan({ ...planInput(), prompt: "x".repeat(20_001) }),
    ).toThrow(/prompt/i);
  });
});

describe("local Team-mode suggestions", () => {
  it("does not interrupt a small single-focus task", () => {
    expect(
      suggestTeam({
        workspaceId: "workspace-one",
        prompt: "Rename this variable",
        contextTokens: 2_000,
        fileHints: ["src/name.ts"],
      }),
    ).toBeNull();
  });

  it("suggests independent subsystem roles with a concrete rationale and estimates", () => {
    const suggestion = suggestTeam({
      workspaceId: "workspace-one",
      prompt: "Add the desktop workflow and also update the web dashboard, then review and test both",
      contextTokens: 38_000,
      fileHints: [
        "apps/desktop/src/main/workflow.ts",
        "apps/web/src/app/dashboard/page.tsx",
        "apps/desktop/test/workflow.test.ts",
      ],
    });

    expect(suggestion).not.toBeNull();
    expect(suggestion?.reasons.join(" ")).toMatch(/independent|subsystem/i);
    expect(suggestion?.roles.length).toBeGreaterThanOrEqual(2);
    expect(suggestion?.roles.some((role) => /desktop/i.test(role.label))).toBe(true);
    expect(suggestion?.roles.some((role) => /web/i.test(role.label))).toBe(true);
    expect(suggestion?.estimatedSequentialMinutes.min).toBeGreaterThan(
      suggestion?.estimatedParallelMinutes.min ?? Infinity,
    );
    expect(suggestion?.estimatedTokens.min).toBeGreaterThan(0);
    expect(suggestion?.estimatedTokens.max).toBeGreaterThan(suggestion?.estimatedTokens.min ?? 0);
  });

  it("suggests a team for an explicit parallel request or an oversized context", () => {
    expect(
      suggestTeam({
        workspaceId: "workspace-one",
        prompt: "Use multiple agents in parallel to implement and review this feature",
        contextTokens: 5_000,
        fileHints: [],
      }),
    ).not.toBeNull();
    expect(
      suggestTeam({
        workspaceId: "workspace-one",
        prompt: "Investigate this broad regression",
        contextTokens: 90_000,
        fileHints: ["src/index.ts"],
      }),
    ).not.toBeNull();
  });

  it("keeps suggested role ids unique when one subsystem resembles a default role", () => {
    const suggestion = suggestTeam({
      workspaceId: "workspace-one",
      prompt: "Use multiple agents in parallel",
      contextTokens: 5_000,
      fileHints: ["apps/implementer/src/index.ts"],
    });
    const ids = suggestion?.roles.map((role) => role.id) ?? [];

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("creates a stable opaque dismissal key without retaining prompt text", () => {
    const prompt = "Update desktop and web in parallel";
    const first = teamSuggestionDismissalKey("workspace-one", prompt);

    expect(first).toBe(teamSuggestionDismissalKey("workspace-one", prompt));
    expect(first).not.toBe(teamSuggestionDismissalKey("workspace-two", prompt));
    expect(first).not.toContain("desktop");
    expect(first).toMatch(/^team-suggestion-[a-z0-9]+$/);
  });
});

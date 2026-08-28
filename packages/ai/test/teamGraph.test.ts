import { describe, expect, it } from "vitest";
import { createTeamPlan, type TeamPlanInput } from "../src/team.ts";
import {
  completeTeamNode,
  createFileClaim,
  createTeamGraph,
  createTeamHandoff,
  failTeamNode,
  readyTeamNodes,
  reportFileClaimConflicts,
  startTeamNode,
  teamGraphState,
  teamNodeContext,
  validateFileClaims,
} from "../src/teamGraph.ts";

const input = (): TeamPlanInput => ({
  id: "team-graph",
  prompt: "Change desktop and web, then review the combined result",
  acceptanceCriteria: ["Both surfaces work", "Focused tests pass"],
  roles: [
    { id: "desktop", label: "Desktop", objective: "Own desktop" },
    { id: "web", label: "Web", objective: "Own web" },
    { id: "reviewer", label: "Reviewer", objective: "Review both" },
  ],
  nodes: [
    {
      id: "web-change",
      title: "Web change",
      objective: "Update web",
      roleId: "web",
      dependsOn: [],
      acceptanceCriteria: ["Web tests pass"],
      fileHints: ["apps/web"],
    },
    {
      id: "desktop-change",
      title: "Desktop change",
      objective: "Update desktop",
      roleId: "desktop",
      dependsOn: [],
      acceptanceCriteria: ["Desktop tests pass"],
      fileHints: ["apps/desktop"],
    },
    {
      id: "review",
      title: "Review",
      objective: "Review the combined result",
      roleId: "reviewer",
      dependsOn: ["desktop-change", "web-change"],
      acceptanceCriteria: ["No blocking finding remains"],
      fileHints: [],
    },
  ],
});

describe("Team task graph", () => {
  it("returns only dependency-ready nodes in deterministic order", () => {
    const graph = createTeamGraph(createTeamPlan(input()));
    expect(readyTeamNodes(graph).map((node) => node.id)).toEqual(["desktop-change", "web-change"]);

    const desktop = startTeamNode(graph, "desktop-change", 10);
    const desktopDone = completeTeamNode(desktop, "desktop-change", 20);
    expect(readyTeamNodes(desktopDone).map((node) => node.id)).toEqual(["web-change"]);

    const webDone = completeTeamNode(startTeamNode(desktopDone, "web-change", 21), "web-change", 30);
    expect(readyTeamNodes(webDone).map((node) => node.id)).toEqual(["review"]);
  });

  it("detects dependency cycles before any node can run", () => {
    const cyclic = createTeamPlan({
      ...input(),
      nodes: input().nodes.map((node) =>
        node.id === "desktop-change"
          ? { ...node, dependsOn: ["review"] }
          : node,
      ),
    });
    expect(() => createTeamGraph(cyclic)).toThrow(/cycle/i);
  });

  it("blocks downstream work after failure and reports terminal graph state", () => {
    let graph = createTeamGraph(createTeamPlan(input()));
    graph = startTeamNode(graph, "desktop-change", 10);
    graph = failTeamNode(graph, "desktop-change", "Provider unavailable", 20);

    expect(graph.nodes.find((node) => node.id === "review")?.state).toBe("blocked");
    expect(readyTeamNodes(graph).map((node) => node.id)).toEqual(["web-change"]);
    graph = completeTeamNode(startTeamNode(graph, "web-change", 21), "web-change", 30);
    expect(teamGraphState(graph)).toBe("failed");
  });

  it("refuses illegal starts and backwards timestamps", () => {
    const graph = createTeamGraph(createTeamPlan(input()), 10);
    expect(() => startTeamNode(graph, "review", 11)).toThrow(/not ready/i);
    expect(() => startTeamNode(graph, "desktop-change", 9)).toThrow(/timestamp/i);
  });
});

describe("advisory file claims", () => {
  it("reports exact and directory-prefix overlaps without treating claims as locks", () => {
    const claims = [
      createFileClaim({ nodeId: "desktop-change", path: "apps/desktop/src", scope: "directory" }),
      createFileClaim({ nodeId: "web-change", path: "apps/desktop/src/shared.ts", scope: "file" }),
      createFileClaim({ nodeId: "review", path: "apps/web", scope: "directory" }),
    ];

    expect(reportFileClaimConflicts(claims)).toEqual([
      {
        firstNodeId: "desktop-change",
        secondNodeId: "web-change",
        firstPath: "apps/desktop/src",
        secondPath: "apps/desktop/src/shared.ts",
      },
    ]);
  });

  it("rejects traversal, absolute paths, duplicates, and contradictory exclusive claims", () => {
    for (const path of ["../secret", "/etc/passwd", "C:\\secret", "src//file.ts", "src/./file.ts"]) {
      expect(() => createFileClaim({ nodeId: "desktop-change", path, scope: "file" })).toThrow(
        /claim path/i,
      );
    }
    const duplicate = createFileClaim({ nodeId: "desktop-change", path: "src/a.ts", scope: "file" });
    expect(() => validateFileClaims([duplicate, duplicate])).toThrow(/duplicate/i);
    expect(() =>
      validateFileClaims([
        createFileClaim({
          nodeId: "desktop-change",
          path: "src",
          scope: "directory",
          exclusive: true,
        }),
        createFileClaim({
          nodeId: "web-change",
          path: "src/a.ts",
          scope: "file",
          exclusive: true,
        }),
      ]),
    ).toThrow(/exclusive claims overlap/i);
  });
});

describe("compact Team handoffs", () => {
  it("shares dependency findings, decisions, tests, and dead ends without transcripts", () => {
    const plan = createTeamPlan(input());
    const handoff = createTeamHandoff({
      nodeId: "desktop-change",
      summary: "Desktop workflow implemented",
      findings: ["IPC already had a bounded path validator"],
      decisions: ["Reused the existing bridge"],
      changedPaths: ["apps/desktop/src/main/workflow.ts"],
      tests: [{ command: "vitest workflow", outcome: "passed", summary: "4 tests passed" }],
      blockers: [],
      deadEnds: ["A renderer-only implementation could not enforce authority"],
      completedAt: 20,
    });
    const claims = [
      createFileClaim({ nodeId: "review", path: "apps", scope: "directory" }),
      createFileClaim({ nodeId: "desktop-change", path: "apps/desktop", scope: "directory" }),
    ];
    const context = teamNodeContext(plan, "review", [handoff], claims);

    expect(context.dependencies).toEqual([handoff]);
    expect(context.claims.map((claim) => claim.nodeId)).toEqual(["review"]);
    expect(JSON.stringify(context)).not.toMatch(/transcript|assistant messages/i);
    expect(JSON.stringify(context).length).toBeLessThan(10_000);
  });

  it("bounds handoff arrays and text", () => {
    expect(() =>
      createTeamHandoff({
        nodeId: "desktop-change",
        summary: "x".repeat(2_001),
        findings: [],
        decisions: [],
        changedPaths: [],
        tests: [],
        blockers: [],
        deadEnds: [],
        completedAt: 20,
      }),
    ).toThrow(/summary/i);
    expect(() =>
      createTeamHandoff({
        nodeId: "desktop-change",
        summary: "Done",
        findings: Array.from({ length: 21 }, (_, index) => `finding ${String(index)}`),
        decisions: [],
        changedPaths: [],
        tests: [],
        blockers: [],
        deadEnds: [],
        completedAt: 20,
      }),
    ).toThrow(/findings/i);
  });
});

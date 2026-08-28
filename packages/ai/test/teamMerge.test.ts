import { describe, expect, it } from "vitest";
import { createFileChange, createTeamPlan, type TeamPlanInput } from "@adcode/ai";
import { planTeamMerge } from "../src/teamMerge.ts";

const input = (): TeamPlanInput => ({
  id: "team-merge",
  prompt: "Merge independent changes",
  acceptanceCriteria: ["Combined review is deterministic"],
  roles: [
    { id: "alpha", label: "Alpha", objective: "First change" },
    { id: "beta", label: "Beta", objective: "Second change" },
    { id: "reviewer", label: "Reviewer", objective: "Review" },
  ],
  nodes: [
    {
      id: "alpha-change",
      title: "Alpha",
      objective: "First change",
      roleId: "alpha",
      dependsOn: [],
      acceptanceCriteria: ["Alpha done"],
      fileHints: [],
    },
    {
      id: "beta-change",
      title: "Beta",
      objective: "Second change",
      roleId: "beta",
      dependsOn: [],
      acceptanceCriteria: ["Beta done"],
      fileHints: [],
    },
    {
      id: "review",
      title: "Review",
      objective: "Review",
      roleId: "reviewer",
      dependsOn: ["alpha-change", "beta-change"],
      acceptanceCriteria: ["Review done"],
      fileHints: [],
    },
  ],
});

describe("deterministic Team merge planning", () => {
  it("merges disjoint files in dependency and lexical order", () => {
    const plan = createTeamPlan(input());
    const result = planTeamMerge(plan, [
      { nodeId: "beta-change", changes: [createFileChange("b.ts", "b\n", "B\n")] },
      { nodeId: "alpha-change", changes: [createFileChange("a.ts", "a\n", "A\n")] },
    ]);

    expect(result.nodeOrder).toEqual(["alpha-change", "beta-change"]);
    expect(result.changes.map((change) => change.path)).toEqual(["a.ts", "b.ts"]);
    expect(result.conflicts).toEqual([]);
  });

  it("combines non-overlapping hunks in one file", () => {
    const original = "one\ntwo\nthree\nfour\n";
    const plan = createTeamPlan(input());
    const result = planTeamMerge(plan, [
      {
        nodeId: "alpha-change",
        changes: [createFileChange("shared.txt", original, "ONE\ntwo\nthree\nfour\n")],
      },
      {
        nodeId: "beta-change",
        changes: [createFileChange("shared.txt", original, "one\ntwo\nthree\nFOUR\n")],
      },
    ]);

    expect(result.conflicts).toEqual([]);
    expect(result.changes[0]).toEqual(
      createFileChange("shared.txt", original, "ONE\ntwo\nthree\nFOUR\n"),
    );
  });

  it("reports overlapping edits without silently choosing an agent", () => {
    const original = "one\ntwo\nthree\n";
    const result = planTeamMerge(createTeamPlan(input()), [
      {
        nodeId: "alpha-change",
        changes: [createFileChange("shared.txt", original, "one\nTWO-A\nthree\n")],
      },
      {
        nodeId: "beta-change",
        changes: [createFileChange("shared.txt", original, "one\nTWO-B\nthree\n")],
      },
    ]);

    expect(result.changes).toEqual([]);
    expect(result.conflicts).toEqual([
      {
        path: "shared.txt",
        nodeIds: ["alpha-change", "beta-change"],
        reason: "overlapping-hunks",
        original,
        proposals: ["one\nTWO-A\nthree\n", "one\nTWO-B\nthree\n"],
      },
    ]);
  });

  it("reports different bases and delete/edit overlap as conflicts", () => {
    const plan = createTeamPlan(input());
    const differentBase = planTeamMerge(plan, [
      { nodeId: "alpha-change", changes: [createFileChange("x.ts", "old-a", "new-a")] },
      { nodeId: "beta-change", changes: [createFileChange("x.ts", "old-b", "new-b")] },
    ]);
    expect(differentBase.conflicts[0]?.reason).toBe("different-base");

    const deleteEdit = planTeamMerge(plan, [
      { nodeId: "alpha-change", changes: [createFileChange("x.ts", "a\nb\nc", "")] },
      { nodeId: "beta-change", changes: [createFileChange("x.ts", "a\nb\nc", "a\nB\nc")] },
    ]);
    expect(deleteEdit.conflicts[0]?.reason).toBe("overlapping-hunks");
  });

  it("rejects invented nodes, duplicate contributions, and unsafe output paths", () => {
    const plan = createTeamPlan(input());
    expect(() => planTeamMerge(plan, [{ nodeId: "invented", changes: [] }])).toThrow(/node/i);
    expect(() =>
      planTeamMerge(plan, [
        { nodeId: "alpha-change", changes: [] },
        { nodeId: "alpha-change", changes: [] },
      ]),
    ).toThrow(/duplicate/i);
    expect(() =>
      planTeamMerge(plan, [
        {
          nodeId: "alpha-change",
          changes: [{ path: "../secret", original: "a", proposed: "b" }],
        },
      ]),
    ).toThrow(/relative path/i);
  });

  it("is independent of agent completion timing", () => {
    const plan = createTeamPlan(input());
    const contributions = [
      { nodeId: "beta-change", changes: [createFileChange("b.ts", "b", "B")] },
      { nodeId: "alpha-change", changes: [createFileChange("a.ts", "a", "A")] },
    ];
    expect(planTeamMerge(plan, contributions)).toEqual(planTeamMerge(plan, [...contributions].reverse()));
  });
});

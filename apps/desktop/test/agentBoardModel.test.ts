/**
 * The Agents board: which column a run sits in, what its box says, and which buttons it offers.
 *
 * The board is where a person decides what to do next, so a wrong column is a wrong decision:
 * a finished run sitting under Working looks stuck, and a conflict hiding in Finished never
 * gets resolved. Every state a run can reach is pinned here.
 */
import { describe, expect, it } from "vitest";
import type { AiTeamView, AiWorkspaceTaskView } from "../src/shared/api.ts";
import {
  agentBoxActions,
  boardSummary,
  buildBoard,
  columnFor,
  evidenceChips,
  runStatus,
  type BoxStatus,
} from "../src/renderer/agents/agentBoardModel.ts";

const NOW = new Date(2026, 8, 28, 15, 0, 0).getTime();

function run(overrides: Partial<AiTeamView> = {}): AiTeamView {
  return {
    id: "team-run",
    kind: "solo",
    group: null,
    hold: null,
    touchedPaths: [],
    state: "running",
    prompt: "Fix the login button\nIt does nothing",
    acceptanceCriteria: ["Done"],
    concurrency: 1,
    roles: [{ id: "starter-bug-fixer", label: "Bug fixer", objective: "Fix bugs", route: { provider: "anthropic", model: "claude-sonnet-5" } }],
    nodes: [{ id: "task", title: "Fix the login button", objective: "Fix it", roleId: "starter-bug-fixer", dependsOn: [], acceptanceCriteria: ["Works"], fileHints: [], state: "running", failure: null }],
    handoffs: [],
    routes: {},
    budget: { usedTokens: 12_300, tokenLimit: 2_000_000, reservedTokens: 0, usedCostMicros: 0, costMicrosLimit: 1_000_000_000_000, reservedCostMicros: 0 },
    merge: { state: "idle", combinedTaskId: null, conflicts: [] },
    baseKind: "git-revision",
    activity: { task: { text: "Editing src/login.ts", at: NOW - 1_000 } },
    confirmedAt: NOW - 60_000,
    createdAt: NOW - 61_000,
    updatedAt: NOW - 1_000,
    ...overrides,
  };
}

function task(state: AiWorkspaceTaskView["state"], changedPaths: readonly string[] = ["src/login.ts"]): AiWorkspaceTaskView {
  return { id: "task-combined", state, changedPaths } as unknown as AiWorkspaceTaskView;
}

const reviewRun = (overrides: Partial<AiTeamView> = {}) =>
  run({ state: "review", merge: { state: "review", combinedTaskId: "task-combined", conflicts: [] }, nodes: [{ ...run().nodes[0]!, state: "completed" }], ...overrides });

describe("run status", () => {
  it("shows a run with an agent working as running, and one waiting for a slot as queued", () => {
    expect(runStatus(run(), null)).toBe("running");
    expect(runStatus(run({ nodes: [{ ...run().nodes[0]!, state: "pending" }] }), null)).toBe("queued");
    expect(runStatus(run({ state: "preparing" }), null)).toBe("running");
  });

  it("tells a spent budget apart from a pause after restart", () => {
    const spent = run({ state: "paused", budget: { ...run().budget, usedCostMicros: 500_000, costMicrosLimit: 500_000 } });
    expect(runStatus(spent, null)).toBe("budget");
    expect(runStatus(run({ state: "paused" }), null)).toBe("paused");
  });

  it("follows the combined change through review, apply, undo and discard", () => {
    expect(runStatus(reviewRun(), task("review"))).toBe("ready");
    expect(runStatus(reviewRun(), task("applied"))).toBe("applied");
    expect(runStatus(reviewRun(), task("conflict"))).toBe("conflict");
    expect(runStatus(reviewRun(), task("discarded"))).toBe("discarded");
    const completed = reviewRun({ state: "completed" });
    expect(runStatus(completed, task("applied"))).toBe("applied");
    expect(runStatus(completed, task("rolled-back"))).toBe("rolled-back");
    expect(runStatus(run({ state: "completed", merge: { state: "completed", combinedTaskId: null, conflicts: [] } }), null)).toBe("completed");
  });

  it("maps the remaining states directly", () => {
    expect(runStatus(run({ state: "configured" }), null)).toBe("configured");
    expect(runStatus(run({ state: "merging" }), null)).toBe("merging");
    expect(runStatus(run({ state: "conflict" }), null)).toBe("conflict");
    expect(runStatus(run({ state: "failed" }), null)).toBe("failed");
    expect(runStatus(run({ state: "cancelled" }), null)).toBe("cancelled");
  });
});

describe("columns", () => {
  it("puts every status in the column a person would look for it in", () => {
    const expected: Record<BoxStatus, string> = {
      queued: "working", running: "working", merging: "working",
      configured: "needs-you", conflict: "needs-you", failed: "needs-you", budget: "needs-you", paused: "needs-you",
      ready: "ready",
      applied: "finished", completed: "finished", cancelled: "finished", discarded: "finished", "rolled-back": "finished",
    };
    for (const [status, column] of Object.entries(expected)) expect(columnFor(status as BoxStatus)).toBe(column);
  });
});

describe("box buttons", () => {
  it("offers exactly the ways forward each state has", () => {
    expect(agentBoxActions("running", "solo")).toEqual(["stop"]);
    expect(agentBoxActions("queued", "solo")).toEqual(["stop"]);
    expect(agentBoxActions("configured", "team")).toEqual(["start", "stop"]);
    expect(agentBoxActions("ready", "solo")).toEqual(["review", "apply", "apply-continue", "discard"]);
    expect(agentBoxActions("ready", "team")).toEqual(["review", "apply", "discard"]);
    expect(agentBoxActions("applied", "solo")).toEqual(["continue", "undo"]);
    expect(agentBoxActions("applied", "team")).toEqual(["undo"]);
    expect(agentBoxActions("conflict", "solo")).toEqual(["resolve"]);
    expect(agentBoxActions("failed", "solo")).toEqual(["retry", "open-chat"]);
    expect(agentBoxActions("failed", "team")).toEqual(["open-chat"]);
    expect(agentBoxActions("budget", "solo")).toEqual(["raise-cap", "stop"]);
    expect(agentBoxActions("paused", "solo")).toEqual(["resume", "stop"]);
    expect(agentBoxActions("completed", "solo")).toEqual(["continue", "open-chat"]);
    expect(agentBoxActions("cancelled", "solo")).toEqual(["retry"]);
    expect(agentBoxActions("rolled-back", "team")).toEqual([]);
  });
});

describe("the board", () => {
  it("builds boxes that say what the agent is doing, with the model and usage", () => {
    const board = buildBoard({ teams: [run()], tasks: [], chat: { streaming: false, title: "" }, now: NOW });
    const box = board.working[0]!;
    expect(box).toMatchObject({ id: "team-run", kind: "solo", title: "Fix the login button", agentLabel: "Bug fixer", modelLabel: "claude-sonnet-5", status: "running", statusText: "Editing src/login.ts", usage: "12k tokens", cost: null, roleIds: ["starter-bug-fixer"] });
  });

  it("never shows a fake $0 and shows a real cost", () => {
    expect(buildBoard({ teams: [run()], tasks: [], chat: { streaming: false, title: "" }, now: NOW }).working[0]!.cost).toBeNull();
    const paid = run({ budget: { ...run().budget, usedCostMicros: 81_000 } });
    expect(buildBoard({ teams: [paid], tasks: [], chat: { streaming: false, title: "" }, now: NOW }).working[0]!.cost).toBe("$0.08");
  });

  it("puts the main chat on the board while it is replying", () => {
    const board = buildBoard({ teams: [], tasks: [], chat: { streaming: true, title: "Landing page" }, now: NOW });
    expect(board.working[0]).toMatchObject({ id: "main-chat", kind: "chat", title: "Landing page", actions: ["open-chat"] });
    expect(buildBoard({ teams: [], tasks: [], chat: { streaming: false, title: "Landing page" }, now: NOW }).working).toEqual([]);
  });

  it("counts changed files from the combined change when there is one", () => {
    const board = buildBoard({ teams: [reviewRun()], tasks: [task("review", ["a.ts", "b.ts"])], chat: { streaming: false, title: "" }, now: NOW });
    expect(board.ready[0]).toMatchObject({ files: 2, status: "ready", combinedTaskId: "task-combined" });
  });

  it("keeps only today's finished runs", () => {
    const yesterday = new Date(2026, 8, 27, 23, 0, 0).getTime();
    const board = buildBoard({
      teams: [run({ id: "team-old", state: "cancelled", updatedAt: yesterday }), run({ id: "team-new", state: "cancelled", updatedAt: NOW - 10 })],
      tasks: [],
      chat: { streaming: false, title: "" },
      now: NOW,
    });
    expect(board.finished.map((box) => box.id)).toEqual(["team-new"]);
  });

  it("says why a failed run stopped", () => {
    const failed = run({ state: "failed", nodes: [{ ...run().nodes[0]!, state: "failed", failure: "The provider returned an empty answer" }] });
    expect(buildBoard({ teams: [failed], tasks: [], chat: { streaming: false, title: "" }, now: NOW })["needs-you"][0]!.statusText).toBe("The provider returned an empty answer");
  });

  it("labels a Team by its size", () => {
    const team = run({ id: "team-two", kind: "team", roles: [run().roles[0]!, { id: "starter-tester", label: "Tester", objective: "Test" }] });
    expect(buildBoard({ teams: [team], tasks: [], chat: { streaming: false, title: "" }, now: NOW }).working[0]!).toMatchObject({ agentLabel: "Team of 2", roleIds: ["starter-bug-fixer", "starter-tester"] });
  });
});

describe("board summary", () => {
  it("says how many are working, how many need you, and what today cost", () => {
    const board = buildBoard({
      teams: [run({ budget: { ...run().budget, usedCostMicros: 410_000 } }), run({ id: "team-stuck", state: "failed", nodes: [{ ...run().nodes[0]!, state: "failed", failure: "x" }] })],
      tasks: [],
      chat: { streaming: false, title: "" },
      now: NOW,
    });
    expect(boardSummary(board)).toBe("1 working · 1 needs you · $0.41 today");
    expect(boardSummary(buildBoard({ teams: [], tasks: [], chat: { streaming: false, title: "" }, now: NOW }))).toBe("Nothing running");
  });
});

describe("box usage line", () => {
  it("stays quiet until the run has spent something", () => {
    const fresh = run({ budget: { ...run().budget, usedTokens: 0 } });
    expect(buildBoard({ teams: [fresh], tasks: [], chat: { streaming: false, title: "" }, now: NOW }).working[0]!.usage).toBe("");
  });
});

describe("a run that failed for want of a connection", () => {
  it("says so plainly and offers Connect first", () => {
    for (const failure of ["Connect anthropic before starting this Team", "No connection for anthropic", "No API key for Anthropic. Add one in Connect a model."]) {
      const failed = run({ state: "failed", nodes: [{ ...run().nodes[0]!, state: "failed", failure }] });
      const box = buildBoard({ teams: [failed], tasks: [], chat: { streaming: false, title: "" }, now: NOW })["needs-you"][0]!;
      expect(box.statusText, failure).toBe("Connect a model to run this, then press Run again");
      expect(box.actions, failure).toEqual(["connect", "retry", "open-chat"]);
    }
  });

  it("keeps other failures as they are", () => {
    const failed = run({ state: "failed", nodes: [{ ...run().nodes[0]!, state: "failed", failure: "The model refused the request" }] });
    expect(buildBoard({ teams: [failed], tasks: [], chat: { streaming: false, title: "" }, now: NOW })["needs-you"][0]!.actions).toEqual(["retry", "open-chat"]);
  });
});

describe("proof of work on the board", () => {
  it("says why a finished run was held instead of applied", () => {
    const held = reviewRun({ hold: "a check failed: npm test" });
    expect(buildBoard({ teams: [held], tasks: [task("review")], chat: { streaming: false, title: "" }, now: NOW }).ready[0]!.statusText).toBe("Held for your review: a check failed: npm test");
  });

  it("turns checks and risks into a few chips, failures first", () => {
    const chips = evidenceChips(
      [{ command: "npm test", ok: true }, { command: "npx tsc --noEmit", ok: false }],
      [{ kind: "secret", path: "src/config.ts", text: "Possible secret added in src/config.ts" }, { kind: "sensitive", path: "src/auth.ts", text: "Touches sign-in, payment or permission code: src/auth.ts" }, { kind: "dependencies", path: null, text: "Changes dependencies" }],
    );
    expect(chips.map((chip) => chip.tone)).toEqual(["fail", "warn", "warn", "ok", "more"]);
    expect(chips[0]).toEqual({ tone: "fail", text: "npx tsc --noEmit failed", title: "npx tsc --noEmit failed" });
    expect(chips[1]!.text).toBe("Possible secret");
    expect(chips[3]).toEqual({ tone: "ok", text: "npm test", title: "npm test passed" });
    expect(chips[4]).toEqual({ tone: "more", text: "+1", title: "Changes dependencies" });
    expect(evidenceChips([], [])).toEqual([]);
  });
});

describe("stuck runs", () => {
  it("offers another way first when the stuck guard stopped a run", () => {
    const stuck = run({ state: "failed", nodes: [{ ...run().nodes[0]!, state: "failed", failure: "Stuck: npm test kept failing (4 tries)" }] });
    const box = buildBoard({ teams: [stuck], tasks: [], chat: { streaming: false, title: "" }, now: NOW })["needs-you"][0]!;
    expect(box.statusText).toBe("Stuck: npm test kept failing (4 tries)");
    expect(box.actions).toEqual(["rethink", "open-chat"]);
  });
});

describe("race lanes", () => {
  const lane = (id: string, createdAt: number, overrides: Partial<AiTeamView> = {}) => run({ id, group: "race-abc123", createdAt, confirmedAt: createdAt, ...overrides });

  it("labels each lane and holds Compare until every lane has finished", () => {
    const working = buildBoard({ teams: [lane("team-a", 1, { state: "review", merge: { state: "review", combinedTaskId: "task-a", conflicts: [] } }), lane("team-b", 2)], tasks: [], chat: { streaming: false, title: "" }, now: NOW });
    expect(working.ready[0]!.raceLabel).toBe("Race · 1 of 2");
    expect(working.working[0]!.raceLabel).toBe("Race · 2 of 2");
    expect(working.ready[0]!.actions).not.toContain("compare");
  });

  it("offers Compare on every ready lane once all are done, and never a lone Apply", () => {
    const done = (id: string, at: number) => lane(id, at, { state: "review", merge: { state: "review", combinedTaskId: `task-${id}`, conflicts: [] } });
    const board = buildBoard({ teams: [done("team-a", 1), done("team-b", 2), lane("team-c", 3, { state: "failed", nodes: [{ ...run().nodes[0]!, state: "failed", failure: "x" }] })], tasks: [], chat: { streaming: false, title: "" }, now: NOW });
    for (const box of board.ready) expect(box.actions).toEqual(["compare", "review", "discard"]);
    expect(board.ready.map((box) => box.group)).toEqual(["race-abc123", "race-abc123"]);
  });
});

describe("collisions between live runs", () => {
  it("warns both boxes when two live runs edit the same file", () => {
    const a = run({ id: "team-a", touchedPaths: ["src/app.ts", "src/a.ts"], nodes: [{ ...run().nodes[0]!, title: "Fix login" }] });
    const b = run({ id: "team-b", touchedPaths: ["src/app.ts"], roles: [{ id: "starter-tester", label: "Tester", objective: "t" }], nodes: [{ ...run().nodes[0]!, roleId: "starter-tester", title: "Add tests" }] });
    const board = buildBoard({ teams: [a, b], tasks: [], chat: { streaming: false, title: "" }, now: NOW });
    const byId = new Map(board.working.map((box) => [box.id, box]));
    expect(byId.get("team-a")!.warnings).toEqual(["Also edited by Tester (Add tests): src/app.ts"]);
    expect(byId.get("team-b")!.warnings).toEqual(["Also edited by Bug fixer (Fix login): src/app.ts"]);
  });

  it("ignores finished runs", () => {
    const a = run({ id: "team-a", touchedPaths: ["src/app.ts"] });
    const b = run({ id: "team-b", state: "cancelled", touchedPaths: ["src/app.ts"] });
    expect(buildBoard({ teams: [a, b], tasks: [], chat: { streaming: false, title: "" }, now: NOW }).working[0]!.warnings).toEqual([]);
  });
});

describe("cost against a cap", () => {
  it("shows spend against the cap once something is spent", () => {
    const capped = run({ budget: { ...run().budget, usedCostMicros: 80_000, costMicrosLimit: 500_000 } });
    expect(buildBoard({ teams: [capped], tasks: [], chat: { streaming: false, title: "" }, now: NOW }).working[0]!.cost).toBe("$0.08 of $0.50");
  });
});

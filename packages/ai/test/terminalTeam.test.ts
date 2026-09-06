import { describe, expect, it } from "vitest";
import {
  TERMINAL_TEAM_DONE,
  buildTerminalTeamPlan,
  completeTerminalTeamNode,
  createTeamPlan,
  createTerminalTeam,
  createTerminalTeamWatcher,
  failTerminalTeamNode,
  nextTerminalTeamDispatch,
  startTerminalTeamNode,
  terminalTeamNodeContext,
  terminalTeamNodeIsQuiet,
  terminalTeamPrompt,
  terminalTeamState,
  type TeamPlan,
} from "@adcode/ai";

/**
 * Two roles, three nodes: `tokens` and `docs` are independent, `wire` waits for `tokens`.
 * That is the smallest shape that can tell a dependency bug from a concurrency bug.
 */
function plan(concurrency = 2): TeamPlan {
  return createTeamPlan({
    id: "dark-mode",
    prompt: "Add a dark mode",
    acceptanceCriteria: ["The theme survives a restart"],
    roles: [
      { id: "styles", label: "Styles", objective: "Own the CSS and the tokens" },
      { id: "docs", label: "Docs", objective: "Own the written docs" },
    ],
    nodes: [
      {
        id: "tokens",
        title: "Define the colour tokens",
        objective: "Add a dark palette next to the light one",
        roleId: "styles",
        dependsOn: [],
        acceptanceCriteria: ["Every token has a dark value"],
        fileHints: ["src/theme.css"],
      },
      {
        id: "wire",
        title: "Wire the toggle",
        objective: "Switch the palette from the settings toggle",
        roleId: "styles",
        dependsOn: ["tokens"],
        acceptanceCriteria: ["The toggle flips the palette"],
        fileHints: [],
      },
      {
        id: "docs",
        title: "Document it",
        objective: "Write the dark mode page",
        roleId: "docs",
        dependsOn: [],
        acceptanceCriteria: ["The page names the toggle"],
        fileHints: [],
      },
    ],
    concurrency,
  });
}

const assignments = [
  { roleId: "styles", agentId: "grok" },
  { roleId: "docs", agentId: "kimi" },
] as const;

describe("createTerminalTeam", () => {
  it("binds every role to a CLI", () => {
    const team = createTerminalTeam("team-1", plan(), assignments, 0);
    expect(team.graph.nodes).toHaveLength(3);
    expect(team.running).toEqual([]);
    expect(terminalTeamState(team)).toBe("active");
  });

  /*
   * A half-assigned team would run until it reached the unassigned role and then stall
   * with nothing to say about why. Refusing at creation is the only honest moment.
   */
  it("refuses a plan with a role no agent takes", () => {
    expect(() => createTerminalTeam("team-1", plan(), [assignments[0]], 0)).toThrow(
      /role docs has no agent/,
    );
  });

  it("refuses a role that is not in the plan", () => {
    expect(() =>
      createTerminalTeam("team-1", plan(), [...assignments, { roleId: "tests", agentId: "codex" }], 0),
    ).toThrow(/no role tests/);
  });

  it("refuses the same role twice", () => {
    expect(() =>
      createTerminalTeam("team-1", plan(), [...assignments, { roleId: "docs", agentId: "codex" }], 0),
    ).toThrow(/assigned twice/);
  });
});

describe("nextTerminalTeamDispatch", () => {
  it("offers only the nodes whose dependencies are met, with their agent", () => {
    const team = createTerminalTeam("team-1", plan(), assignments, 0);
    expect(nextTerminalTeamDispatch(team)).toEqual([
      { nodeId: "docs", roleId: "docs", agentId: "kimi" },
      { nodeId: "tokens", roleId: "styles", agentId: "grok" },
    ]);
  });

  it("holds a dependent node back until its dependency completes", () => {
    let team = createTerminalTeam("team-1", plan(), assignments, 0);
    team = startTerminalTeamNode(team, "tokens", 1, 1);
    expect(nextTerminalTeamDispatch(team).map((d) => d.nodeId)).toEqual(["docs"]);

    team = startTerminalTeamNode(team, "docs", 2, 2);
    expect(nextTerminalTeamDispatch(team)).toEqual([]);

    team = completeTerminalTeamNode(team, "tokens", "done", 3);
    expect(nextTerminalTeamDispatch(team)).toEqual([
      { nodeId: "wire", roleId: "styles", agentId: "grok" },
    ]);
  });

  /* Concurrency counts panes in flight, which is the whole point of the setting. */
  it("never offers more than the plan's concurrency", () => {
    const team = createTerminalTeam("team-1", plan(1), assignments, 0);
    expect(nextTerminalTeamDispatch(team)).toHaveLength(1);
  });

  /*
   * A failure blocks what depended on it and nothing else. One CLI falling over should not
   * stop the teammate working on an unrelated file - that is the whole reason for splitting
   * the work by role in the first place.
   */
  it("blocks a failed node's dependants but keeps independent branches running", () => {
    let team = createTerminalTeam("team-1", plan(), assignments, 0);
    team = startTerminalTeamNode(team, "tokens", 1, 1);
    team = failTerminalTeamNode(team, "tokens", "the CLI exited", 2);

    expect(team.graph.nodes.find((node) => node.id === "wire")?.state).toBe("blocked");
    expect(nextTerminalTeamDispatch(team).map((d) => d.nodeId)).toEqual(["docs"]);
    expect(terminalTeamState(team)).toBe("active");
  });

  it("reports failure only once no branch can move", () => {
    let team = createTerminalTeam("team-1", plan(), assignments, 0);
    team = startTerminalTeamNode(team, "tokens", 1, 1);
    team = failTerminalTeamNode(team, "tokens", "the CLI exited", 2);
    team = startTerminalTeamNode(team, "docs", 2, 3);
    team = completeTerminalTeamNode(team, "docs", "done", 4);

    expect(nextTerminalTeamDispatch(team)).toEqual([]);
    expect(terminalTeamState(team)).toBe("failed");
  });
});

describe("startTerminalTeamNode", () => {
  it("refuses to put two nodes in one pane", () => {
    let team = createTerminalTeam("team-1", plan(), assignments, 0);
    team = startTerminalTeamNode(team, "tokens", 1, 1);
    expect(() => startTerminalTeamNode(team, "docs", 1, 2)).toThrow(/pane is already busy/);
  });

  it("refuses to start the same node twice", () => {
    let team = createTerminalTeam("team-1", plan(), assignments, 0);
    team = startTerminalTeamNode(team, "tokens", 1, 1);
    expect(() => startTerminalTeamNode(team, "tokens", 2, 2)).toThrow(/already running/);
  });

  it("frees the pane again on completion", () => {
    let team = createTerminalTeam("team-1", plan(), assignments, 0);
    team = startTerminalTeamNode(team, "tokens", 1, 1);
    team = completeTerminalTeamNode(team, "tokens", "done", 2);
    expect(team.running).toEqual([]);
    expect(() => startTerminalTeamNode(team, "docs", 1, 3)).not.toThrow();
  });
});

describe("terminalTeamPrompt", () => {
  /* The real path: a node's brief is built from the team's own record of what finished. */
  const context = () => {
    let team = createTerminalTeam("team-1", plan(), assignments, 0);
    team = startTerminalTeamNode(team, "tokens", 1, 1);
    team = completeTerminalTeamNode(team, "tokens", "Added a dark palette", 2);
    return terminalTeamNodeContext(team, "wire");
  };

  it("names the role, the piece, and the finished work it builds on", () => {
    const prompt = terminalTeamPrompt(context());
    expect(prompt).toContain("You are the Styles");
    expect(prompt).toContain("Add a dark mode");
    expect(prompt).toContain("Wire the toggle");
    expect(prompt).toContain("tokens: Added a dark palette");
  });

  it("carries the node's own file hints", () => {
    let team = createTerminalTeam("team-1", plan(), assignments, 0);
    expect(terminalTeamPrompt(terminalTeamNodeContext(team, "tokens"))).toContain(
      "Start by looking at: src/theme.css",
    );
    team = startTerminalTeamNode(team, "tokens", 1, 1);
    expect(team.running).toHaveLength(1);
  });

  /*
   * A pty gives us text and nothing else. Claiming a changed-file list we never saw would
   * put a confident falsehood into the next agent's prompt, so a terminal handoff carries
   * the CLI's last words and leaves every structured field empty.
   */
  it("does not invent structured fields the pty never provided", () => {
    let team = createTerminalTeam("team-1", plan(), assignments, 0);
    team = startTerminalTeamNode(team, "tokens", 1, 1);
    team = completeTerminalTeamNode(team, "tokens", "Added a dark palette", 2);

    const handoff = team.handoffs.find((candidate) => candidate.nodeId === "tokens");
    expect(handoff?.summary).toBe("Added a dark palette");
    expect(handoff?.changedPaths).toEqual([]);
    expect(handoff?.tests).toEqual([]);
    expect(handoff?.findings).toEqual([]);
  });

  it("says so when a CLI finished without a word", () => {
    let team = createTerminalTeam("team-1", plan(), assignments, 0);
    team = startTerminalTeamNode(team, "tokens", 1, 1);
    team = completeTerminalTeamNode(team, "tokens", "   ", 2);
    expect(terminalTeamPrompt(terminalTeamNodeContext(team, "wire"))).toContain(
      "Finished without saying anything further.",
    );
  });

  /* Without this line the pane has no signal but silence, and silence is ambiguous. */
  it("asks for the completion marker, carrying the node id", () => {
    expect(terminalTeamPrompt(context())).toContain(`${TERMINAL_TEAM_DONE} wire`);
  });

  it("tells the agent to stay inside its piece", () => {
    expect(terminalTeamPrompt(context())).toContain("Do not work on anything outside your piece");
  });
});

describe("createTerminalTeamWatcher", () => {
  it("reads the marker when an agent prints it on its own line", () => {
    const watcher = createTerminalTeamWatcher();
    expect(watcher.push(`${TERMINAL_TEAM_DONE} wire\n`)).toBe("wire");
  });

  /*
   * The brief contains the marker, in the sentence asking for it, and a pty echoes back
   * what was typed into it. Matching the marker mid-line would complete every node the
   * instant it was dispatched - so the line has to be nothing but the marker.
   */
  it("ignores the marker inside the sentence that asks for it", () => {
    const watcher = createTerminalTeamWatcher();
    const asked = terminalTeamPrompt(
      terminalTeamNodeContext(createTerminalTeam("team-1", plan(), assignments, 0), "tokens"),
    );
    expect(watcher.push(`${asked}\n`)).toBeNull();
  });

  it("ignores a marker an agent mentions in passing", () => {
    const watcher = createTerminalTeamWatcher();
    expect(watcher.push(`I will print ${TERMINAL_TEAM_DONE} tokens when done\n`)).toBeNull();
  });

  it("reads a marker split across two reads", () => {
    const watcher = createTerminalTeamWatcher();
    expect(watcher.push(`${TERMINAL_TEAM_DONE} to`)).toBeNull();
    expect(watcher.push("kens\n")).toBe("tokens");
  });

  it("reads a marker wrapped in colour codes", () => {
    const watcher = createTerminalTeamWatcher();
    expect(watcher.push(`\u001b[32m${TERMINAL_TEAM_DONE} docs\u001b[0m\n`)).toBe("docs");
  });

  it("reads a marker indented by a CLI that pads its output", () => {
    const watcher = createTerminalTeamWatcher();
    expect(watcher.push(`   ${TERMINAL_TEAM_DONE} docs  \n`)).toBe("docs");
  });

  it("stays silent on ordinary output", () => {
    const watcher = createTerminalTeamWatcher();
    expect(watcher.push("Reading src/theme.css\nWriting src/theme.css\n")).toBeNull();
  });

  it("drops a half-read line when reset", () => {
    const watcher = createTerminalTeamWatcher();
    watcher.push(`${TERMINAL_TEAM_DONE} to`);
    watcher.reset();
    expect(watcher.push("kens\n")).toBeNull();
  });
});

describe("terminalTeamNodeIsQuiet", () => {
  /* A CLI that has printed nothing at all has not started, which is not the same as done. */
  it("is never quiet before the first output", () => {
    expect(terminalTeamNodeIsQuiet(null, 10 * 60_000)).toBe(false);
  });

  it("is not quiet while an agent is merely thinking", () => {
    expect(terminalTeamNodeIsQuiet(0, 90_000)).toBe(false);
  });

  it("is quiet once the gap passes the threshold", () => {
    expect(terminalTeamNodeIsQuiet(0, 5 * 60_000)).toBe(true);
  });
});

describe("buildTerminalTeamPlan", () => {
  it("gives the first CLI the build and makes the rest wait for it", () => {
    const { plan, assignments } = buildTerminalTeamPlan("tt-1", "Add a dark mode", [
      "grok",
      "kimi",
      "codex",
    ]);

    expect(assignments).toEqual([
      { roleId: "build", agentId: "grok" },
      { roleId: "check", agentId: "kimi" },
      { roleId: "document", agentId: "codex" },
    ]);
    expect(plan.nodes.find((node) => node.id === "build")?.dependsOn).toEqual([]);
    expect(plan.nodes.find((node) => node.id === "check")?.dependsOn).toEqual(["build"]);
    expect(plan.nodes.find((node) => node.id === "document")?.dependsOn).toEqual(["build"]);
    expect(plan.prompt).toBe("Add a dark mode");
  });

  /* Review normally waits for tests; with no tester on the team there is nothing to wait for. */
  it("drops a dependency on a role the team does not have", () => {
    const two = buildTerminalTeamPlan("tt-1", "Add a dark mode", ["grok", "kimi"]);
    expect(two.plan.nodes.map((node) => node.id)).toEqual(["build", "check"]);

    const four = buildTerminalTeamPlan("tt-2", "Add a dark mode", ["grok", "kimi", "codex", "claude"]);
    expect(four.plan.nodes.find((node) => node.id === "review")?.dependsOn).toEqual([
      "build",
      "check",
    ]);
  });

  it("produces a plan the runner will accept", () => {
    const { plan, assignments } = buildTerminalTeamPlan("tt-1", "Add a dark mode", ["grok", "kimi"]);
    const team = createTerminalTeam("tt-1", plan, assignments, 0);
    expect(nextTerminalTeamDispatch(team)).toEqual([
      { nodeId: "build", roleId: "build", agentId: "grok" },
    ]);
  });

  /*
   * Two roles pointing at one CLI would brief it twice, in two panes, on overlapping work -
   * the exact thing this feature exists to avoid.
   */
  it("refuses to give one CLI two roles", () => {
    expect(() => buildTerminalTeamPlan("tt-1", "Add a dark mode", ["grok", "grok"])).toThrow(
      /only one role/,
    );
  });

  it("refuses a team too small to be a team, or larger than the plan allows", () => {
    expect(() => buildTerminalTeamPlan("tt-1", "Add a dark mode", ["grok"])).toThrow(/at least two/);
    expect(() =>
      buildTerminalTeamPlan("tt-1", "Add a dark mode", ["grok", "kimi", "codex", "claude", "qwen"]),
    ).toThrow(/at most 4/);
  });

  it("refuses an empty task", () => {
    expect(() => buildTerminalTeamPlan("tt-1", "   ", ["grok", "kimi"])).toThrow(/needs a task/);
  });
});

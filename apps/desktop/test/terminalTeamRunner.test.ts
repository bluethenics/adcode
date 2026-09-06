import { describe, expect, it } from "vitest";
import { TERMINAL_TEAM_DONE, createTeamPlan, type TeamPlan } from "@adcode/ai";
import {
  createTerminalTeamRunner,
  type TerminalTeamPort,
} from "../src/renderer/terminal/terminalTeamRunner.ts";

/** `tokens` and `docs` are independent; `wire` waits for `tokens`. */
function plan(concurrency = 2): TeamPlan {
  return createTeamPlan({
    id: "dark-mode",
    prompt: "Add a dark mode",
    acceptanceCriteria: ["The theme survives a restart"],
    roles: [
      { id: "styles", label: "Styles", objective: "Own the CSS" },
      { id: "docs", label: "Docs", objective: "Own the docs" },
    ],
    nodes: [
      {
        id: "tokens",
        title: "Define the tokens",
        objective: "Add a dark palette",
        roleId: "styles",
        dependsOn: [],
        acceptanceCriteria: ["Every token has a dark value"],
        fileHints: [],
      },
      {
        id: "wire",
        title: "Wire the toggle",
        objective: "Switch the palette",
        roleId: "styles",
        dependsOn: ["tokens"],
        acceptanceCriteria: ["The toggle flips it"],
        fileHints: [],
      },
      {
        id: "docs",
        title: "Document it",
        objective: "Write the page",
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

interface Harness {
  readonly port: TerminalTeamPort;
  readonly sent: { paneId: number; text: string }[];
  readonly labels: { paneId: number; title: string }[];
  readonly notices: string[];
  readonly opened: string[];
  clock: number;
  failNextOpen: string | null;
}

function harness(): Harness {
  const state: Harness = {
    sent: [],
    labels: [],
    notices: [],
    opened: [],
    clock: 1_000,
    failNextOpen: null,
    port: {
      async openPane(roleLabel) {
        if (state.failNextOpen !== null) {
          const message = state.failNextOpen;
          state.failNextOpen = null;
          throw new Error(message);
        }
        state.opened.push(roleLabel);
        return state.opened.length;
      },
      send: (paneId, text) => void state.sent.push({ paneId, text }),
      label: (paneId, title) => void state.labels.push({ paneId, title }),
      notify: (message) => void state.notices.push(message),
      now: () => state.clock,
    },
  };
  return state;
}

/** Output the pane echoes back, then produces, when an agent finishes a node. */
function finishes(nodeId: string): string {
  return `wrote some files\n${TERMINAL_TEAM_DONE} ${nodeId}\n`;
}

describe("createTerminalTeamRunner", () => {
  it("opens a pane per ready node and types the CLI before the brief", async () => {
    const h = harness();
    const runner = createTerminalTeamRunner(h.port);
    await runner.start(plan(), assignments);

    expect(h.opened).toEqual(["Docs", "Styles"]);
    expect(h.sent.map((s) => s.text)).toEqual([
      "kimi",
      expect.stringContaining("You are the Docs"),
      "grok",
      expect.stringContaining("You are the Styles"),
    ]);
    expect(h.labels).toEqual([
      { paneId: 1, title: "Docs · Document it" },
      { paneId: 2, title: "Styles · Define the tokens" },
    ]);
  });

  it("advances to the dependent node when a pane reports its marker", async () => {
    const h = harness();
    const runner = createTerminalTeamRunner(h.port);
    await runner.start(plan(), assignments);
    h.sent.length = 0;

    // Pane 2 holds `tokens`; the prompt's own echo of the marker must not count.
    runner.observe(2, "print exactly ADCODE-TEAM-DONE tokens\n");
    expect(h.sent).toEqual([]);

    runner.observe(2, finishes("tokens"));
    await Promise.resolve();
    await Promise.resolve();

    expect(h.sent.map((s) => s.text)).toEqual([
      "grok",
      expect.stringContaining("You are the Styles"),
    ]);
    // The brief for `wire` carries what `tokens` last said.
    expect(h.sent[1]?.text).toContain("wrote some files");
  });

  /* A marker for somebody else's node must never complete this pane's work. */
  it("ignores a marker naming a node the pane was not given", async () => {
    const h = harness();
    const runner = createTerminalTeamRunner(h.port);
    await runner.start(plan(), assignments);
    h.sent.length = 0;

    runner.observe(2, finishes("tokens"));
    runner.observe(1, finishes("tokens"));
    await Promise.resolve();

    expect(h.notices).not.toContain("Every Team task finished.");
    expect(runner.status()?.nodes.find((n) => n.nodeId === "docs")?.state).toBe("running");
  });

  it("fails a node whose terminal is closed under it", async () => {
    const h = harness();
    const runner = createTerminalTeamRunner(h.port);
    await runner.start(plan(), assignments);

    runner.paneClosed(2);
    await Promise.resolve();

    const status = runner.status();
    expect(status?.nodes.find((n) => n.nodeId === "tokens")?.state).toBe("failed");
    expect(status?.nodes.find((n) => n.nodeId === "wire")?.state).toBe("blocked");
    expect(h.notices).toContain("tokens stopped because its terminal was closed.");
  });

  /* A CLI that did the work and never printed the marker still has to release its pane. */
  it("treats a long-quiet pane as finished, and says it assumed so", async () => {
    const h = harness();
    const runner = createTerminalTeamRunner(h.port);
    await runner.start(plan(), assignments);

    runner.observe(2, "thinking hard\n");
    h.clock += 6 * 60_000;
    runner.sweep();
    await Promise.resolve();
    await Promise.resolve();

    expect(h.notices).toContain("tokens went quiet, so ADCode is treating it as finished.");
    expect(runner.status()?.nodes.find((n) => n.nodeId === "tokens")?.state).toBe("completed");
  });

  it("does not sweep a pane that is merely thinking", async () => {
    const h = harness();
    const runner = createTerminalTeamRunner(h.port);
    await runner.start(plan(), assignments);

    runner.observe(2, "thinking hard\n");
    h.clock += 90_000;
    runner.sweep();

    expect(h.notices).toEqual([]);
    expect(runner.status()?.nodes.find((n) => n.nodeId === "tokens")?.state).toBe("running");
  });

  /* One pane failing to open must not strand the roles that could have run. */
  it("fails only the node whose pane could not open", async () => {
    const h = harness();
    h.failNextOpen = "That terminal is already split four ways.";
    const runner = createTerminalTeamRunner(h.port);
    await runner.start(plan(), assignments);

    const status = runner.status();
    expect(status?.nodes.find((n) => n.nodeId === "docs")?.state).toBe("failed");
    expect(status?.nodes.find((n) => n.nodeId === "tokens")?.state).toBe("running");
  });

  it("respects the plan's concurrency", async () => {
    const h = harness();
    const runner = createTerminalTeamRunner(h.port);
    await runner.start(plan(1), assignments);

    expect(h.opened).toEqual(["Docs"]);
  });

  it("announces completion once every node is done", async () => {
    const h = harness();
    const runner = createTerminalTeamRunner(h.port);
    await runner.start(plan(), assignments);

    runner.observe(1, finishes("docs"));
    runner.observe(2, finishes("tokens"));
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    runner.observe(3, finishes("wire"));
    for (let i = 0; i < 6; i += 1) await Promise.resolve();

    expect(runner.status()?.state).toBe("completed");
    expect(h.notices).toContain("Every Team task finished.");
  });

  it("refuses a second team while one is running, and allows one after stop", async () => {
    const h = harness();
    const runner = createTerminalTeamRunner(h.port);
    await runner.start(plan(), assignments);

    await expect(runner.start(plan(), assignments)).rejects.toThrow(/already running/);

    runner.stop();
    expect(runner.isRunning()).toBe(false);
    expect(runner.status()).toBeNull();
    expect(h.notices).toContain("The Team was stopped. Its terminals are still open.");
    await expect(runner.start(plan(), assignments)).resolves.toBeUndefined();
  });

  it("stops advancing once stopped", async () => {
    const h = harness();
    const runner = createTerminalTeamRunner(h.port);
    await runner.start(plan(), assignments);
    runner.stop();
    h.sent.length = 0;

    runner.observe(2, finishes("tokens"));
    await Promise.resolve();

    expect(h.sent).toEqual([]);
  });

  it("tells listeners when the team moves", async () => {
    const h = harness();
    const runner = createTerminalTeamRunner(h.port);
    let changes = 0;
    const off = runner.onChanged(() => (changes += 1));

    await runner.start(plan(), assignments);
    expect(changes).toBeGreaterThan(0);

    off();
    const settled = changes;
    runner.observe(2, finishes("tokens"));
    await Promise.resolve();
    expect(changes).toBe(settled);
  });
});

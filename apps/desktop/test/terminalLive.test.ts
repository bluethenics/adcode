import { describe, expect, it } from "vitest";
import { createTerminalLiveBridge } from "../src/renderer/liveAgents/terminalLive.ts";
import type { LiveHubMessage } from "../src/renderer/liveAgents/liveHub.ts";

function harness() {
  const published: LiveHubMessage[] = [];
  const timers: (() => void)[] = [];
  const bridge = createTerminalLiveBridge({ publish: (message) => published.push(message), later: (callback) => void timers.push(callback) });
  return { published, timers, bridge };
}

describe("Team in the terminal, as the live room hears it", () => {
  it("starts an agent named after its CLI, and streams its pane as output", () => {
    const { published, bridge } = harness();
    bridge({ kind: "start", teamId: "tt1", nodeId: "build", roleId: "build", roleLabel: "Build", agentId: "claude" });
    bridge({ kind: "output", teamId: "tt1", nodeId: "build", text: "Editing a.ts" });
    expect(published).toEqual([
      { kind: "event", identity: { id: "terminal/tt1/build", label: "Build", role: "build", model: "Claude Code", lookKey: "cli-claude", group: "tt1" }, event: { kind: "start" } },
      { kind: "event", identity: expect.objectContaining({ id: "terminal/tt1/build" }), event: { kind: "output", command: "Claude Code", text: "Editing a.ts" } },
    ]);
  });

  it("holds a handoff until the node it goes to has started", () => {
    const { published, bridge } = harness();
    bridge({ kind: "start", teamId: "tt1", nodeId: "build", roleId: "build", roleLabel: "Build", agentId: "claude" });
    bridge({ kind: "end", teamId: "tt1", nodeId: "build", ok: true });
    bridge({ kind: "handoff", teamId: "tt1", from: "build", to: ["check"], summary: "API done" });
    expect(published.some((message) => message.kind === "signal")).toBe(false);
    bridge({ kind: "start", teamId: "tt1", nodeId: "check", roleId: "check", roleLabel: "Tests", agentId: "codex" });
    const kinds = published.map((message) => (message.kind === "event" ? `${message.identity.id}:${message.event.kind}` : message.kind));
    expect(kinds.slice(-2)).toEqual(["terminal/tt1/check:start", "signal"]);
    expect(published.at(-1)).toMatchObject({ kind: "signal", signal: { kind: "handoff", from: "terminal/tt1/build", to: ["terminal/tt1/check"], text: "API done" } });
  });

  it("sends a held handoff anyway when its node never starts, and only once", () => {
    const { published, timers, bridge } = harness();
    bridge({ kind: "handoff", teamId: "tt1", from: "build", to: ["check"], summary: "API done" });
    timers.forEach((fire) => fire());
    bridge({ kind: "start", teamId: "tt1", nodeId: "check", roleId: "check", roleLabel: "Tests", agentId: "codex" });
    expect(published.filter((message) => message.kind === "signal")).toHaveLength(1);
  });

  it("ignores output from a pane it never saw start", () => {
    const { published, bridge } = harness();
    bridge({ kind: "output", teamId: "tt1", nodeId: "ghost", text: "x" });
    expect(published).toEqual([]);
  });
});

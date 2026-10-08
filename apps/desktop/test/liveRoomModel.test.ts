import { describe, expect, it } from "vitest";
import {
  addLiveSignal,
  applyLiveEvent,
  emptyLiveRoom,
  pruneLiveRoom,
  takeLiveSignals,
  type LiveAgentIdentity,
  type LiveRoomState,
} from "../src/renderer/liveAgents/liveRoomModel.ts";
import { createTypingPace } from "../src/renderer/liveAgents/typingPace.ts";
import { tintLine } from "../src/renderer/liveAgents/codeTint.ts";
import type { LiveEventView } from "../src/shared/liveAgents.ts";

const who = (role: string, group = "t1"): LiveAgentIdentity => ({ id: `${group}/${role}`, label: role.toUpperCase(), role, model: "m", lookKey: role, group });
const build = who("build");
const check = who("check");
const docs = who("docs");

function play(events: readonly [LiveAgentIdentity, LiveEventView][], start: LiveRoomState = emptyLiveRoom()): LiveRoomState {
  return events.reduce((state, [agent, event], index) => applyLiveEvent(state, agent, event, 1_000 + index), start);
}
const agentOf = (state: LiveRoomState, identity: LiveAgentIdentity) => state.agents.find((agent) => agent.id === identity.id)!;
const call = (id: string, name: string, extra: Partial<Extract<LiveEventView, { kind: "tool-call" }>> = {}): LiveEventView => ({ kind: "tool-call", id, name, path: null, command: null, added: 0, removed: 0, preview: "", ...extra });

describe("a live agent's window", () => {
  it("types code in from drafts and settles when the write finishes", () => {
    let state = play([
      [build, { kind: "start" }],
      [build, { kind: "tool-draft", id: "c1", name: "propose_edit", path: null, edit: 0, append: "const a" }],
      [build, { kind: "tool-draft", id: "c1", name: "propose_edit", path: "src/a.ts", edit: 0, append: " = 1;" }],
    ]);
    expect(agentOf(state, build).activity).toEqual({ kind: "code", toolId: "c1", path: "src/a.ts", text: "const a = 1;", edit: 0, final: false });
    expect(agentOf(state, build).step).toBe("Writing src/a.ts");
    state = play([
      [build, call("c1", "propose_edit", { path: "src/a.ts", added: 1, preview: "const a = 1;" })],
      [build, { kind: "tool-result", id: "c1", name: "propose_edit", ok: true, output: "written" }],
    ], state);
    expect(agentOf(state, build).activity).toMatchObject({ kind: "code", final: true, text: "const a = 1;" });
    expect(agentOf(state, build).files).toEqual([{ path: "src/a.ts", added: 1, removed: 0 }]);
  });

  it("shows a call's preview when no draft of it ever arrived", () => {
    const state = play([[build, call("c9", "propose_edit", { path: "b.ts", added: 2, preview: "x\ny" })]]);
    expect(agentOf(state, build).activity).toMatchObject({ kind: "code", toolId: "c9", path: "b.ts", text: "x\ny" });
  });

  it("separates the replacements of one edit", () => {
    const state = play([
      [build, { kind: "tool-draft", id: "c1", name: "edit_file", path: "a.ts", edit: 0, append: "one" }],
      [build, { kind: "tool-draft", id: "c1", name: "edit_file", path: "a.ts", edit: 1, append: "two" }],
    ]);
    expect(agentOf(state, build).activity).toMatchObject({ text: "one\n⋯\ntwo", edit: 1 });
  });

  it("adds up several edits of the same file", () => {
    const state = play([
      [build, call("c1", "edit_file", { path: "a.ts", added: 2, removed: 1 })],
      [build, call("c2", "edit_file", { path: "a.ts", added: 3, removed: 0 })],
      [build, call("c3", "propose_edit", { path: "b.ts", added: 4 })],
    ]);
    expect(agentOf(state, build).files).toEqual([{ path: "a.ts", added: 5, removed: 1 }, { path: "b.ts", added: 4, removed: 0 }]);
  });

  it("shows a command and its output, and counts a check toward proof", () => {
    let state = play([[build, call("r1", "run_command", { command: "npm test" })]]);
    expect(agentOf(state, build).activity).toEqual({ kind: "command", toolId: "r1", command: "npm test", output: "", final: false });
    expect(agentOf(state, build).step).toBe("Running npm test");
    expect(agentOf(state, build).proof).toBe("unverified");
    state = play([[build, { kind: "tool-result", id: "r1", name: "run_command", ok: false, output: "1 failed" }]], state);
    expect(agentOf(state, build).activity).toMatchObject({ output: "1 failed", final: true });
    expect(agentOf(state, build).proof).toBe("failed");
    state = play([
      [build, call("r2", "run_command", { command: "npm test" })],
      [build, { kind: "tool-result", id: "r2", name: "run_command", ok: true, output: "all passed" }],
    ], state);
    expect(agentOf(state, build).proof).toBe("passed");
  });

  it("does not count a command that is not a check", () => {
    const state = play([
      [build, call("r1", "run_command", { command: "ls" })],
      [build, { kind: "tool-result", id: "r1", name: "run_command", ok: true, output: "a b" }],
    ]);
    expect(agentOf(state, build).proof).toBe("unverified");
  });

  it("keeps the plan and names what the agent is reading", () => {
    const state = play([
      [build, { kind: "plan", steps: [{ step: "Add API", status: "in_progress" }] }],
      [build, call("f1", "read_file", { path: "src/api.ts" })],
    ]);
    expect(agentOf(state, build).plan).toEqual([{ step: "Add API", status: "in_progress" }]);
    expect(agentOf(state, build).step).toBe("Reading src/api.ts");
  });

  it("ends done or failed", () => {
    const state = play([[build, { kind: "start" }], [check, { kind: "start" }], [build, { kind: "end", ok: true }], [check, { kind: "end", ok: false }]]);
    expect(agentOf(state, build)).toMatchObject({ status: "done", endedAt: expect.any(Number) });
    expect(agentOf(state, check).status).toBe("failed");
  });

  it("starts fresh when a finished agent starts again", () => {
    const state = play([[build, call("c1", "propose_edit", { path: "a.ts", added: 1 })], [build, { kind: "end", ok: true }], [build, { kind: "start" }]]);
    expect(agentOf(state, build)).toMatchObject({ status: "working", files: [], endedAt: null });
  });

  it("bounds a huge file to its last 60,000 characters", () => {
    const state = play([[build, { kind: "tool-draft", id: "c1", name: "propose_edit", path: "big.ts", edit: 0, append: `${"x".repeat(70_000)}END` }]]);
    const activity = agentOf(state, build).activity;
    expect(activity.kind === "code" && activity.text.length === 60_000 && activity.text.endsWith("END")).toBe(true);
  });
});

describe("signals between agents", () => {
  const team = play([[build, { kind: "start" }], [check, { kind: "start" }], [docs, { kind: "start" }], [who("build", "other"), { kind: "start" }]]);

  it("sends a direct message from one agent to the agent holding that role", () => {
    const [, signals] = takeLiveSignals(play([[build, { kind: "message", to: "check", text: "API done" }]], team));
    expect(signals).toMatchObject([{ kind: "message", from: build.id, to: [check.id], text: "API done" }]);
  });

  it("sends 'all' to every other agent on the same team only", () => {
    const [, signals] = takeLiveSignals(play([[build, { kind: "message", to: "all", text: "renamed" }]], team));
    expect(signals[0]?.to).toEqual([check.id, docs.id]);
  });

  it("turns an overlap into a signal between the two agents", () => {
    const [, signals] = takeLiveSignals(play([[check, { kind: "overlap", withRole: "build", path: "src/a.ts" }]], team));
    expect(signals).toMatchObject([{ kind: "overlap", from: check.id, to: [build.id], text: "src/a.ts" }]);
  });

  it("queues signals until taken, and keeps a short log", () => {
    let state = addLiveSignal(team, { kind: "handoff", from: build.id, to: [check.id, docs.id], text: "Build finished", at: 5 });
    const [drained, signals] = takeLiveSignals(state);
    expect(signals).toHaveLength(1);
    expect(takeLiveSignals(drained)[1]).toEqual([]);
    for (let index = 0; index < 30; index += 1) state = addLiveSignal(state, { kind: "message", from: build.id, to: [check.id], text: String(index), at: index });
    expect(state.log).toHaveLength(20);
    expect(state.log.at(-1)?.text).toBe("29");
  });
});

describe("pruneLiveRoom", () => {
  it("drops agents that finished long enough ago, keeps working ones", () => {
    const state = play([[build, { kind: "start" }], [check, { kind: "start" }], [build, { kind: "end", ok: true }]]);
    expect(pruneLiveRoom(state, 1_000 + 2 + 5_000, 10_000).agents).toHaveLength(2);
    expect(pruneLiveRoom(state, 1_000 + 2 + 20_000, 10_000).agents.map((agent) => agent.id)).toEqual([check.id]);
  });
});

describe("createTypingPace", () => {
  it("never reveals more than is waiting, and nothing when caught up", () => {
    const pace = createTypingPace();
    expect(pace.next(10, 10, 16)).toBe(0);
    expect(pace.next(9, 10, 1_000)).toBe(1);
  });
  it("types at least one character a frame", () => {
    expect(createTypingPace().next(0, 100, 1)).toBeGreaterThanOrEqual(1);
  });
  function framesToClear(pace: ReturnType<typeof createTypingPace>, from: number, target: number): number {
    let shown = from;
    let elapsed = 0;
    while (shown < target && elapsed < 10_000) {
      shown += pace.next(shown, target, 16);
      elapsed += 16;
    }
    return elapsed;
  }
  it("catches up a big burst in about a second", () => {
    expect(framesToClear(createTypingPace(), 0, 6_000)).toBeLessThanOrEqual(1_100);
  });
  it("types a small amount steadily rather than all at once", () => {
    expect(framesToClear(createTypingPace(), 0, 30)).toBeGreaterThanOrEqual(200);
  });
  it("speeds up when more arrives while it is still typing", () => {
    const pace = createTypingPace();
    let shown = 0;
    for (let frame = 0; frame < 10; frame += 1) shown += pace.next(shown, 200, 16);
    expect(framesToClear(pace, shown, 8_000)).toBeLessThanOrEqual(1_100);
  });
});

describe("tintLine", () => {
  it("colours keywords, strings, comments and numbers, and keeps every character", () => {
    const line = 'const a = "hi" + 42; // note';
    const tokens = tintLine(line);
    expect(tokens.map((token) => token.text).join("")).toBe(line);
    expect(tokens.find((token) => token.text === "const")?.tone).toBe("keyword");
    expect(tokens.find((token) => token.text === '"hi"')?.tone).toBe("string");
    expect(tokens.find((token) => token.text === "42")?.tone).toBe("number");
    expect(tokens.at(-1)).toEqual({ text: "// note", tone: "comment" });
  });
  it("does not colour a keyword inside a longer name", () => {
    expect(tintLine("constant").every((token) => token.tone === "plain")).toBe(true);
  });
});

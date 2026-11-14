import { describe, expect, it } from "vitest";
import { createAgent, type Agent } from "../src/agent.ts";
import { DELEGATE_TASK, describeCall, parseDelegation, subagentBrief, subagentTools, withSubagents, type SubagentTask } from "../src/subagents.ts";
import { BUILT_IN_TOOLS, EDIT_FILE, READ_FILE } from "../src/tools.ts";
import type { AgentEvent, Provider, ProviderEvent, ToolCallBlock } from "../src/types.ts";

const call = (input: Record<string, unknown>): ToolCallBlock => ({ type: "tool-call", id: "d1", name: "delegate_task", input });

/** A helper that "works" for a moment, then reports; it notes when it ran and if it was stopped. */
function fakeHelper(task: SubagentTask, log: string[], events: AgentEvent[]): Agent {
  let cancelled = false;
  return {
    async *send(prompt: string) {
      log.push(`start ${task.title}`);
      expect(prompt).toContain(`Task: ${task.title}`);
      for (const event of events) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        if (cancelled) { yield { kind: "cancelled" } as AgentEvent; return; }
        yield event;
      }
      log.push(`end ${task.title}`);
    },
    cancel() { cancelled = true; },
    history: () => [],
    reset() {},
    compact: async () => ({ ok: false, reason: "nothing" }) as never,
    contextUsage: () => null,
  };
}

describe("sub-agents", () => {
  it("reads one to four tasks, defaulting to explore", () => {
    expect(parseDelegation({ tasks: [{ title: "Map auth", instructions: "Find the login flow" }] })).toEqual([{ title: "Map auth", instructions: "Find the login flow", mode: "explore" }]);
    expect(parseDelegation({ tasks: [] })).toMatch(/one to four/);
    expect(parseDelegation({ tasks: Array.from({ length: 5 }, () => ({ title: "x", instructions: "y" })) })).toMatch(/At most 4/);
    expect(parseDelegation({ tasks: [{ title: "x", instructions: "" }] })).toMatch(/needs a title and instructions/);
    expect(parseDelegation({ tasks: [{ title: "x", instructions: "y", mode: "admin" }] })).toMatch(/explore or build/);
  });

  it("gives explore helpers reads only, build helpers everything but delegation and questions", () => {
    const all = [...BUILT_IN_TOOLS, DELEGATE_TASK];
    const explore = subagentTools(all, "explore");
    expect(explore.some((tool) => tool.mutating)).toBe(false);
    expect(explore).toContain(READ_FILE);
    const build = subagentTools(all, "build");
    expect(build).toContain(EDIT_FILE);
    expect(build.some((tool) => tool.name === "delegate_task")).toBe(false);
    // Nobody is watching a helper's run, so a question would hang: only the parent asks.
    expect(build.some((tool) => tool.name === "ask_user")).toBe(false);
    expect(explore.some((tool) => tool.name === "ask_user")).toBe(false);
    expect(subagentBrief({ title: "Tests", instructions: "Write tests for cart.ts", mode: "build" })).toContain("You can change files");
  });

  it("runs helpers at the same time and folds their closing reports into one result", async () => {
    const log: string[] = [];
    const statuses: string[] = [];
    const runner = withSubagents({ run: async () => ({ content: "base", isError: false }) }, {
      tools: () => [READ_FILE, EDIT_FILE, DELEGATE_TASK],
      status: (text) => statuses.push(text),
      start: (task, tools) => {
        expect(tools.map((tool) => tool.name)).toEqual(task.mode === "build" ? ["read_file", "edit_file"] : ["read_file"]);
        return fakeHelper(task, log, [
          { kind: "text", text: "Let me look." },
          { kind: "tool-call", call: { type: "tool-call", id: "r", name: "read_file", input: { path: `src/${task.title}.ts` } } },
          { kind: "text", text: `Report for ${task.title}.` },
        ]);
      },
    });
    const result = await runner.run(call({ tasks: [{ title: "auth", instructions: "map it" }, { title: "cart", instructions: "fix it", mode: "build" }] }), new AbortController().signal);
    // Both started before either finished.
    expect(log.slice(0, 2)).toEqual(["start auth", "start cart"]);
    expect(result.isError).toBe(false);
    expect(result.content).toContain("2 of 2 sub-agents finished.");
    expect(result.content).toContain("## 1. auth (explore) - done, 1 tool call\nReport for auth.");
    expect(result.content).toContain("## 2. cart (build) - done, 1 tool call\nReport for cart.");
    expect(result.content).not.toContain("Let me look.");
    expect(statuses).toContain("Helper 2 of 2 · cart: reading src/cart.ts");
    // Every other tool goes to the runner underneath.
    expect(await runner.run({ type: "tool-call", id: "x", name: "read_file", input: {} }, new AbortController().signal)).toEqual({ content: "base", isError: false });
  });

  it("stops every helper when the parent is stopped, and refuses bad calls without starting any", async () => {
    const log: string[] = [];
    let started = 0;
    const runner = withSubagents({ run: async () => ({ content: "", isError: false }) }, {
      tools: () => [READ_FILE],
      start: (task) => { started += 1; return fakeHelper(task, log, Array.from({ length: 50 }, () => ({ kind: "text", text: "." }) as AgentEvent)); },
    });
    const stop = new AbortController();
    const running = runner.run(call({ tasks: [{ title: "a", instructions: "x" }, { title: "b", instructions: "y" }] }), stop.signal);
    setTimeout(() => stop.abort(), 20);
    const result = await running;
    expect(result.content).toContain("0 of 2 sub-agents finished.");
    expect(result.content).toContain("- stopped");
    expect(log).not.toContain("end a");
    expect(await runner.run(call({ tasks: "everything" }), new AbortController().signal)).toMatchObject({ isError: true });
    expect(started).toBe(2);
  });

  it("works inside a real agent loop: the parent delegates, then answers with the helpers' findings", async () => {
    const script = (events: ProviderEvent[][]): Provider => {
      let turn = 0;
      return { id: "fake", displayName: "Fake", models: ["m"], async *stream() { for (const event of events[Math.min(turn++, events.length - 1)]!) yield event; } } as unknown as Provider;
    };
    const parent = script([
      [{ kind: "tool-call", call: call({ tasks: [{ title: "find todo", instructions: "Find TODO comments" }] }) }, { kind: "stop", reason: "tool-use" } as ProviderEvent],
      [{ kind: "text", text: "The helper found 3 TODOs." }, { kind: "stop", reason: "end-turn" } as ProviderEvent],
    ]);
    const helperProvider = script([[{ kind: "text", text: "3 TODOs in src/a.ts." }, { kind: "stop", reason: "end-turn" } as ProviderEvent]]);
    const base = { run: async () => ({ content: "", isError: false }) };
    const agent = createAgent({ provider: parent, model: "m", tools: [READ_FILE, DELEGATE_TASK], runner: withSubagents(base, {
      tools: () => [READ_FILE, DELEGATE_TASK],
      start: (_task, tools) => createAgent({ provider: helperProvider, model: "m", tools, runner: base }),
    }) });
    const events: AgentEvent[] = [];
    for await (const event of agent.send("Count the TODOs")) events.push(event);
    const result = events.find((event) => event.kind === "tool-result");
    expect(result).toMatchObject({ name: "delegate_task", isError: false });
    expect((result as { content: string }).content).toContain("3 TODOs in src/a.ts.");
    expect(events).toContainEqual({ kind: "text", text: "The helper found 3 TODOs." });
  });

  it("runs a helper on the task agent it routes to, says where, and counts its tokens", async () => {
    expect(parseDelegation({ tasks: [{ title: "Tests", instructions: "Write tests", mode: "build", agent: "deepseek-coder" }] }))
      .toEqual([{ title: "Tests", instructions: "Write tests", mode: "build", agent: "deepseek-coder" }]);
    const briefs: string[] = [];
    const runner = withSubagents({ run: async () => ({ content: "", isError: false }) }, {
      tools: () => [READ_FILE, EDIT_FILE, DELEGATE_TASK, { name: "create_agent", description: "", inputSchema: {}, mutating: true }],
      start: (task, tools) => {
        // A helper never makes agents of its own.
        expect(tools.some((tool) => tool.name === "create_agent")).toBe(false);
        if (task.agent === "ghost") return "No saved agent called ghost.";
        const agent = fakeHelper(task, [], [{ kind: "usage", inputTokens: 12_300, outputTokens: 2_100, estimated: false } as AgentEvent, { kind: "text", text: "Done." }]);
        const send = agent.send.bind(agent);
        return Promise.resolve({ agent: { ...agent, send: (prompt: string) => { briefs.push(prompt); return send(prompt); } }, ranOn: "deepseek-chat as DeepSeek coder", instructions: "Small diffs only." });
      },
    });
    const result = await runner.run(call({ tasks: [{ title: "Tests", instructions: "Write tests", mode: "build", agent: "deepseek-coder" }, { title: "Lost", instructions: "x", agent: "ghost" }] }), new AbortController().signal);
    expect(result.content).toContain("## 1. Tests (build) - done, 0 tool calls · on deepseek-chat as DeepSeek coder, 12k in / 2.1k out tokens\nDone.");
    expect(result.content).toContain("## 2. Lost (explore) - failed: No saved agent called ghost., 0 tool calls");
    expect(briefs[0]).toContain("Your standing instructions: Small diffs only.");
    expect(subagentBrief({ title: "t", instructions: "i", mode: "explore" })).not.toContain("standing instructions");
  });

  it("describes a helper's step in a few words", () => {
    expect(describeCall({ type: "tool-call", id: "1", name: "run_command", input: { command: "npm test" } })).toBe("running npm test");
    expect(describeCall({ type: "tool-call", id: "1", name: "update_plan", input: {} })).toBe("update plan");
  });
});

/**
 * The chat makes an agent flow end to end: the tool call, the dialog answered, the setting the
 * Flow page draws from, and the flow the next turn of that chat runs with.
 */
import { describe, expect, it } from "vitest";
import type { ModelCandidate, ToolCallBlock, ToolRunner } from "@adcode/ai";
import { activeFlowFor, flowContext, flowTaskAgents, readFlows } from "@adcode/ai/agentFlow";
import { FLOWS_SETTING, withFlowTool } from "../src/main/flowTool.ts";

const candidates: ModelCandidate[] = [
  { providerId: "tagflow", providerName: "ADCode Free AI", modelId: "claude-fable-5-2", modelName: "Fable 5.2", usable: true },
  { providerId: "deepseek", providerName: "DeepSeek", modelId: "deepseek-chat", modelName: "DeepSeek V3", usable: true },
];
const call = (input: Record<string, unknown>): ToolCallBlock => ({ type: "tool-call", id: "c1", name: "manage_agent_flow", input });
const signal = new AbortController().signal;
const base: ToolRunner = { run: () => Promise.resolve({ content: "base", isError: false }) };

function harness(answer: boolean, options: { editWhileAsking?: boolean } = {}) {
  const values: Record<string, unknown> = { [FLOWS_SETTING]: "[]" };
  const asked: { title: string; body: string; confirmLabel: string }[] = [];
  const log: string[] = [];
  const runner = withFlowTool(base, {
    settings: () => values,
    writeSetting: (id, value) => { values[id] = value; return Promise.resolve(); },
    candidates: () => Promise.resolve(candidates),
    chatId: () => "chat-1",
    chats: () => Promise.resolve([{ id: "chat-1", title: "Checkout bug" }]),
    confirm: (ask) => {
      asked.push(ask);
      if (options.editWhileAsking === true) values[FLOWS_SETTING] = JSON.stringify([{ id: "drawn", name: "Drawn", agents: [{ id: "solo", name: "Solo" }] }]);
      return Promise.resolve(answer);
    },
    record: (line) => log.push(line),
  });
  return { runner, values, asked, log };
}

const make = {
  action: "create",
  name: "Plan, code, review",
  agents: [
    { name: "Planner", role: "planner", model: "fable" },
    { name: "Coder", role: "coder", model: "deepseek" },
    { name: "Reviewer", role: "reviewer", read_only: true },
  ],
  links: [{ from: "Planner", to: "Coder" }, { from: "Coder", to: "Reviewer", kind: "review" }],
  chats: ["this"],
};

describe("manage_agent_flow, end to end", () => {
  it("creates a working flow once the person confirms", async () => {
    const { runner, values, asked, log } = harness(true);
    const answer = await runner.run(call(make), signal);
    expect(answer.isError).toBe(false);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.title).toBe('Create the flow "Plan, code, review"?');
    expect(asked[0]!.confirmLabel).toBe("Create flow");
    const saved = readFlows(values[FLOWS_SETTING]);
    expect(saved).toHaveLength(1);
    // The next turn of this chat runs the flow: its agents take the work, on their own models.
    const flow = activeFlowFor(saved, "chat-1")!;
    expect(flow.name).toBe("Plan, code, review");
    expect(activeFlowFor(saved, "chat-2")).toBeNull();
    expect(flowTaskAgents(flow).map((agent) => `${agent.id}:${agent.model || "chat"}:${agent.toolAccess ?? "all"}`)).toEqual(["coder:deepseek-chat:all", "reviewer:chat:read-only"]);
    expect(flowContext(flow, "add a discount field to checkout")).toContain('delegate_task agent: "coder" (Coder) takes over');
    expect(log).toEqual(["Created agent flow plan-code-review (3 agents, on in this chat)"]);

    // And then changed, turned off, listed and deleted the same way.
    expect((await runner.run(call({ action: "off", flow: "Plan, code, review" }), signal)).isError).toBe(false);
    expect(readFlows(values[FLOWS_SETTING])[0]!.enabled).toBe(false);
    const listed = await runner.run(call({ action: "list" }), signal);
    expect(listed.content).toContain('"Plan, code, review" (id plan-code-review), off');
    expect(asked).toHaveLength(2);
    expect((await runner.run(call({ action: "delete", flow: "plan-code-review" }), signal)).isError).toBe(false);
    expect(readFlows(values[FLOWS_SETTING])).toEqual([]);
  });

  it("saves nothing when the person declines, and logs that", async () => {
    const { runner, values, log } = harness(false);
    const answer = await runner.run(call(make), signal);
    expect(answer.isError).toBe(true);
    expect(answer.content).toContain("declined");
    expect(values[FLOWS_SETTING]).toBe("[]");
    expect(log[0]).toContain("Declined agent flow change");
  });

  it("saves nothing if the Flow page changed the flows while the dialog was open", async () => {
    const { runner, values } = harness(true, { editWhileAsking: true });
    const answer = await runner.run(call(make), signal);
    expect(answer.isError).toBe(true);
    expect(answer.content).toContain("changed on the Flow page");
    expect(readFlows(values[FLOWS_SETTING]).map((flow) => flow.id)).toEqual(["drawn"]);
  });

  it("answers mistakes without a dialog, and leaves other tools to the next runner", async () => {
    const { runner, asked } = harness(true);
    expect((await runner.run(call({ action: "create", name: "X" }), signal)).isError).toBe(true);
    expect(asked).toHaveLength(0);
    expect((await runner.run({ type: "tool-call", id: "c2", name: "read_file", input: {} }, signal)).content).toBe("base");
  });
});

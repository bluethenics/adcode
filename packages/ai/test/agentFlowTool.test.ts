import { describe, expect, it } from "vitest";
import {
  activeFlowFor, defaultFlow, encodeFlowLink, flowTaskAgents, readFlows, type AgentFlow,
} from "../src/agentFlow.ts";
import {
  MANAGE_AGENT_FLOW, describeFlows, diffFlows, findFlow, flowsSettingValue, guessRole, planFlowChange, type FlowPlan, type FlowToolContext,
} from "../src/agentFlowTool.ts";
import { summary } from "../src/toolLoading.ts";
import type { ModelCandidate } from "../src/taskAgents.ts";

const candidates: ModelCandidate[] = [
  { providerId: "tagflow", providerName: "ADCode Free AI", modelId: "claude-fable-5-2", modelName: "Fable 5.2", usable: true },
  { providerId: "deepseek", providerName: "DeepSeek", modelId: "deepseek-chat", modelName: "DeepSeek V3", usable: true },
  { providerId: "openai", providerName: "OpenAI", modelId: "gpt-5", modelName: "GPT-5", usable: false },
];
const ctx = (flows: readonly AgentFlow[] = [], extra: Partial<FlowToolContext> = {}): FlowToolContext => ({
  flows, candidates, chatId: "chat-1", chats: [{ id: "chat-1", title: "Checkout bug" }, { id: "chat-2", title: "Landing page" }], ...extra,
});
const change = (plan: FlowPlan) => {
  if (!plan.ok) throw new Error(plan.message);
  if (plan.kind !== "change") throw new Error(`expected a change, got: ${plan.content}`);
  return plan;
};
const failure = (plan: FlowPlan): string => {
  if (plan.ok) throw new Error("expected a refusal");
  return plan.message;
};

/** "Make a flow where Fable plans, DeepSeek codes and a read-only reviewer checks, on for this chat." */
const exampleCall = {
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

describe("manage_agent_flow create", () => {
  it("builds the example flow, runs it in this chat only, and resolves loose model names", () => {
    const plan = change(planFlowChange(exampleCall, ctx()));
    const flow = plan.flow!;
    expect(flow.name).toBe("Plan, code, review");
    expect(flow.enabled).toBe(true);
    expect(flow.scope).toEqual({ kind: "chats", chatIds: ["chat-1"] });
    expect(flow.entry).toBe("planner");
    const coder = flow.agents.find((agent) => agent.name === "Coder")!;
    expect(coder.model).toEqual({ provider: "deepseek", model: "deepseek-chat" });
    expect(coder.handles).toEqual(["code", "debug"]);
    const reviewer = flow.agents.find((agent) => agent.name === "Reviewer")!;
    expect(reviewer.readOnly).toBe(true);
    expect(reviewer.model).toBeNull();
    expect(flow.links.map((link) => `${link.from}>${link.to}:${link.kind}`)).toEqual(["planner>coder:handoff", "coder>reviewer:review"]);
    // Laid out left to right from the entry.
    expect(flow.agents.map((agent) => agent.x)).toEqual([80, 360, 640]);
  });

  it("says in the dialog what it makes, where it runs, and that the lead plays on the chat's model", () => {
    const plan = change(planFlowChange(exampleCall, ctx()));
    expect(plan.title).toBe('Create the flow "Plan, code, review"?');
    expect(plan.confirmLabel).toBe("Create flow");
    expect(plan.detail).toContain("Runs: on in this chat.");
    expect(plan.detail).toContain("Coder (coder): DeepSeek V3 on DeepSeek; takes coding, bug fixing");
    expect(plan.detail).toContain("Reviewer (reviewer, read-only): the chat's model; takes code review");
    expect(plan.detail).toContain("Coder sends for review to Reviewer");
    expect(plan.detail).toContain("Planner is the chat itself, so it runs on the chat's model, not Fable 5.2 on ADCode Free AI");
    expect(plan.detail).toContain("Nothing is saved until you confirm.");
    expect(plan.done).toContain('Saved the flow "Plan, code, review"');
  });

  it("saves a value the Flow page and the main process read back the same way", () => {
    const plan = change(planFlowChange(exampleCall, ctx()));
    const saved = readFlows(flowsSettingValue(plan.flows));
    expect(saved).toEqual(plan.flows);
    expect(activeFlowFor(saved, "chat-1")?.name).toBe("Plan, code, review");
    expect(activeFlowFor(saved, "chat-2")).toBeNull();
    const helpers = flowTaskAgents(saved[0]!);
    expect(helpers.map((agent) => [agent.id, agent.model, agent.toolAccess])).toEqual([["coder", "deepseek-chat", undefined], ["reviewer", "", "read-only"]]);
  });

  it("hands back the choices when a model name is ambiguous, and refuses one without a key", () => {
    const two = [...candidates, { providerId: "deepseek", providerName: "DeepSeek", modelId: "deepseek-reasoner", modelName: "DeepSeek R1", usable: true }];
    const ambiguous = failure(planFlowChange(exampleCall, ctx([], { candidates: two })));
    expect(ambiguous).toContain("Coder: deepseek matches several connected models");
    expect(ambiguous).toContain("deepseek:deepseek-reasoner");
    const noKey = failure(planFlowChange({ ...exampleCall, agents: [{ name: "Coder", model: "gpt-5" }] }, ctx()));
    expect(noKey).toContain("no API key");
  });

  it("guesses a role from the name and keeps 'current' on the chat's model", () => {
    const plan = change(planFlowChange({ action: "create", name: "Two", agents: [{ name: "Lead" }, { name: "Code reviewer", model: "current" }] }, ctx()));
    expect(plan.flow!.agents.map((agent) => agent.role)).toEqual(["planner", "reviewer"]);
    expect(plan.flow!.agents[1]!.model).toBeNull();
    expect(plan.flow!.scope).toEqual({ kind: "all" });
    expect(guessRole("Bug fixer")).toBe("coder");
  });

  it("refuses what the Flow page would refuse", () => {
    expect(failure(planFlowChange({ action: "create", agents: [{ name: "A" }] }, ctx()))).toContain("name");
    expect(failure(planFlowChange({ action: "create", name: "X", agents: [] }, ctx()))).toContain("agents");
    expect(failure(planFlowChange({ action: "create", name: "X", agents: [{ name: "A" }, { name: "a" }] }, ctx()))).toContain("Two agents");
    expect(failure(planFlowChange({ action: "create", name: "X", agents: [{ name: "A" }], links: [{ from: "A", to: "A" }] }, ctx()))).toContain("itself");
    expect(failure(planFlowChange({ action: "create", name: "X", agents: [{ name: "A" }], links: [{ from: "A", to: "Ghost" }] }, ctx()))).toContain("not in the flow");
    expect(failure(planFlowChange({ action: "create", name: "X", agents: [{ name: "A", role: "wizard" }] }, ctx()))).toContain("role is one of");
    expect(failure(planFlowChange({ action: "create", name: "X", agents: Array.from({ length: 51 }, (_, i) => ({ name: `A${String(i)}` })) }, ctx()))).toContain("50");
    expect(failure(planFlowChange({ action: "create", name: "X", agents: [{ name: "A" }], chats: ["Nope"] }, ctx()))).toContain('No chat called "Nope"');
    expect(failure(planFlowChange({ action: "dance" }, ctx()))).toContain("action is one of");
    const full = Array.from({ length: 20 }, (_, i) => ({ ...defaultFlow(`flow-${String(i)}`), name: `F${String(i)}` }));
    expect(failure(planFlowChange(exampleCall, ctx(full)))).toContain("up to 20 flows");
    const existing = change(planFlowChange(exampleCall, ctx())).flows;
    expect(failure(planFlowChange(exampleCall, ctx(existing)))).toContain("already exists");
  });
});

describe("manage_agent_flow edit, on/off, delete", () => {
  const start = (): AgentFlow[] => [...change(planFlowChange(exampleCall, ctx())).flows];

  it("changes only what is named and lists each change", () => {
    const plan = change(planFlowChange({
      action: "edit", flow: "plan, code, review", name: "Ship it",
      agents: [{ name: "coder", model: "fable" }, { name: "Tester", role: "tester" }, { name: "Reviewer", new_name: "Checker" }],
      links: [{ from: "Coder", to: "Tester", kind: "review" }],
    }, ctx(start())));
    const flow = plan.flow!;
    expect(flow.name).toBe("Ship it");
    expect(flow.agents.find((agent) => agent.id === "coder")!.model).toEqual({ provider: "tagflow", model: "claude-fable-5-2" });
    expect(flow.agents.find((agent) => agent.id === "reviewer")!.name).toBe("Checker");
    // A new agent goes beside the drawn ones; nothing the person placed moves.
    expect(flow.agents.slice(0, 3).map((agent) => agent.x)).toEqual([80, 360, 640]);
    expect(flow.agents.find((agent) => agent.name === "Tester")!.x).toBe(920);
    expect(plan.title).toBe('Change the flow "Plan, code, review"?');
    expect(plan.detail).toContain('renamed from "Plan, code, review" to "Ship it"');
    expect(plan.detail).toContain("Coder: model Fable 5.2 on ADCode Free AI");
    expect(plan.detail).toContain("Reviewer: renamed to Checker");
    expect(plan.detail).toContain("adds Tester (tester)");
    expect(plan.detail).toContain("links Coder sends for review to Tester");
  });

  it("removes agents with their links, and moves the entry if it went", () => {
    const plan = change(planFlowChange({ action: "edit", flow: "plan-code-review", agents: [{ name: "Planner", remove: true }] }, ctx(start())));
    expect(plan.flow!.agents.map((agent) => agent.id)).toEqual(["coder", "reviewer"]);
    expect(plan.flow!.links).toHaveLength(1);
    expect(plan.flow!.entry).toBe("coder");
    expect(plan.detail).toContain("removes Planner");
    expect(failure(planFlowChange({ action: "edit", flow: "plan-code-review", agents: [{ name: "Ghost", remove: true }] }, ctx(start())))).toContain("no agent called");
  });

  it("turns a flow on for more chats, off for some, and off everywhere", () => {
    const on = change(planFlowChange({ action: "on", flow: "Plan, code, review", chats: ["Landing page"] }, ctx(start())));
    expect(on.flow!.scope).toEqual({ kind: "chats", chatIds: ["chat-1", "chat-2"] });
    expect(on.detail).toContain('runs: on in this chat, "Landing page" (was on in this chat)');
    const less = change(planFlowChange({ action: "off", flow: "Plan, code, review", chats: ["this"] }, ctx(on.flows)));
    expect(less.flow!.scope).toEqual({ kind: "chats", chatIds: ["chat-2"] });
    expect(less.flow!.enabled).toBe(true);
    const off = change(planFlowChange({ action: "off", flow: "Plan, code, review" }, ctx(less.flows)));
    expect(off.flow!.enabled).toBe(false);
    expect(off.confirmLabel).toBe("Turn off");
    const all = change(planFlowChange({ action: "on", flow: "Plan, code, review", chats: ["all"] }, ctx(off.flows)));
    expect(all.flow!.scope).toEqual({ kind: "all" });
    expect(failure(planFlowChange({ action: "off", flow: "Plan, code, review", chats: ["this"] }, ctx(all.flows)))).toContain("runs in every chat");
  });

  it("says when nothing would change, without asking", () => {
    const plan = planFlowChange({ action: "on", flow: "Plan, code, review" }, ctx(start()));
    expect(plan.ok && plan.kind === "answer" && plan.content).toContain("Nothing to change");
  });

  it("takes the same place off another flow when one is turned on, and says so", () => {
    const other: AgentFlow = { ...defaultFlow("everyday"), name: "Everyday", enabled: true, scope: { kind: "all" } };
    const plan = change(planFlowChange({ ...exampleCall, chats: ["all"] }, ctx([other])));
    expect(plan.flows.find((flow) => flow.id === "everyday")!.enabled).toBe(false);
    expect(plan.detail).toContain('"Everyday" ran in every chat; it is switched off');
    const chatOwned: AgentFlow = { ...defaultFlow("mine"), name: "Mine", enabled: true, scope: { kind: "chats", chatIds: ["chat-1", "chat-2"] } };
    const second = change(planFlowChange(exampleCall, ctx([chatOwned])));
    expect(second.flows.find((flow) => flow.id === "mine")!.scope).toEqual({ kind: "chats", chatIds: ["chat-2"] });
    expect(second.detail).toContain('"Mine" stops running in this chat.');
  });

  it("deletes after asking, and finds flows by name or id", () => {
    const flows = start();
    expect(findFlow(flows, "PLAN, CODE, REVIEW")?.id).toBe("plan-code-review");
    expect(findFlow(flows, undefined)?.id).toBe("plan-code-review");
    const plan = change(planFlowChange({ action: "delete", flow: "plan-code-review" }, ctx(flows)));
    expect(plan.flows).toEqual([]);
    expect(plan.flow).toBeNull();
    expect(plan.detail).toContain("Copy its share link first");
    expect(failure(planFlowChange({ action: "delete", flow: "nope" }, ctx(flows)))).toContain('Flows: "Plan, code, review"');
  });
});

describe("manage_agent_flow list, share, import", () => {
  it("lists flows with models, entry and links", () => {
    const flows = change(planFlowChange(exampleCall, ctx())).flows;
    const text = describeFlows(ctx(flows));
    expect(text).toContain('"Plan, code, review" (id plan-code-review), on in this chat');
    expect(text).toContain("Planner [entry] (planner, chat's model");
    expect(text).toContain("Coder (coder, deepseek:deepseek-chat");
    expect(describeFlows(ctx())).toContain("No agent flows yet");
  });

  it("shares a link that imports back as a copy, off until turned on", () => {
    const flows = change(planFlowChange(exampleCall, ctx())).flows;
    const shared = planFlowChange({ action: "share", flow: "Plan, code, review" }, ctx(flows));
    if (!shared.ok || shared.kind !== "answer") throw new Error("share failed");
    expect(shared.content).toContain(encodeFlowLink(flows[0]!));
    const imported = change(planFlowChange({ action: "import", link: encodeFlowLink(flows[0]!) }, ctx(flows)));
    expect(imported.flow!.id).toBe("plan-code-review-2");
    expect(imported.flow!.enabled).toBe(false);
    expect(imported.title).toBe('Import the flow "Plan, code, review"?');
    expect(failure(planFlowChange({ action: "import", link: "https://example.com" }, ctx()))).toContain("not an ADCode flow link");
  });

  it("describes a change in words", () => {
    const before = defaultFlow();
    const after: AgentFlow = { ...before, entry: "coder", links: before.links.filter((link) => link.id !== "coder-tester") };
    expect(diffFlows(before, after, ctx())).toEqual(["unlinks Coder from Tester", "Coder is now the first stop"]);
  });
});

describe("the tool definition", () => {
  it("is cheap in the load_tools catalogue and says what it does", () => {
    expect(summary(MANAGE_AGENT_FLOW.description)).toBe("Create, edit, turn on or off, delete and share agent flows");
    expect(MANAGE_AGENT_FLOW.mutating).toBe(true);
    expect(JSON.stringify(MANAGE_AGENT_FLOW).length).toBeLessThan(3_600);
  });
});

import { describe, expect, it } from "vitest";
import {
  activeFlowFor, addAgent, classifyTask, connect, decodeFlowLink, defaultFlow, encodeFlowLink, flowContext, flowTaskAgents,
  MAX_FLOW_AGENTS, moveAgent, parseFlow, pipelineFor, readFlows, removeAgent, routeTask, updateAgent, type AgentFlow,
} from "../src/agentFlow.ts";
import { routeHelper } from "../src/taskAgents.ts";

const ok = (edit: { ok: true; flow: AgentFlow } | { ok: false; message: string }): AgentFlow => {
  if (!edit.ok) throw new Error(edit.message);
  return edit.flow;
};

describe("agent flows", () => {
  it("starts with a Thinker that hands coding to a Coder, checked by a Reviewer and a Tester", () => {
    const flow = defaultFlow();
    expect(flow.entry).toBe("thinker");
    expect(routeTask(flow, "code").id).toBe("coder");
    expect(pipelineFor(flow, "code").map((agent) => agent.id)).toEqual(["coder", "reviewer", "tester"]);
    // A question stays with the Thinker, who can consult the Researcher without handing off.
    expect(pipelineFor(flow, "question").map((agent) => agent.id)).toEqual(["thinker", "coder", "reviewer", "tester"]);
    expect(routeTask(flow, "research").id).toBe("researcher");
  });

  it("classifies messages by the work they ask for", () => {
    expect(classifyTask("Add a dark mode toggle to settings.tsx")).toBe("code");
    expect(classifyTask("The app crashes when I click save")).toBe("debug");
    expect(classifyTask("write unit tests for the parser")).toBe("test");
    expect(classifyTask("make the login page layout responsive")).toBe("design");
    expect(classifyTask("what does this project do?")).toBe("question");
  });

  it("allows fifty agents and refuses the fifty-first", () => {
    let flow = defaultFlow();
    while (flow.agents.length < MAX_FLOW_AGENTS) flow = ok(addAgent(flow, "coder", flow.agents.length * 10, 0));
    expect(new Set(flow.agents.map((agent) => agent.id)).size).toBe(MAX_FLOW_AGENTS);
    const refused = addAgent(flow, "tester", 0, 0);
    expect(refused.ok).toBe(false);
    // Parsing enforces the cap too, so a tampered link cannot carry more.
    const padded = { ...flow, agents: [...flow.agents, ...flow.agents.map((agent) => ({ ...agent, id: `${agent.id}-x` }))] };
    expect(parseFlow(padded)?.agents).toHaveLength(MAX_FLOW_AGENTS);
  });

  it("connects, refuses self and duplicate links, and drops an agent's links with it", () => {
    let flow = defaultFlow();
    expect(connect(flow, "coder", "coder").ok).toBe(false);
    expect(connect(flow, "thinker", "coder").ok).toBe(false);
    flow = ok(connect(flow, "reviewer", "coder", "handoff"));
    // A review loop back to the Coder does not make the path run forever.
    expect(pipelineFor(flow, "code").map((agent) => agent.id)).toEqual(["coder", "reviewer", "tester"]);
    flow = ok(removeAgent(flow, "coder"));
    expect(flow.links.some((link) => link.from === "coder" || link.to === "coder")).toBe(false);
    expect(routeTask(flow, "code").id).toBe("thinker");
  });

  it("edits roles, shapes and positions within bounds", () => {
    let flow = ok(updateAgent(defaultFlow(), "coder", { name: "DeepSeek coder", shape: "diamond", model: { provider: "deepseek", model: "deepseek-chat" } }));
    flow = moveAgent(flow, "coder", 1e9, -5);
    const coder = flow.agents.find((agent) => agent.id === "coder")!;
    expect(coder).toMatchObject({ name: "DeepSeek coder", shape: "diamond", x: 20_000, y: -5 });
    expect(updateAgent(flow, "nobody", { name: "x" }).ok).toBe(false);
  });

  it("applies to all chats or to the chats it names, a named one winning", () => {
    const everywhere = defaultFlow("everywhere");
    const named = { ...defaultFlow("named"), scope: { kind: "chats" as const, chatIds: ["s1"] } };
    expect(activeFlowFor([everywhere, named], "s1")?.id).toBe("named");
    expect(activeFlowFor([everywhere, named], "s2")?.id).toBe("everywhere");
    expect(activeFlowFor([{ ...everywhere, enabled: false }], "s2")).toBeNull();
  });

  it("round-trips through a share link without its chat scope", () => {
    const flow = { ...defaultFlow(), scope: { kind: "chats" as const, chatIds: ["private-chat"] } };
    const link = encodeFlowLink(flow);
    expect(link.startsWith("https://adcode.bluethenics.com/flow#v1.")).toBe(true);
    const back = decodeFlowLink(link);
    expect(back.ok && back.flow.agents.map((agent) => agent.id)).toEqual(flow.agents.map((agent) => agent.id));
    expect(back.ok && back.flow.scope).toEqual({ kind: "all" });
    expect(decodeFlowLink("https://example.com/#nope").ok).toBe(false);
    expect(decodeFlowLink(link.slice(0, -10)).ok).toBe(false);
  });

  it("reads saved flows leniently", () => {
    expect(readFlows("not json")).toEqual([]);
    expect(readFlows(JSON.stringify([defaultFlow(), { id: "bad" }, defaultFlow()]))).toHaveLength(1);
  });

  it("turns flow agents into task agents delegate_task can reach, coding routed to the Coder", () => {
    const agents = flowTaskAgents(defaultFlow());
    expect(agents.map((agent) => agent.id)).toEqual(["coder", "reviewer", "tester", "researcher"]);
    const route = routeHelper({ mode: "build" }, agents);
    expect(route.kind === "agent" && route.agent.id).toBe("coder");
    expect(agents.find((agent) => agent.id === "reviewer")?.toolAccess).toBe("read-only");
  });

  it("tells the chat who it is and who takes the work over", () => {
    const text = flowContext(defaultFlow(), "Fix the crash in parser.ts");
    expect(text).toContain("you are Thinker");
    expect(text).toContain('delegate_task agent: "coder"');
    expect(text).toContain("checks the result");
    expect(text.length).toBeLessThan(3_000);
  });
});

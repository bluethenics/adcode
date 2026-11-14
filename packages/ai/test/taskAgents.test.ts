import { describe, expect, it } from "vitest";
import {
  agentIdFor,
  describeCreateAgent,
  planCreateAgent,
  readTaskAgents,
  resolveModel,
  rosterContext,
  routeHelper,
  withTaskAgent,
  type ModelCandidate,
} from "../src/taskAgents.ts";

const coder = { id: "deepseek-coder", name: "DeepSeek coder", instructions: "Write the code you are given.", provider: "deepseek", model: "deepseek-chat", helperFor: ["build"] };
const scout = { id: "scout", name: "Scout", instructions: "Find things.", provider: "openrouter", model: "qwen/qwen3-coder", toolAccess: "read-only", helperFor: ["explore"] };

const candidates: ModelCandidate[] = [
  { providerId: "anthropic", providerName: "Anthropic", modelId: "claude-fable-5-2", modelName: "Fable 5.2", usable: true },
  { providerId: "deepseek", providerName: "DeepSeek", modelId: "deepseek-chat", modelName: "DeepSeek V3", usable: true },
  { providerId: "deepseek", providerName: "DeepSeek", modelId: "deepseek-reasoner", modelName: "DeepSeek R1", usable: true },
  { providerId: "openrouter", providerName: "OpenRouter", modelId: "deepseek/deepseek-chat", modelName: "DeepSeek V3", usable: false },
  { providerId: "openrouter", providerName: "OpenRouter", modelId: "qwen/qwen3-coder", modelName: "Qwen3 Coder", usable: false },
];

describe("task agents", () => {
  it("reads saved agents leniently and never widens tool access", () => {
    const agents = readTaskAgents(JSON.stringify([coder, scout, { id: "x", name: "bad id" }, { ...coder, id: "wide", toolAccess: "everything" }, coder]));
    expect(agents.map((agent) => agent.id)).toEqual(["deepseek-coder", "scout"]);
    expect(agents[0]?.helperFor).toEqual(["build"]);
    expect(agents[1]?.toolAccess).toBe("read-only");
    expect(readTaskAgents("not json")).toEqual([]);
  });

  it("routes a task to the agent it names, else the default for its kind, else the lead's model", () => {
    const agents = readTaskAgents([coder, scout]);
    expect(routeHelper({ mode: "build" }, agents)).toMatchObject({ kind: "agent", chosen: "default", agent: { id: "deepseek-coder" } });
    expect(routeHelper({ mode: "explore" }, agents)).toMatchObject({ kind: "agent", agent: { id: "scout" } });
    expect(routeHelper({ mode: "build", agent: "Scout" }, agents)).toMatchObject({ kind: "agent", chosen: "named", agent: { id: "scout" } });
    expect(routeHelper({ mode: "build", agent: "self" }, agents)).toEqual({ kind: "same" });
    expect(routeHelper({ mode: "build" }, [])).toEqual({ kind: "same" });
    const missing = routeHelper({ mode: "build", agent: "ghost" }, agents);
    expect(missing.kind === "error" && missing.message).toMatch(/deepseek-coder, scout/);
  });

  it("tells only a chat with agents about them", () => {
    expect(rosterContext([], { provider: "anthropic", model: "claude-fable-5-2" })).toBeNull();
    const text = rosterContext(readTaskAgents([coder]), { provider: "anthropic", model: "claude-fable-5-2" }) ?? "";
    expect(text).toContain("you lead on claude-fable-5-2");
    expect(text).toContain("build tasks go to deepseek-coder");
    expect(text).toContain("deepseek-chat (deepseek)");
  });

  it("resolves a loose model name, asks when it is ambiguous, and says when a key is missing", () => {
    expect(resolveModel("deepseek-chat", undefined, candidates)).toMatchObject({ ok: true, candidate: { providerId: "deepseek" } });
    expect(resolveModel("deepseek v3", undefined, candidates)).toMatchObject({ ok: true, candidate: { modelId: "deepseek-chat" } });
    const ambiguous = resolveModel("deepseek", undefined, candidates);
    expect(!ambiguous.ok && ambiguous.message).toMatch(/several connected models: .*deepseek-chat.*deepseek-reasoner/);
    const keyless = resolveModel("qwen coder", undefined, candidates);
    expect(!keyless.ok && keyless.message).toMatch(/OpenRouter.*no API key/);
    expect(resolveModel("openrouter:deepseek/deepseek-chat", undefined, candidates)).toMatchObject({ ok: false });
    expect(resolveModel("fable", "anthropic", candidates)).toMatchObject({ ok: true, candidate: { modelId: "claude-fable-5-2" } });
    expect(resolveModel("nothing-like-it", undefined, candidates)).toMatchObject({ ok: false });
  });

  it("plans an agent from a create_agent call, reusing a same-named agent's id", () => {
    const plan = planCreateAgent({ name: "DeepSeek coder", instructions: "Code it.", model: "deepseek-chat", helper_for: ["build"] }, candidates, readTaskAgents([coder]));
    expect(plan).toMatchObject({ ok: true, replaces: "deepseek-coder", draft: { id: "deepseek-coder", provider: "deepseek", model: "deepseek-chat", helperFor: ["build"] } });
    if (plan.ok) expect(describeCreateAgent(plan).detail).toContain("coding tasks to it by default");
    expect(planCreateAgent({ name: "Reader", instructions: "x", model: "deepseek-chat", access: "read-only", helper_for: ["build"] }, candidates, [])).toMatchObject({ ok: false });
    expect(planCreateAgent({ name: "self", instructions: "x", model: "deepseek-chat" }, candidates, [])).toMatchObject({ ok: false });
    expect(planCreateAgent({ name: "A", instructions: "", model: "deepseek-chat" }, candidates, [])).toMatchObject({ ok: false });
    expect(agentIdFor("DeepSeek coder", ["deepseek-coder"])).toBe("deepseek-coder-2");
    expect(agentIdFor("42", [])).toMatch(/^[a-z][a-z0-9-]{2,47}$/);
  });

  it("saves an agent, taking its work over from the agent that had it and keeping everything else", () => {
    const before = JSON.stringify([{ ...coder, mascot: { shape: "round", color: "teal" }, extra: 1 }, { ...scout, helperFor: ["explore", "build"] }]);
    const after = JSON.parse(withTaskAgent(before, { id: "qwen", name: "Qwen", instructions: "Code.", provider: "openrouter", model: "qwen/qwen3-coder", helperFor: ["build"] })) as Record<string, unknown>[];
    expect(after.map((item) => item["id"])).toEqual(["deepseek-coder", "scout", "qwen"]);
    expect(after[0]).not.toHaveProperty("helperFor");
    expect(after[0]).toMatchObject({ extra: 1 });
    expect(after[1]?.["helperFor"]).toEqual(["explore"]);
    // Updating in place keeps the look the person chose.
    const updated = JSON.parse(withTaskAgent(before, { id: "deepseek-coder", name: "DeepSeek coder", instructions: "New.", provider: "deepseek", model: "deepseek-reasoner" })) as Record<string, unknown>[];
    expect(updated[0]).toMatchObject({ instructions: "New.", model: "deepseek-reasoner", mascot: { shape: "round", color: "teal" } });
    expect(updated).toHaveLength(2);
  });
});

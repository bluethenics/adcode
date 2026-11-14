import { describe, expect, it } from "vitest";
import { createAgent } from "../src/agent.ts";
import { LOAD_TOOLS_NAME, loadTools, loadedFromHistory, offeredTools, summary } from "../src/toolLoading.ts";
import type { Provider, ProviderEvent, ProviderRequest, ToolDefinition, ToolRunner } from "../src/types.ts";

const tool = (name: string, description = `${name} does one thing. More detail follows here.`): ToolDefinition => ({
  name,
  description,
  mutating: false,
  inputSchema: { type: "object", properties: {} },
});
const tools = [tool("read_file"), tool("edit_file"), tool("view_page"), tool("fork_chats")];
const deferred = new Set(["view_page", "fork_chats"]);

describe("which tools a request carries", () => {
  it("sends the core tools whole and the rest as one catalogue line each", () => {
    const sent = offeredTools(tools, deferred, new Set());
    expect(sent.map((t) => t.name)).toEqual(["read_file", "edit_file", LOAD_TOOLS_NAME]);
    const catalogue = sent.at(-1)!.description;
    expect(catalogue).toContain("view_page: view_page does one thing");
    expect(catalogue).toContain("fork_chats:");
    expect(catalogue).not.toContain("More detail");
  });

  it("sends a loaded tool whole from then on, and drops the catalogue once nothing is left", () => {
    expect(offeredTools(tools, deferred, new Set(["view_page"])).map((t) => t.name)).toEqual(["read_file", "edit_file", "view_page", LOAD_TOOLS_NAME]);
    expect(offeredTools(tools, deferred, new Set(["view_page", "fork_chats"])).map((t) => t.name)).toEqual(["read_file", "edit_file", "view_page", "fork_chats"]);
    expect(offeredTools(tools, new Set(), new Set()).map((t) => t.name)).toEqual(["read_file", "edit_file", "view_page", "fork_chats"]);
  });

  it("keeps catalogue lines short", () => {
    expect(summary("Use the shared built-in browser to open public HTTP/HTTPS pages, wait for them to settle and read them.").length).toBeLessThanOrEqual(67);
    expect(summary("Save a task agent: a named helper with its own model.")).toBe("Save a task agent");
  });
});

describe("loading", () => {
  it("loads known names, says what it did, and refuses names it does not list", () => {
    const loaded = new Set<string>();
    expect(loadTools({ names: ["view_page", "nope"] }, tools, deferred, loaded)).toEqual({ content: "Loaded view_page. Call them now. Not found: nope.", isError: false });
    expect([...loaded]).toEqual(["view_page"]);
    expect(loadTools({ names: ["nope"] }, tools, deferred, loaded).isError).toBe(true);
    expect(loadTools({}, tools, deferred, loaded).isError).toBe(true);
  });

  it("remembers what a restored conversation had loaded or used", () => {
    const loaded = loadedFromHistory([
      { role: "assistant", content: [{ type: "tool-call", id: "1", name: LOAD_TOOLS_NAME, input: { names: ["view_page"] } }] },
      { role: "assistant", content: [{ type: "tool-call", id: "2", name: "fork_chats", input: {} }] },
    ], deferred);
    expect([...loaded].sort()).toEqual(["fork_chats", "view_page"]);
  });
});

describe("in the agent", () => {
  function scripted(turns: ProviderEvent[][], seen: ProviderRequest[]): Provider {
    let index = 0;
    return {
      id: "anthropic", displayName: "Scripted", models: ["m"],
      async *stream(request) {
        seen.push(request);
        for (const event of turns[index++] ?? [{ kind: "stop", reason: "end-turn" }]) yield event;
      },
    } as Provider;
  }
  const runner = (ran: string[]): ToolRunner => ({ run: async (call) => { ran.push(call.name); return { content: "ok", isError: false }; } });

  it("loads a tool the model asks for, sends it whole on the next step, and never passes load_tools to the runner", async () => {
    const seen: ProviderRequest[] = [];
    const ran: string[] = [];
    const agent = createAgent({
      provider: scripted([
        [{ kind: "tool-call", call: { type: "tool-call", id: "a", name: LOAD_TOOLS_NAME, input: { names: ["view_page"] } } }, { kind: "stop", reason: "tool-use" }],
        [{ kind: "tool-call", call: { type: "tool-call", id: "b", name: "view_page", input: {} } }, { kind: "stop", reason: "tool-use" }],
      ], seen),
      model: "m", tools, runner: runner(ran), deferredTools: deferred,
    });
    for await (const _event of agent.send("check the page")) { /* drain */ }
    expect(seen[0]!.tools.map((t) => t.name)).toEqual(["read_file", "edit_file", LOAD_TOOLS_NAME]);
    expect(seen[1]!.tools.map((t) => t.name)).toContain("view_page");
    expect(ran).toEqual(["view_page"]);
  });

  it("runs a listed tool called without loading it, and sends it whole from then on", async () => {
    const seen: ProviderRequest[] = [];
    const ran: string[] = [];
    const agent = createAgent({
      provider: scripted([[{ kind: "tool-call", call: { type: "tool-call", id: "a", name: "fork_chats", input: {} } }, { kind: "stop", reason: "tool-use" }]], seen),
      model: "m", tools, runner: runner(ran), deferredTools: deferred,
    });
    for await (const _event of agent.send("split it")) { /* drain */ }
    expect(ran).toEqual(["fork_chats"]);
    expect(seen[1]!.tools.map((t) => t.name)).toContain("fork_chats");
  });
});

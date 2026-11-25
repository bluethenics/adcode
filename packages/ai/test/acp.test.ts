import { describe, expect, it, vi } from "vitest";
import { CLI_AGENTS, acpMcpServers, acpModelRequest, acpPermission, acpPermissionChoice, acpUpdateEvents, createAcpProvider, isNewerCliVersion, cliUpdateCommand, parseAcpModels, type CliLiveEntry, type CliLiveProcess, type CliLiveSpawn, type CliPermissionAsk, type CliSpawn } from "../src/index.ts";
import type { ProviderEvent, ProviderRequest } from "../src/types.ts";

// `session/new` as OpenCode 1.19.5 answers it over `opencode acp`, trimmed.
const OPENCODE_SESSION = {
  sessionId: "ses_1",
  configOptions: [{ id: "model", name: "Model", category: "model", type: "select", currentValue: "opencode/big-pickle", options: [{ value: "opencode/big-pickle", name: "OpenCode/Big Pickle" }, { value: "nvidia/deepseek-ai/deepseek-v4.1-flash", name: "Nvidia/DeepSeek V4.1 Flash" }] }],
};

const opencode = CLI_AGENTS.find((agent) => agent.id === "opencode")!;
const request = (texts: string[], model = "default"): ProviderRequest => ({
  model, system: "", tools: [], maxTokens: 1000,
  messages: texts.map((text, index) => ({ role: index % 2 === 0 ? "user" as const : "assistant" as const, content: [{ type: "text" as const, text }] })),
});

type Handler = (method: string, params: Record<string, unknown>, out: (message: unknown) => void, id: number) => unknown;

/** An ACP agent: answers each request through `handle`, which may also send notifications first. */
function fakeAgent(handle: Handler) {
  const started: { args: readonly string[]; received: { method: string; params: Record<string, unknown> }[]; killed: boolean; replies: unknown[] }[] = [];
  const live: CliLiveSpawn = (_command, args) => {
    const record = { args, received: [] as { method: string; params: Record<string, unknown> }[], killed: false, replies: [] as unknown[] };
    started.push(record);
    const queue: string[] = [];
    const waiting: ((line: string | null) => void)[] = [];
    const out = (message: unknown): void => { const line = JSON.stringify(message); const resolve = waiting.shift(); if (resolve) resolve(line); else queue.push(line); };
    const process: CliLiveProcess = {
      next: () => (queue.length > 0 ? Promise.resolve(queue.shift()!) : record.killed ? Promise.resolve(null) : new Promise((resolve) => waiting.push(resolve))),
      send: (line) => {
        const message = JSON.parse(line) as { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown };
        if (message.method === undefined) { record.replies.push(message.result); return; }
        record.received.push({ method: message.method, params: message.params ?? {} });
        if (message.id === undefined) { handle(message.method, message.params ?? {}, out, -1); return; }
        const id = message.id;
        // Answer on a later tick, as a real process would.
        setTimeout(() => {
          const result = handle(message.method!, message.params ?? {}, out, id);
          if (result !== undefined) out({ jsonrpc: "2.0", id, ...(result instanceof Error ? { error: { code: (result as Error & { code?: number }).code ?? -32603, message: result.message } } : { result }) });
        }, 1);
      },
      alive: () => !record.killed,
      exit: new Promise(() => undefined),
      stderr: () => "",
      kill: () => { record.killed = true; for (const resolve of waiting.splice(0)) resolve(null); },
    };
    return process;
  };
  return { live, started };
}

const noSpawn: CliSpawn = () => { throw new Error("ACP agents never use a one-shot spawn"); };

/** OpenCode-like: streams a thought and words, then ends the turn. */
const replying = (words: string[]): Handler => (method, params, out) => {
  if (method === "initialize") return { protocolVersion: 1, agentCapabilities: { loadSession: true, mcpCapabilities: { http: true }, sessionCapabilities: { resume: {} } } };
  if (method === "session/new") return OPENCODE_SESSION;
  if (method === "session/resume") return {};
  if (method === "session/set_config_option") return {};
  if (method === "session/prompt") {
    const sessionId = params["sessionId"];
    out({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Thinking it over" } } } });
    for (const word of words) out({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: word } } } });
    return { stopReason: "end_turn", usage: { inputTokens: 282, outputTokens: 3, cachedReadTokens: 12544, thoughtTokens: 11 } };
  }
  return undefined;
};

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
const textOf = (events: ProviderEvent[]): string => events.map((event) => (event.kind === "text" ? event.text : "")).join("");

describe("ACP agents", () => {
  it("reads the models a session offers, in either shape, and how to choose one", () => {
    expect(parseAcpModels(OPENCODE_SESSION).map((model) => [model.id, model.isDefault === true])).toEqual([["opencode/big-pickle", true], ["nvidia/deepseek-ai/deepseek-v4.1-flash", false]]);
    expect(parseAcpModels({ models: { currentModelId: "gemini-3-pro", availableModels: [{ modelId: "gemini-3-pro", name: "Gemini 3 Pro" }] } })).toEqual([{ id: "gemini-3-pro", name: "Gemini 3 Pro", isDefault: true }]);
    expect(acpModelRequest("s", OPENCODE_SESSION, "nvidia/deepseek-ai/deepseek-v4.1-flash")).toEqual({ method: "session/set_config_option", params: { sessionId: "s", configId: "model", value: "nvidia/deepseek-ai/deepseek-v4.1-flash" } });
    expect(acpModelRequest("s", OPENCODE_SESSION, "opencode/big-pickle")).toBeNull();
    expect(acpModelRequest("s", { models: { currentModelId: "a", availableModels: [{ modelId: "a" }, { modelId: "b" }] } }, "b")).toEqual({ method: "session/set_model", params: { sessionId: "s", modelId: "b" } });
  });

  it("lets a chat read and edit, but runs commands only with Full access", () => {
    const options = [{ optionId: "yes", kind: "allow_once", name: "Allow" }, { optionId: "no", kind: "reject_once", name: "Reject" }];
    expect(acpPermission({ toolCall: { kind: "edit", title: "src/a.ts" }, options }, false)).toEqual({ optionId: "yes", denied: null });
    expect(acpPermission({ toolCall: { kind: "execute", title: "rm -rf build" }, options }, false)).toEqual({ optionId: "no", denied: { tool: "execute", detail: "rm -rf build" } });
    expect(acpPermission({ toolCall: { kind: "execute", title: "npm test" }, options }, true).optionId).toBe("yes");
  });

  it("joins streamed words and shows tool calls as rows", () => {
    const state = { last: null as "text" | "thought" | "other" | null };
    const events = [
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hel" } },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "lo" } },
      { sessionUpdate: "tool_call", toolCallId: "1", title: "npm test", kind: "execute", status: "pending" },
      { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done" } },
    ].flatMap((update) => acpUpdateEvents(update, state));
    expect(events).toEqual([{ kind: "text", text: "Hel" }, { kind: "text", text: "lo", joined: true }, { kind: "tool", tool: { id: "1", name: "execute", kind: "execute", detail: "npm test", status: "running" } }, { kind: "text", text: "Done" }]);
  });

  it("settles an ACP tool call's row from its updates, keeping what the call first said and every file it named", () => {
    const state: Parameters<typeof acpUpdateEvents>[1] = { last: null };
    const events = [
      { sessionUpdate: "tool_call", toolCallId: "e1", title: "Edit src/a.ts", kind: "edit", status: "pending", locations: [{ path: "E:/project/src/a.ts" }] },
      // Says nothing new: no second row.
      { sessionUpdate: "tool_call_update", toolCallId: "e1", status: "in_progress" },
      { sessionUpdate: "tool_call_update", toolCallId: "e1", status: "completed", content: [{ type: "diff", path: "E:/project/src/b.ts", oldText: null, newText: "x" }] },
      { sessionUpdate: "tool_call", toolCallId: "r1", title: "cat missing.txt", kind: "read", status: "in_progress" },
      { sessionUpdate: "tool_call_update", toolCallId: "r1", status: "failed" },
      { sessionUpdate: "tool_call", toolCallId: "x1", title: "Something", kind: "switch_mode" },
    ].flatMap((update) => acpUpdateEvents(update, state));
    expect(events).toEqual([
      { kind: "tool", tool: { id: "e1", name: "edit", kind: "edit", detail: "Edit src/a.ts", status: "running", paths: ["E:/project/src/a.ts"] } },
      { kind: "tool", tool: { id: "e1", name: "edit", kind: "edit", detail: "Edit src/a.ts", status: "done", paths: ["E:/project/src/a.ts", "E:/project/src/b.ts"] } },
      { kind: "tool", tool: { id: "r1", name: "read", kind: "read", detail: "cat missing.txt", status: "running" } },
      { kind: "tool", tool: { id: "r1", name: "read", kind: "read", detail: "cat missing.txt", status: "failed" } },
      // A kind ADCode has no row for still draws one, as "other".
      { kind: "tool", tool: { id: "x1", name: "switch_mode", kind: "other", detail: "Something", status: "running" } },
    ]);
  });

  it("hands the tool bridge over as an HTTP MCP server only to agents that take one", () => {
    const mcp = { configPath: "/x.json", server: "adcode", url: "http://127.0.0.1:4100/mcp", token: "k" };
    expect(acpMcpServers(mcp, { mcpCapabilities: { http: true } })).toEqual([{ type: "http", name: "adcode", url: mcp.url, headers: [{ name: "Authorization", value: "Bearer k" }] }]);
    expect(acpMcpServers(mcp, { mcpCapabilities: { http: false } })).toEqual([]);
  });

  it("answers a chat's turns from one running agent, sending only the new message", async () => {
    const agent = fakeAgent(replying(["Hel", "lo"]));
    const liveProcesses = new Map<string, CliLiveEntry>();
    const sessions = new Map<string, { id: string; messages: number }>();
    const provider = () => createAcpProvider({ spec: opencode, models: ["default"], spawn: noSpawn, live: agent.live, liveProcesses, sessions, cwd: () => "E:/project", conversation: () => "chat-1" });
    const first = await collect(provider().stream(request(["hi"]), new AbortController().signal));
    expect(textOf(first)).toBe("Hello");
    expect(first).toContainEqual({ kind: "thinking", text: "Thinking it over" });
    expect(first).toContainEqual({ kind: "usage", inputTokens: 12826, outputTokens: 14, cachedTokens: 12544 });
    await collect(provider().stream(request(["hi", "Hello", "and again"]), new AbortController().signal));
    expect(agent.started).toHaveLength(1);
    expect(agent.started[0]!.args).toEqual(["acp"]);
    const prompts = agent.started[0]!.received.filter((message) => message.method === "session/prompt").map((message) => (message.params["prompt"] as { text: string }[])[0]!.text);
    expect(prompts).toEqual(["hi", "and again"]);
    expect(agent.started[0]!.received.filter((message) => message.method === "session/new")).toHaveLength(1);
    liveProcesses.forEach((entry) => entry.process.kill());
  });

  it("chooses the person's model on the new session", async () => {
    const agent = fakeAgent(replying(["ok"]));
    const provider = createAcpProvider({ spec: opencode, models: ["default"], spawn: noSpawn, live: agent.live, cwd: () => "." });
    await collect(provider.stream(request(["hi"], "nvidia/deepseek-ai/deepseek-v4.1-flash"), new AbortController().signal));
    expect(agent.started[0]!.received.map((message) => message.method)).toEqual(["initialize", "session/new", "session/set_config_option", "session/prompt"]);
    agent.started[0]!.killed = true;
  });

  it("resumes the agent's own session in a new process instead of replaying the chat", async () => {
    const agent = fakeAgent(replying(["again"]));
    const liveProcesses = new Map<string, CliLiveEntry>();
    const sessions = new Map([["opencode:default:chat:chat-1", { id: "ses_old", messages: 1 }]]);
    const provider = createAcpProvider({ spec: opencode, models: ["default"], spawn: noSpawn, live: agent.live, liveProcesses, sessions, cwd: () => ".", conversation: () => "chat-1" });
    await collect(provider.stream(request(["hi", "Hello", "more"]), new AbortController().signal));
    const received = agent.started[0]!.received;
    expect(received.map((message) => message.method)).toEqual(["initialize", "session/resume", "session/prompt"]);
    expect((received[2]!.params["prompt"] as { text: string }[])[0]!.text).toBe("more");
    liveProcesses.forEach((entry) => entry.process.kill());
  });

  it("refuses a command for a chat without Full access, and says why the turn stopped", async () => {
    const agent = fakeAgent((method, params, out, id) => {
      if (method === "session/prompt") {
        out({ jsonrpc: "2.0", id: 900, method: "session/request_permission", params: { sessionId: params["sessionId"], toolCall: { toolCallId: "t", kind: "execute", title: "rm -rf build" }, options: [{ optionId: "ok", kind: "allow_once" }, { optionId: "no", kind: "reject_once" }] } });
        void id;
        return { stopReason: "end_turn" };
      }
      return replying([])(method, params, out, id);
    });
    const events = await collect(createAcpProvider({ spec: opencode, models: ["default"], spawn: noSpawn, live: agent.live, cwd: () => "." }).stream(request(["clean"]), new AbortController().signal));
    expect(agent.started[0]!.replies).toContainEqual({ outcome: { outcome: "selected", optionId: "no" } });
    expect(textOf(events)).toContain("Turn on Full access");
    agent.started[0]!.killed = true;
  });

  it("asks the person before running a command, and waits for the answer", async () => {
    let prompt: { id: number; out: (message: unknown) => void } | null = null;
    const agent = fakeAgent((method, params, out, id) => {
      if (method === "session/prompt") {
        prompt = { id, out };
        out({ jsonrpc: "2.0", id: 900, method: "session/request_permission", params: { sessionId: params["sessionId"], toolCall: { toolCallId: "t", kind: "execute", title: "npm test", rawInput: { command: "npm test" } }, options: [{ optionId: "once", kind: "allow_once" }, { optionId: "always", kind: "allow_always" }, { optionId: "no", kind: "reject_once" }] } });
        return undefined;
      }
      return replying([])(method, params, out, id);
    });
    const asked: CliPermissionAsk[] = [];
    const provider = createAcpProvider({
      spec: opencode, models: ["default"], spawn: noSpawn, live: agent.live, cwd: () => ".", heartbeatMs: 5,
      askPermission: async (ask) => {
        asked.push(ask);
        // The person takes a while; the agent's turn ends only after the answer reached it.
        await new Promise((resolve) => setTimeout(resolve, 30));
        setTimeout(() => prompt!.out({ jsonrpc: "2.0", id: prompt!.id, result: { stopReason: "end_turn" } }), 5);
        return "session";
      },
    });
    const events = await collect(provider.stream(request(["test it"]), new AbortController().signal));
    expect(asked).toEqual([{ agent: "OpenCode", action: "run a command", tool: "execute", detail: "npm test" }]);
    expect(agent.started[0]!.replies).toContainEqual({ outcome: { outcome: "selected", optionId: "always" } });
    expect(events).toContainEqual({ kind: "status", text: "OpenCode asks to run a command: npm test - waiting for your answer" });
    // Thirty quiet milliseconds were the person's, not the agent's: no "still pondering".
    expect(events.some((event) => event.kind === "status" && event.text.includes("pondering"))).toBe(false);
    expect(events).toContainEqual({ kind: "thinking", text: "› Allowed for this chat: execute (npm test)\n" });
    expect(textOf(events)).not.toContain("Full access");
    agent.started[0]!.killed = true;
  });

  it("maps the person's answer onto the options the agent offered", () => {
    const options = [{ optionId: "once", kind: "allow_once" }, { optionId: "always", kind: "allow_always" }, { optionId: "no", kind: "reject_once" }];
    expect(acpPermissionChoice({ options }, "allow")).toBe("once");
    expect(acpPermissionChoice({ options }, "session")).toBe("always");
    expect(acpPermissionChoice({ options }, "deny")).toBe("no");
    expect(acpPermissionChoice({ options: [{ optionId: "once", kind: "allow_once" }] }, "session")).toBe("once");
  });
  it("says how to sign in when the agent needs it", async () => {
    const agent = fakeAgent((method) => (method === "initialize" ? { protocolVersion: 1, agentCapabilities: {} } : method === "session/new" ? Object.assign(new Error("Authentication required"), { code: -32000 }) : undefined));
    await expect(collect(createAcpProvider({ spec: opencode, models: ["default"], spawn: noSpawn, live: agent.live, cwd: () => "." }).stream(request(["hi"]), new AbortController().signal))).rejects.toThrow("Sign in by running `opencode auth login`");
    expect(agent.started[0]!.killed).toBe(true);
  });

  it("cancels the agent's turn on Stop and keeps the process for the next message", async () => {
    let finish: (() => void) | null = null;
    const agent = fakeAgent((method, params, out, id) => {
      if (method === "session/prompt") {
        out({ jsonrpc: "2.0", method: "session/update", params: { sessionId: params["sessionId"], update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Working" } } } });
        finish = () => out({ jsonrpc: "2.0", id, result: { stopReason: "cancelled" } });
        return undefined;
      }
      if (method === "session/cancel") { finish?.(); return undefined; }
      return replying([])(method, params, out, id);
    });
    const liveProcesses = new Map<string, CliLiveEntry>();
    const controller = new AbortController();
    const events: ProviderEvent[] = [];
    for await (const event of createAcpProvider({ spec: opencode, models: ["default"], spawn: noSpawn, live: agent.live, liveProcesses, cwd: () => ".", conversation: () => "c" }).stream(request(["go"]), controller.signal)) {
      events.push(event);
      if (event.kind === "text") controller.abort();
    }
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "cancelled" });
    expect(agent.started[0]!.received.map((message) => message.method)).toContain("session/cancel");
    expect(agent.started[0]!.killed).toBe(false);
    liveProcesses.forEach((entry) => entry.process.kill());
  });

  it("stops at once even when the agent never answers the cancel, and stops that agent after a grace period", async () => {
    const agent = fakeAgent((method, params, out, id) => {
      if (method === "session/prompt") {
        out({ jsonrpc: "2.0", method: "session/update", params: { sessionId: params["sessionId"], update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Working" } } } });
        return undefined; // Never answers, cancelled or not.
      }
      return replying([])(method, params, out, id);
    });
    const liveProcesses = new Map<string, CliLiveEntry>();
    const controller = new AbortController();
    const events: ProviderEvent[] = [];
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
    try {
      for await (const event of createAcpProvider({ spec: opencode, models: ["default"], spawn: noSpawn, live: agent.live, liveProcesses, cwd: () => ".", conversation: () => "c" }).stream(request(["go"]), controller.signal)) {
        events.push(event);
        if (event.kind === "text") controller.abort();
      }
      expect(events.at(-1)).toEqual({ kind: "stop", reason: "cancelled" });
      expect(agent.started[0]!.killed).toBe(false);
      await vi.advanceTimersByTimeAsync(6_000);
      expect(agent.started[0]!.killed).toBe(true);
      expect(liveProcesses.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("knows when an installed agent is out of date, and how to update it", () => {
    expect(isNewerCliVersion("2.1.284 (Claude Code)", "2.1.330")).toBe(true);
    expect(isNewerCliVersion("opencode 1.19.6", "1.19.6")).toBe(false);
    expect(isNewerCliVersion("1.20.0", "1.19.9")).toBe(false);
    expect(isNewerCliVersion(null, "1.0.0")).toBe(false);
    expect(cliUpdateCommand(CLI_AGENTS.find((agent) => agent.id === "claude")!)).toBe("npm install -g @anthropic-ai/claude-code@latest");
    expect(cliUpdateCommand(CLI_AGENTS.find((agent) => agent.id === "goose")!)).toBeNull();
  });

  it("launches every ACP agent with arguments the shell cannot misread", () => {
    for (const agent of CLI_AGENTS.filter((item) => item.protocol === "acp")) {
      for (const arg of agent.acpArgs ?? []) expect(/^-{1,2}[a-z][a-z-]*$/i.test(arg) || /^[A-Za-z0-9/][\w.:/@+=-]{0,199}$/.test(arg), `${agent.id}: ${arg}`).toBe(true);
      expect(agent.modelProtocol).toBe("acp");
    }
  });
});

import { describe, expect, it } from "vitest";
import { cliAgentFor, cliArgs, unfinishedRunNote, withHeartbeat, cliPrompt, createCliLineParser, createCliProvider, isSafeCliToken, parseModelList, CLI_AGENTS, type CliProcess, type CliSpawn } from "../src/cliAgents.ts";
import type { ProviderEvent, ProviderRequest } from "../src/types.ts";

// Captured from the real CLIs (Claude Code 2.1.284, Codex 0.157.1, OpenCode 1.19.3), trimmed.
const OPENCODE = [
  `{"type":"step_start","timestamp":1793968755235,"sessionID":"ses_e4f213668ffegjeZH9BuHdbh8K","part":{"type":"step-start"}}`,
  `{"type":"text","timestamp":1793968755559,"sessionID":"ses_e4f213668ffegjeZH9BuHdbh8K","part":{"type":"text","text":"ok"}}`,
  `{"type":"step_finish","sessionID":"ses_e4f213668ffegjeZH9BuHdbh8K","part":{"reason":"stop","type":"step-finish","tokens":{"total":7472,"input":7449,"output":23,"reasoning":0,"cache":{"write":0,"read":0}},"cost":0}}`,
];
const CODEX_FAILED = [
  `{"type":"thread.started","thread_id":"01a1b0de-851a-71d3-8bb6-535ecf222e8a"}`,
  `{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Codex is ignoring 1 unrecognized configuration setting."}}`,
  `{"type":"turn.started"}`,
  `{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.\\",\\"code\\":\\"model_not_found\\"}}"}`,
  `{"type":"turn.failed","error":{"message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"message\\":\\"The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.\\"}}"}}`,
];
const CODEX_OK = [
  `{"type":"thread.started","thread_id":"thread-1"}`,
  `{"type":"item.completed","item":{"id":"item_1","type":"reasoning","text":"Looking at the button."}}`,
  `{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"npm test","aggregated_output":"ok","exit_code":0,"status":"completed"}}`,
  `{"type":"item.completed","item":{"id":"item_3","type":"file_change","changes":[{"path":"src/app.ts","kind":"update"}],"status":"completed"}}`,
  `{"type":"item.completed","item":{"id":"item_4","type":"agent_message","text":"Fixed the button."}}`,
  `{"type":"turn.completed","usage":{"input_tokens":1200,"cached_input_tokens":800,"output_tokens":90}}`,
];
const CLAUDE_SIGNED_OUT = [
  `{"type":"system","subtype":"init","session_id":"6808f6e8-529e-4c86-a171-db11be82be01","model":"claude-opus-5-5"}`,
  `{"type":"assistant","message":{"model":"<synthetic>","role":"assistant","content":[{"type":"text","text":"Not logged in · Please run /login"}]}}`,
  `{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login","session_id":"6808f6e8-529e-4c86-a171-db11be82be01","usage":{"input_tokens":0,"output_tokens":0}}`,
];
const CLAUDE_OK = [
  `{"type":"system","subtype":"init","session_id":"s-1","model":"claude-opus-5-5"}`,
  `{"type":"assistant","message":{"model":"claude-opus-5-5","content":[{"type":"text","text":"I'll check the tests."},{"type":"tool_use","name":"Bash","input":{"command":"npm test"}}]}}`,
  `{"type":"user","message":{"content":[{"type":"tool_result","content":"ok"}]}}`,
  `{"type":"assistant","message":{"model":"claude-opus-5-5","content":[{"type":"text","text":"All tests pass."}]}}`,
  `{"type":"result","subtype":"success","is_error":false,"result":"All tests pass.","session_id":"s-1","usage":{"input_tokens":20,"cache_read_input_tokens":900,"output_tokens":40}}`,
];

const request = (texts: string[], extra: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: "default", system: "", tools: [], maxTokens: 1000,
  messages: texts.map((text, index) => ({ role: index % 2 === 0 ? "user" as const : "assistant" as const, content: [{ type: "text" as const, text }] })),
  ...extra,
});

function fakeSpawn(lines: string[], code = 0, stderr = "") {
  const calls: { command: string; args: readonly string[]; cwd: string; input: string }[] = [];
  const spawn: CliSpawn = (command, args, options) => {
    calls.push({ command, args, ...options });
    const process: CliProcess = { lines: (async function* () { yield* lines; })(), exit: Promise.resolve(code), stderr: () => stderr, kill: () => undefined };
    return process;
  };
  return { spawn, calls };
}

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

describe("CLI agents", () => {
  it("reads OpenCode's real JSON events", () => {
    const parse = createCliLineParser("opencode");
    expect(OPENCODE.flatMap(parse)).toEqual([
      { kind: "session", id: "ses_e4f213668ffegjeZH9BuHdbh8K" },
      { kind: "session", id: "ses_e4f213668ffegjeZH9BuHdbh8K" }, { kind: "text", text: "ok" },
      { kind: "session", id: "ses_e4f213668ffegjeZH9BuHdbh8K" }, { kind: "usage", input: 7449, output: 23, cached: 0 }, { kind: "step", reason: "stop" },
    ]);
  });

  it("turns Codex's failed turn into the provider's own message, not a JSON blob", () => {
    const events = CODEX_FAILED.flatMap(createCliLineParser("codex"));
    expect(events[0]).toEqual({ kind: "session", id: "01a1b0de-851a-71d3-8bb6-535ecf222e8a" });
    expect(events.filter((event) => event.kind === "error").map((event) => event.kind === "error" && event.message)).toEqual([
      "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
      "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.",
    ]);
  });

  it("streams a CLI's answer, shows its tool use as activity, and resumes its session next turn", async () => {
    const sessions = new Map<string, { id: string; messages: number }>();
    const first = fakeSpawn(CODEX_OK);
    const codex = CLI_AGENTS.find((agent) => agent.id === "codex")!;
    const provider = createCliProvider({ spec: codex, models: ["default"], spawn: first.spawn, cwd: () => "E:/project", sessions });
    const events = await collect(provider.stream(request(["Fix the button"], { model: "gpt-6-luna" }), new AbortController().signal));
    expect(events.filter((event) => event.kind === "text")).toEqual([{ kind: "text", text: "Fixed the button." }]);
    expect(events.filter((event) => event.kind === "thinking").map((event) => event.kind === "thinking" && event.text)).toEqual(["Looking at the button.\n", "› Ran: npm test\n", "› Changed: src/app.ts\n"]);
    expect(events.at(-2)).toEqual({ kind: "usage", inputTokens: 1200, outputTokens: 90, cachedTokens: 800 });
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "end-turn" });
    expect(first.calls[0]).toMatchObject({ command: "codex", cwd: "E:/project", input: "Fix the button" });
    expect(first.calls[0]!.args).toEqual(["exec", "--json", "--skip-git-repo-check", "--sandbox", "workspace-write", "-m", "gpt-6-luna", "-"]);

    const second = fakeSpawn(CODEX_OK);
    const again = createCliProvider({ spec: codex, models: ["default"], spawn: second.spawn, cwd: () => "E:/project", sessions });
    await collect(again.stream(request(["Fix the button", "Fixed the button.", "Now the header"], { model: "gpt-6-luna" }), new AbortController().signal));
    expect(second.calls[0]!.args.slice(0, 3)).toEqual(["exec", "resume", "thread-1"]);
    expect(second.calls[0]!.input).toBe("Now the header");
  });

  it("says how to sign in when the CLI is signed out, without repeating its message as an answer", async () => {
    const claude = CLI_AGENTS.find((agent) => agent.id === "claude")!;
    const provider = createCliProvider({ spec: claude, models: claude.models, spawn: fakeSpawn(CLAUDE_SIGNED_OUT, 1).spawn, cwd: () => "." });
    const events: ProviderEvent[] = [];
    await expect((async () => { for await (const event of provider.stream(request(["hi"]), new AbortController().signal)) events.push(event); })()).rejects.toThrow("Claude Code: Not logged in · Please run /login Sign in by running `claude` in a terminal");
    expect(events.some((event) => event.kind === "text")).toBe(false);
  });

  it("keeps Claude Code's separate messages apart and counts cached input", async () => {
    const claude = CLI_AGENTS.find((agent) => agent.id === "claude")!;
    const events = await collect(createCliProvider({ spec: claude, models: claude.models, spawn: fakeSpawn(CLAUDE_OK).spawn, cwd: () => "." }).stream(request(["run the tests"]), new AbortController().signal));
    expect(events.filter((event) => event.kind === "text").map((event) => event.kind === "text" && event.text).join("")).toBe("I'll check the tests.\n\nAll tests pass.");
    expect(events).toContainEqual({ kind: "thinking", text: "› Ran: npm test\n" });
    expect(events).toContainEqual({ kind: "usage", inputTokens: 920, outputTokens: 40, cachedTokens: 900 });
  });

  it("explains a failure from stderr when the CLI printed nothing else", async () => {
    const opencode = CLI_AGENTS.find((agent) => agent.id === "opencode")!;
    const provider = createCliProvider({ spec: opencode, models: ["default"], spawn: fakeSpawn([], 1, "Error: no providers configured").spawn, cwd: () => "." });
    await expect(collect(provider.stream(request(["hi"]), new AbortController().signal))).rejects.toThrow("OpenCode: Error: no providers configured");
  });

  it("sends a transcript when a chat that began elsewhere moves to a CLI, and never ADCode's system prompt", () => {
    // The host context in the system prompt names ADCode's own tools (edit_file) and repeats the
    // project's instructions, which the CLI reads for itself: none of it is passed on.
    const system = "ADCode instructions and tools.\nChange files with edit_file. Project instructions: ...";
    const prompt = cliPrompt(request(["What does app.ts do?", "It starts the server.", "Add a health check"], { system, cache: { stableSystem: "ADCode instructions and tools.".length } }), false);
    expect(prompt).toBe("The conversation so far:\nUser: What does app.ts do?\n\nAssistant: It starts the server.\n\nNow:\nAdd a health check");
    expect(prompt).not.toContain("edit_file");
  });

  it("passes the editor's context along inside the newest message, as the agent sent it", () => {
    const ask: ProviderRequest = {
      model: "default", system: "ADCode instructions.\nChange files with edit_file.", cache: { stableSystem: 20 }, tools: [], maxTokens: 1000,
      messages: [{ role: "user", content: [{ type: "text", text: "<adcode-context>\nThe user is looking at src/app.ts, cursor on line 12.\n</adcode-context>" }, { type: "text", text: "fix this" }] }],
    };
    expect(cliPrompt(ask, true)).toBe("<adcode-context>\nThe user is looking at src/app.ts, cursor on line 12.\n</adcode-context>\nfix this");
  });

  it("never puts anything a shell could read into an argument", () => {
    expect(cliArgs("claude", { model: "opus; rm -rf /", session: "$(whoami)" })).toEqual(["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"]);
    expect(cliArgs("opencode", { model: "opencode/big-pickle", session: "ses_1" })).toEqual(["run", "--format", "json", "--thinking", "-m", "opencode/big-pickle", "--session", "ses_1"]);
    expect(isSafeCliToken("nvidia/google/gemma-4-31b-it")).toBe(true);
    expect(isSafeCliToken("a&b")).toBe(false);
    expect(isSafeCliToken("\"x\"")).toBe(false);
  });

  it("gives Claude Code ADCode's tool bridge as a config file, and nobody else", () => {
    const mcp = { configPath: "C:/Users/me/AppData/Roaming/ADCode/tool-bridge-claude.json", server: "adcode" };
    const base = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"];
    expect(cliArgs("claude", { model: "default" })).toEqual(base);
    expect(cliArgs("claude", { model: "opus", session: "abc", mcp })).toEqual([...base, "--model", "opus", "--resume", "abc", "--mcp-config", mcp.configPath, "--allowedTools", "mcp__adcode"]);
    expect(cliArgs("codex", { model: "default", mcp })).toEqual(cliArgs("codex", { model: "default" }));
    expect(cliArgs("gemini", { model: "default", mcp })).toEqual(cliArgs("gemini", { model: "default" }));
    // A path with a space, or a server name a shell could read, drops the bridge rather than the turn.
    expect(cliArgs("claude", { model: "default", mcp: { ...mcp, configPath: "C:/Users/Jo Smith/x.json" } })).toEqual(base);
    expect(cliArgs("claude", { model: "default", mcp: { ...mcp, server: "a&b" } })).toEqual(base);
    expect(isSafeCliToken("mcp__adcode")).toBe(true);
    expect(isSafeCliToken("/home/me/.adcode/tool-bridge-claude.json")).toBe(true);
    expect(isSafeCliToken("--evil")).toBe(false);
  });

  it("asks for the bridge on each Claude Code turn", async () => {
    const claude = CLI_AGENTS.find((agent) => agent.id === "claude")!;
    const fake = fakeSpawn(['{"type":"result","usage":{}}']);
    let asked = 0;
    const provider = createCliProvider({ spec: claude, models: ["default"], spawn: fake.spawn, cwd: () => ".", mcp: () => { asked++; return { configPath: "/tmp/bridge.json", server: "adcode" }; } });
    await collect(provider.stream(request(["hi"]), new AbortController().signal));
    expect(asked).toBe(1);
    expect(fake.calls[0]?.args.slice(-4)).toEqual(["--mcp-config", "/tmp/bridge.json", "--allowedTools", "mcp__adcode"]);
  });

  it("switches each CLI's own permission questions off only while Full access is on", async () => {
    const claude = CLI_AGENTS.find((agent) => agent.id === "claude")!;
    const fake = fakeSpawn(CLAUDE_OK);
    let fullAccess = false;
    const provider = createCliProvider({ spec: claude, models: ["default"], spawn: fake.spawn, cwd: () => ".", bypassPermissions: () => fullAccess });
    await collect(provider.stream(request(["hi"]), new AbortController().signal));
    expect(fake.calls[0]?.args).toContain("--permission-mode");
    expect(fake.calls[0]?.args).not.toContain("--dangerously-skip-permissions");
    // The switch is read per turn, so turning it on applies to the very next message.
    fullAccess = true;
    await collect(provider.stream(request(["hi", "ok", "again"]), new AbortController().signal));
    expect(fake.calls[1]?.args).toContain("--dangerously-skip-permissions");
    expect(fake.calls[1]?.args).not.toContain("--permission-mode");
  });

  it("uses the bypass flag for Claude Code and Codex only when asked", () => {
    expect(cliArgs("claude", { model: "default", bypassPermissions: true })).toContain("--dangerously-skip-permissions");
    expect(cliArgs("claude", { model: "default" })).toContain("acceptEdits");
    expect(cliArgs("codex", { model: "default", bypassPermissions: true })).toContain("--dangerously-bypass-approvals-and-sandbox");
    expect(cliArgs("codex", { model: "default" })).toContain("workspace-write");
  });

  it("reads a model list and maps provider ids back to their CLI", () => {
    expect(parseModelList("opencode/big-pickle\nnvidia/google/gemma-4-31b-it\n\nWARN something\nbad model\n")).toEqual(["opencode/big-pickle", "nvidia/google/gemma-4-31b-it"]);
    expect(cliAgentFor("cli-codex")?.name).toBe("Codex CLI");
    expect(cliAgentFor("codex")).toBeUndefined();
    expect(CLI_AGENTS.find((agent) => agent.id === "freebuff")?.headless).toBe(false);
  });
  it("says why an OpenCode run stopped part way when it turned down its own permission request", async () => {
    // Captured from opencode 1.19.5: a read outside the project, auto-rejected in `run`, and the run ends.
    const lines = [
      `{"type":"step_start","sessionID":"ses_x","part":{"type":"step-start"}}`,
      `{"type":"tool_use","sessionID":"ses_x","part":{"type":"tool","tool":"read","state":{"status":"error","input":{"filePath":"C:\\\\Windows\\\\win.ini"},"error":"The user rejected permission to use this specific tool call."}}}`,
      `{"type":"step_finish","sessionID":"ses_x","part":{"reason":"tool-calls","type":"step-finish","tokens":{"input":75,"output":44,"reasoning":0,"cache":{"read":7808}}}}`,
    ];
    const opencode = CLI_AGENTS.find((agent) => agent.id === "opencode")!;
    const events = await collect(createCliProvider({ spec: opencode, models: ["default"], spawn: fakeSpawn(lines).spawn, cwd: () => "." }).stream(request(["read win.ini"]), new AbortController().signal));
    expect(events).toContainEqual({ kind: "thinking", text: "› read failed: C:\\Windows\\win.ini - The user rejected permission to use this specific tool call.\n" });
    const text = events.filter((event) => event.kind === "text").map((event) => event.kind === "text" && event.text).join("");
    expect(text).toContain("turned down its own permission request for read");
    expect(text).toContain("Full access");
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "end-turn" });
  });

  it("adds no note to a run that answered after its last tool call", async () => {
    const opencode = CLI_AGENTS.find((agent) => agent.id === "opencode")!;
    const events = await collect(createCliProvider({ spec: opencode, models: ["default"], spawn: fakeSpawn(OPENCODE).spawn, cwd: () => "." }).stream(request(["hi"]), new AbortController().signal));
    expect(events.filter((event) => event.kind === "text")).toEqual([{ kind: "text", text: "ok" }]);
    expect(unfinishedRunNote("OpenCode", "stop", [], false)).toBeNull();
    expect(unfinishedRunNote("OpenCode", "tool-calls", [], false)).toContain("continue");
  });

  it("passes OpenCode's own approval switch only under Full access, and streams its thinking", () => {
    expect(cliArgs("opencode", { model: "default" })).toEqual(["run", "--format", "json", "--thinking"]);
    expect(cliArgs("opencode", { model: "default", bypassPermissions: true })).toEqual(["run", "--format", "json", "--thinking", "--auto"]);
  });

  it("keeps each chat's CLI session apart, even when two chats began with the same words", async () => {
    const opencode = CLI_AGENTS.find((agent) => agent.id === "opencode")!;
    const fake = fakeSpawn(OPENCODE);
    let chat = "chat-a";
    const provider = createCliProvider({ spec: opencode, models: ["default"], spawn: fake.spawn, cwd: () => ".", conversation: () => chat });
    await collect(provider.stream(request(["hi"]), new AbortController().signal));
    chat = "chat-b";
    await collect(provider.stream(request(["hi", "ok", "more"]), new AbortController().signal));
    expect(fake.calls[1]?.args).not.toContain("--session");
    chat = "chat-a";
    await collect(provider.stream(request(["hi", "ok", "more"]), new AbortController().signal));
    expect(fake.calls[2]?.args).toContain("--session");
  });

  it("keeps the CLI's session after a failed turn, so continue resumes it", async () => {
    const opencode = CLI_AGENTS.find((agent) => agent.id === "opencode")!;
    const failing = [`{"type":"step_start","sessionID":"ses_f","part":{}}`, `{"type":"error","sessionID":"ses_f","error":{"name":"APIError","data":{"message":"rate limited"}}}`];
    const sessions = new Map<string, { id: string; messages: number }>();
    const first = fakeSpawn(failing, 1);
    await expect(collect(createCliProvider({ spec: opencode, models: ["default"], spawn: first.spawn, cwd: () => ".", sessions, conversation: () => "c" }).stream(request(["build it"]), new AbortController().signal))).rejects.toThrow("rate limited");
    const second = fakeSpawn(OPENCODE);
    await collect(createCliProvider({ spec: opencode, models: ["default"], spawn: second.spawn, cwd: () => ".", sessions, conversation: () => "c" }).stream(request(["build it", "", "continue"]), new AbortController().signal));
    expect(second.calls[0]?.args.slice(-2)).toEqual(["--session", "ses_f"]);
  });

  it("ticks while a CLI says nothing, and stops ticking when it speaks", async () => {
    async function* slow() { await new Promise((resolve) => setTimeout(resolve, 60)); yield "line"; }
    const beats: unknown[] = [];
    for await (const beat of withHeartbeat(slow(), 20)) beats.push("line" in beat ? beat.line : "tick");
    expect(beats.filter((beat) => beat === "tick").length).toBeGreaterThanOrEqual(1);
    expect(beats.at(-1)).toBe("line");
  });
});

describe("what Claude Code's chat says while it works (2026-11-24)", () => {
  const claude = CLI_AGENTS.find((agent) => agent.id === "claude")!;
  const line = (value: unknown): string => JSON.stringify(value);
  const call = (id: string, name: string, input: unknown) => line({ type: "assistant", message: { model: "claude-opus-5-5", stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] } });
  const result = (id: string, content: string) => line({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, is_error: true, content }] } });
  const thinking = (events: ProviderEvent[]) => events.filter((event) => event.kind === "thinking").map((event) => event.kind === "thinking" ? event.text : "");
  const texts = (events: ProviderEvent[]) => events.filter((event) => event.kind === "text").map((event) => event.kind === "text" ? event.text : "").join("");

  it("says what a tool did in words, not Claude Code's tool names", async () => {
    const { claudeToolVerb } = await import("../src/cliAgents.ts");
    expect(claudeToolVerb("Bash")).toBe("Ran");
    expect(claudeToolVerb("TodoWrite")).toBe("Updated its to-do list");
    expect(claudeToolVerb("mcp__adcode__read_file")).toBe("Used adcode read file");
    expect(claudeToolVerb("SomethingNew")).toBe("SomethingNew");
  });

  it("says when a command was not allowed, and how to allow it, even after Claude Code answered", async () => {
    const lines = [
      line({ type: "system", subtype: "init", session_id: "s-9" }),
      call("t1", "Bash", { command: "npm install" }),
      result("t1", "Claude requested permissions to use Bash, but you haven't granted it yet."),
      line({ type: "assistant", message: { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "I need permission to run npm install." }] } }),
      line({ type: "result", subtype: "success", is_error: false, session_id: "s-9", permission_denials: [{ tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "npm install" } }], usage: { input_tokens: 10, output_tokens: 5 } }),
    ];
    const events = await collect(createCliProvider({ spec: claude, models: claude.models, spawn: fakeSpawn(lines).spawn, cwd: () => "." }).stream(request(["set it up"]), new AbortController().signal));
    expect(thinking(events)).toContain("› Ran was not allowed: npm install\n");
    expect(texts(events)).toContain("I need permission to run npm install.");
    // Said once, though both the tool result and the result line report it.
    expect(texts(events).match(/Bash \(npm install\)/g)).toHaveLength(1);
    expect(texts(events)).toContain("Turn on Full access for this chat");
  });

  it("shows a failed tool call as failed, with why", async () => {
    const lines = [
      call("t2", "Read", { file_path: "src/missing.ts" }),
      result("t2", "<tool_use_error>File does not exist.</tool_use_error>"),
      line({ type: "assistant", message: { model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: "That file is not there." }] } }),
      line({ type: "result", subtype: "success", is_error: false, usage: {} }),
    ];
    const events = await collect(createCliProvider({ spec: claude, models: claude.models, spawn: fakeSpawn(lines).spawn, cwd: () => "." }).stream(request(["read it"]), new AbortController().signal));
    expect(thinking(events)).toContain("› Read failed: src/missing.ts - File does not exist.\n");
    expect(texts(events)).toBe("That file is not there.");
  });

  it("says when Claude Code stopped straight after a tool call", async () => {
    const lines = [call("t3", "Edit", { file_path: "a.ts" }), line({ type: "result", subtype: "success", is_error: false, usage: {} })];
    const events = await collect(createCliProvider({ spec: claude, models: claude.models, spawn: fakeSpawn(lines).spawn, cwd: () => "." }).stream(request(["edit"]), new AbortController().signal));
    expect(texts(events)).toContain("ended its run straight after a tool call");
  });

  it("turns a plan limit and an empty failure into something a person can act on", async () => {
    const { claudeErrorText } = await import("../src/cliAgents.ts");
    expect(claudeErrorText("Claude AI usage limit reached|1764000000", "")).toMatch(/^your Claude plan's usage limit is reached\. It resets at .+ Pick another model/);
    expect(claudeErrorText("", "error_max_turns")).toContain("continue");
    expect(claudeErrorText("Prompt is too long", "error_during_execution")).toBe("Prompt is too long");
  });
});

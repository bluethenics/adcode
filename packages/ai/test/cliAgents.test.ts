import { describe, expect, it } from "vitest";
import { cliAgentFor, cliArgs, cliPrompt, createCliLineParser, createCliProvider, isSafeCliToken, parseModelList, CLI_AGENTS, type CliProcess, type CliSpawn } from "../src/cliAgents.ts";
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
      { kind: "session", id: "ses_e4f213668ffegjeZH9BuHdbh8K" }, { kind: "usage", input: 7449, output: 23, cached: 0 },
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
    expect(events).toContainEqual({ kind: "thinking", text: "› Bash: npm test\n" });
    expect(events).toContainEqual({ kind: "usage", inputTokens: 920, outputTokens: 40, cachedTokens: 900 });
  });

  it("explains a failure from stderr when the CLI printed nothing else", async () => {
    const opencode = CLI_AGENTS.find((agent) => agent.id === "opencode")!;
    const provider = createCliProvider({ spec: opencode, models: ["default"], spawn: fakeSpawn([], 1, "Error: no providers configured").spawn, cwd: () => "." });
    await expect(collect(provider.stream(request(["hi"]), new AbortController().signal))).rejects.toThrow("OpenCode: Error: no providers configured");
  });

  it("sends a transcript when a chat that began elsewhere moves to a CLI, with the editor's live context", () => {
    const system = "ADCode instructions and tools.\nOpen file: src/app.ts, line 12";
    const prompt = cliPrompt(request(["What does app.ts do?", "It starts the server.", "Add a health check"], { system, cache: { stableSystem: "ADCode instructions and tools.".length } }), false);
    expect(prompt).toBe("Context from the ADCode editor:\nOpen file: src/app.ts, line 12\n\nThe conversation so far:\nUser: What does app.ts do?\n\nAssistant: It starts the server.\n\nNow:\nAdd a health check");
    expect(prompt).not.toContain("ADCode instructions");
  });

  it("never puts anything a shell could read into an argument", () => {
    expect(cliArgs("claude", { model: "opus; rm -rf /", session: "$(whoami)" })).toEqual(["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits"]);
    expect(cliArgs("opencode", { model: "opencode/big-pickle", session: "ses_1" })).toEqual(["run", "--format", "json", "-m", "opencode/big-pickle", "--session", "ses_1"]);
    expect(isSafeCliToken("nvidia/google/gemma-4-31b-it")).toBe(true);
    expect(isSafeCliToken("a&b")).toBe(false);
    expect(isSafeCliToken("\"x\"")).toBe(false);
  });

  it("reads a model list and maps provider ids back to their CLI", () => {
    expect(parseModelList("opencode/big-pickle\nnvidia/google/gemma-4-31b-it\n\nWARN something\nbad model\n")).toEqual(["opencode/big-pickle", "nvidia/google/gemma-4-31b-it"]);
    expect(cliAgentFor("cli-codex")?.name).toBe("Codex CLI");
    expect(cliAgentFor("codex")).toBeUndefined();
    expect(CLI_AGENTS.find((agent) => agent.id === "freebuff")?.headless).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { CLI_AGENTS, DECLINED_IN_ADCODE, cliLiveArgs, createCliLineParser, createCliProvider, isClaudeResultLine, parseClaudeControlRequest, type CliLiveEntry, type CliLiveProcess, type CliLiveSpawn, type CliPermissionAnswer, type CliPermissionAsk, type CliSpawn } from "../src/cliAgents.ts";
import type { ProviderEvent, ProviderRequest } from "../src/types.ts";

// Claude Code 2.1.284 with --include-partial-messages, trimmed: the words arrive as deltas,
// then the whole message repeats them.
const turn = (session: string, words: string[]): string[] => [
  `{"type":"system","subtype":"init","session_id":"${session}"}`,
  `{"type":"stream_event","event":{"type":"message_start","message":{}},"session_id":"${session}"}`,
  `{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},"session_id":"${session}"}`,
  ...words.map((word) => `{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(word)}}},"session_id":"${session}"}`),
  `{"type":"assistant","message":{"model":"claude-haiku-5-5","content":[{"type":"text","text":${JSON.stringify(words.join(""))}}]},"session_id":"${session}"}`,
  `{"type":"stream_event","event":{"type":"message_stop"},"session_id":"${session}"}`,
  `{"type":"result","subtype":"success","is_error":false,"session_id":"${session}","usage":{"input_tokens":10,"output_tokens":5}}`,
];

const claude = CLI_AGENTS.find((agent) => agent.id === "claude")!;
const request = (texts: string[], model = "default"): ProviderRequest => ({
  model, system: "", tools: [], maxTokens: 1000,
  messages: texts.map((text, index) => ({ role: index % 2 === 0 ? "user" as const : "assistant" as const, content: [{ type: "text" as const, text }] })),
});

/** A kept process that answers each message with the next scripted turn. */
function fakeLive(turns: string[][]) {
  const started: { args: readonly string[]; sent: string[]; killed: boolean }[] = [];
  const live: CliLiveSpawn = (_command, args) => {
    const record = { args, sent: [] as string[], killed: false };
    started.push(record);
    const queue: string[] = [];
    const waiting: ((line: string | null) => void)[] = [];
    const push = (line: string | null): void => { const resolve = waiting.shift(); if (resolve) resolve(line); else if (line !== null) queue.push(line); };
    const process: CliLiveProcess = {
      next: () => (queue.length > 0 ? Promise.resolve(queue.shift()!) : record.killed ? Promise.resolve(null) : new Promise((resolve) => waiting.push(resolve))),
      send: (line) => { record.sent.push(line); for (const out of turns.shift() ?? []) push(out); },
      alive: () => !record.killed,
      exit: new Promise(() => undefined),
      stderr: () => "",
      kill: () => { record.killed = true; for (const resolve of waiting.splice(0)) resolve(null); },
    };
    return process;
  };
  return { live, started };
}

const noSpawn: CliSpawn = () => { throw new Error("a kept process should have been used"); };

async function texts(stream: AsyncIterable<ProviderEvent>): Promise<string> {
  let out = "";
  for await (const event of stream) if (event.kind === "text") out += event.text;
  return out;
}

describe("Claude Code kept running between turns", () => {
  it("asks for streamed words on stream-json input, before the options that take several values", () => {
    const args = cliLiveArgs("claude", { model: "opus", mcp: { configPath: "/tmp/b.json", server: "adcode" } })!;
    expect(args.slice(0, 5)).toEqual(["-p", "--input-format", "stream-json", "--include-partial-messages", "--output-format"]);
    expect(args.at(-2)).toBe("--allowedTools");
    expect(cliLiveArgs("codex", { model: "default" })).toBeNull();
  });

  it("shows streamed words once, joined, and still reports tools from the whole message", () => {
    const parse = createCliLineParser("claude");
    const events = [...turn("s", ["Hel", "lo"]), `{"type":"assistant","message":{"model":"m","content":[{"type":"tool_use","name":"Read","input":{"file_path":"a.ts"}}]}}`].flatMap(parse);
    expect(events.filter((event) => event.kind === "text")).toEqual([{ kind: "text", text: "Hel" }, { kind: "text", text: "lo", joined: true }]);
    expect(events).toContainEqual({ kind: "tool", tool: { id: "claude-tool-1", name: "Read", kind: "read", detail: "a.ts", status: "running" } });
    expect(isClaudeResultLine(turn("s", [])[4]!)).toBe(false);
    expect(isClaudeResultLine(turn("s", []).at(-1)!)).toBe(true);
  });

  it("answers a chat's next turn from the same process, sending only the new message", async () => {
    const fake = fakeLive([turn("s-1", ["Hel", "lo"]), turn("s-1", ["Bye"])]);
    const liveProcesses = new Map<string, CliLiveEntry>();
    const sessions = new Map<string, { id: string; messages: number }>();
    const provider = () => createCliProvider({ spec: claude, models: ["default"], spawn: noSpawn, live: fake.live, liveProcesses, sessions, cwd: () => ".", conversation: () => "chat-1" });
    expect(await texts(provider().stream(request(["hi"]), new AbortController().signal))).toBe("Hello");
    expect(await texts(provider().stream(request(["hi", "Hello", "say bye"]), new AbortController().signal))).toBe("Bye");
    expect(fake.started).toHaveLength(1);
    expect(fake.started[0]!.killed).toBe(false);
    expect(fake.started[0]!.sent.map((line) => JSON.parse(line).message.content[0].text)).toEqual(["hi", "say bye"]);
    liveProcesses.forEach((entry) => entry.process.kill());
  });

  it("starts a new process resuming the session when the model changes, and stops the old one", async () => {
    const fake = fakeLive([turn("s-1", ["A"]), turn("s-1", ["B"])]);
    const liveProcesses = new Map<string, CliLiveEntry>();
    const sessions = new Map<string, { id: string; messages: number }>();
    const provider = () => createCliProvider({ spec: claude, models: ["default", "opus"], spawn: noSpawn, live: fake.live, liveProcesses, sessions, cwd: () => ".", conversation: () => "chat-1" });
    await texts(provider().stream(request(["hi"], "opus"), new AbortController().signal));
    // Sessions are kept per model, so the same model continues while another starts afresh.
    await texts(provider().stream(request(["hi", "A", "more"], "opus"), new AbortController().signal));
    expect(fake.started).toHaveLength(1);
    const fake2 = fakeLive([turn("s-2", ["C"])]);
    sessions.set("claude:opus:chat:chat-1", { id: "s-1", messages: 3 });
    const fullAccess = createCliProvider({ spec: claude, models: ["opus"], spawn: noSpawn, live: fake2.live, liveProcesses, sessions, cwd: () => ".", conversation: () => "chat-1", bypassPermissions: () => true });
    expect(await texts(fullAccess.stream(request(["hi", "A", "more", "B", "go"], "opus"), new AbortController().signal))).toBe("C");
    expect(fake.started[0]!.killed).toBe(true);
    expect(fake2.started[0]!.args).toContain("--dangerously-skip-permissions");
    expect(fake2.started[0]!.args.slice(-6)).toContain("s-1");
    liveProcesses.forEach((entry) => entry.process.kill());
  });

  it("stops and forgets the process when the person stops the turn", async () => {
    const fake = fakeLive([[`{"type":"system","subtype":"init","session_id":"s-1"}`]]);
    const liveProcesses = new Map<string, CliLiveEntry>();
    const controller = new AbortController();
    const stream = createCliProvider({ spec: claude, models: ["default"], spawn: noSpawn, live: fake.live, liveProcesses, cwd: () => ".", heartbeatMs: 20 }).stream(request(["hi"]), controller.signal);
    const events: ProviderEvent[] = [];
    for await (const event of stream) { events.push(event); if (event.kind === "status") controller.abort(); }
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "cancelled" });
    expect(fake.started[0]!.killed).toBe(true);
    expect(liveProcesses.size).toBe(0);
  });
});

// Claude Code 2.1.284 with --permission-prompt-tool stdio, asked to run a command acceptEdits does
// not cover: the request line as it printed it, then (after the answer) the rest of the turn.
const PERMISSION_REQUEST = `{"type":"control_request","request_id":"7c32d8b2","request":{"subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash","input":{"command":"node -e \\"console.log(40+2)\\"","description":"Run Node.js"},"description":"Run Node.js","permission_suggestions":[{"type":"addRules","rules":[{"toolName":"Bash","ruleContent":"node -e \\"console.log(40+2)\\""}],"behavior":"allow","destination":"localSettings"}],"decision_reason":"This command requires approval","decision_reason_type":"other","tool_use_id":"toolu_015K"}}`;
const askingTurn = (result: string, isError: boolean, denials: string): string[] => [
  `{"type":"system","subtype":"init","session_id":"s-1"}`,
  `{"type":"assistant","message":{"model":"claude-haiku-5-5","content":[{"type":"tool_use","id":"toolu_015K","name":"Bash","input":{"command":"node -e \\"console.log(40+2)\\""}}],"stop_reason":"tool_use"},"session_id":"s-1"}`,
  PERMISSION_REQUEST,
  `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_015K","content":${JSON.stringify(result)},"is_error":${isError}}]},"session_id":"s-1"}`,
  `{"type":"assistant","message":{"model":"claude-haiku-5-5","content":[{"type":"text","text":${JSON.stringify(isError ? "I could not run it." : "42")}}],"stop_reason":"end_turn"},"session_id":"s-1"}`,
  `{"type":"result","subtype":"success","is_error":false,"session_id":"s-1","usage":{"input_tokens":10,"output_tokens":5},"permission_denials":${denials}}`,
];

describe("Claude Code asks the person before a tool its settings leave open", () => {
  async function run(answer: CliPermissionAnswer | null, lines: string[]) {
    const fake = fakeLive([lines]);
    const liveProcesses = new Map<string, CliLiveEntry>();
    const asked: CliPermissionAsk[] = [];
    const provider = createCliProvider({
      spec: claude, models: ["default"], spawn: noSpawn, live: fake.live, liveProcesses, cwd: () => ".", conversation: () => "chat-1",
      ...(answer === null ? {} : { askPermission: async (ask: CliPermissionAsk) => { asked.push(ask); return answer; } }),
    });
    const events: ProviderEvent[] = [];
    for await (const event of provider.stream(request(["run it"]), new AbortController().signal)) events.push(event);
    liveProcesses.forEach((entry) => entry.process.kill());
    const replies = fake.started[0]!.sent.slice(1).map((line) => JSON.parse(line));
    return { events, asked, replies, args: fake.started[0]!.args };
  }

  it("starts the kept process with permission questions sent to ADCode, except under Full access", () => {
    const args = cliLiveArgs("claude", { model: "default" })!;
    expect(args.slice(args.indexOf("--permission-prompt-tool"), args.indexOf("--permission-prompt-tool") + 2)).toEqual(["--permission-prompt-tool", "stdio"]);
    expect(cliLiveArgs("claude", { model: "default", bypassPermissions: true })).not.toContain("--permission-prompt-tool");
  });

  it("reads the request Claude Code prints", () => {
    expect(parseClaudeControlRequest(PERMISSION_REQUEST)).toMatchObject({ requestId: "7c32d8b2", subtype: "can_use_tool", tool: "Bash", toolUseId: "toolu_015K", reason: "This command requires approval" });
    expect(parseClaudeControlRequest(`{"type":"result","subtype":"success"}`)).toBeNull();
  });

  it("asks in plain words, and an Allow runs the call with its input unchanged", async () => {
    const out = await run("allow", askingTurn("42", false, "[]"));
    expect(out.asked).toEqual([{ agent: "Claude Code", action: "run a command", tool: "Bash", detail: `node -e "console.log(40+2)"`, reason: "This command requires approval" }]);
    expect(out.replies).toEqual([{ type: "control_response", response: { subtype: "success", request_id: "7c32d8b2", response: { behavior: "allow", updatedInput: { command: `node -e "console.log(40+2)"`, description: "Run Node.js" } } } }]);
    expect(out.events).toContainEqual({ kind: "status", text: `Claude Code asks to run a command: node -e "console.log(40+2)" - waiting for your answer` });
    expect(out.events.filter((event) => event.kind === "text").map((event) => event.kind === "text" && event.text).join("")).toBe("42");
  });

  it("keeps an Allow for this chat to the session: no settings file is written", async () => {
    const out = await run("session", askingTurn("42", false, "[]"));
    expect(out.replies[0].response.response.updatedPermissions).toEqual([{ type: "addRules", rules: [{ toolName: "Bash", ruleContent: `node -e "console.log(40+2)"` }], behavior: "allow", destination: "session" }]);
  });

  it("passes a Deny on, and does not then tell the person to turn on Full access", async () => {
    const out = await run("deny", askingTurn(DECLINED_IN_ADCODE, true, `[{"tool_name":"Bash","tool_use_id":"toolu_015K","tool_input":{"command":"node"}}]`));
    expect(out.replies[0].response.response).toEqual({ behavior: "deny", message: DECLINED_IN_ADCODE });
    const said = out.events.map((event) => ("text" in event ? event.text : "")).join("");
    expect(said).toContain("› You declined: Bash");
    expect(said).not.toContain("Full access");
    expect(said).not.toContain("Bash failed");
  });

  it("refuses by itself when nobody can be asked, and says where the switch is", async () => {
    const out = await run(null, askingTurn("This command requires approval", true, `[{"tool_name":"Bash","tool_use_id":"toolu_015K","tool_input":{"command":"node"}}]`));
    expect(out.replies[0].response.response.behavior).toBe("deny");
    expect(out.events.map((event) => ("text" in event ? event.text : "")).join("")).toContain("Turn on Full access");
  });

  it("never leaves Claude Code waiting on a request ADCode does not handle", async () => {
    const out = await run("allow", [`{"type":"control_request","request_id":"r-9","request":{"subtype":"elicitation"}}`, ...turn("s-1", ["ok"])]);
    expect(out.replies).toEqual([{ type: "control_response", response: { subtype: "error", request_id: "r-9", error: "ADCode does not answer elicitation request." } }]);
  });
});
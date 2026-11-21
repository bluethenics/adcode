import { describe, expect, it } from "vitest";
import { CLI_AGENTS, cliLiveArgs, createCliLineParser, createCliProvider, isClaudeResultLine, type CliLiveEntry, type CliLiveProcess, type CliLiveSpawn, type CliSpawn } from "../src/cliAgents.ts";
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
    expect(events).toContainEqual({ kind: "thinking", text: "› Read: a.ts\n" });
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

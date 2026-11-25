import { describe, expect, it } from "vitest";
import { CLI_AGENTS, CLI_BRIDGE_TOKEN_ENV, CodexUsage, codexAppServerArgs, codexApprovalReply, codexCommandText, codexEvents, codexRequestPlan, codexThreadParams, codexTurnState, createCodexProvider, type CliLiveEntry, type CliLiveProcess, type CliLiveSpawn, type CliPermissionAnswer, type CliPermissionAsk, type CliSpawn } from "../src/index.ts";
import type { ProviderEvent, ProviderRequest } from "../src/types.ts";

/*
 * Lines from real turns of codex-cli 0.172.0 (`codex app-server`, gpt-5.6-luna, 25 Nov 2026),
 * trimmed: the long thread objects and timing fields are left out, and the scratch folder the
 * probe ran in reads as E:\project. Everything else - method names, field names, the order the
 * lines came in - is as Codex sent it.
 */
const THREAD = "01a21382-8842-7ab3-8035-a58c45166502";
const TURN = "01a21382-88e1-73b0-b639-76ee76d84c6c";
const CWD = "E:\\project";
const MSG1 = "msg_098661f7f9dd3017016b070ae815e487d0a22217094adfca8e";
const MSG2 = "msg_098661f7f9dd3017016b070af38b7087d087929139fb420d11";
const EXEC = "exec-a902d10b-0b66-4c0d-823d-6d972123a907";
const PATCH = "exec-56e752f8-18f8-4f20-a072-59c46b25a70b";
const POWERSHELL = "\"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command 'node -e \"console.log(6*7)\"'";

const delta = (itemId: string, text: string) => ({ method: "item/agentMessage/delta", params: { threadId: THREAD, turnId: TURN, itemId, delta: text } });
const agentMessage = (id: string, text: string, phase: string) => ({ type: "agentMessage", moderation: null, id, text, phase, memoryCitation: null, delivery: null, questions: null });
const commandItem = (status: string, extra: Record<string, unknown> = {}) => ({ type: "commandExecution", id: EXEC, pluginId: null, scriptPath: null, command: POWERSHELL, cwd: CWD, processId: null, source: "agent", status, commandActions: [{ type: "unknown", command: "node -e \"console.log(6*7)\"" }], aggregatedOutput: null, exitCode: null, durationMs: null, ...extra });
const fileItem = (status: string) => ({ type: "fileChange", id: PATCH, changes: [{ path: `${CWD}\\hello.txt`, kind: { type: "add" }, diff: "42\n" }], status });
const usage = (turnId: string, total: [number, number, number], last: [number, number, number]) => ({
  method: "thread/tokenUsage/updated",
  params: { threadId: THREAD, turnId, tokenUsage: {
    total: { totalTokens: total[0] + total[2], inputTokens: total[0], cachedInputTokens: total[1], cacheWriteInputTokens: 0, outputTokens: total[2], reasoningOutputTokens: 21 },
    last: { totalTokens: last[0] + last[2], inputTokens: last[0], cachedInputTokens: last[1], cacheWriteInputTokens: 0, outputTokens: last[2], reasoningOutputTokens: 0 },
    modelContextWindow: 258400,
  } },
});

/** "Run `node -e "console.log(6*7)"` and create hello.txt with the output", under approvalPolicy untrusted. */
const COMMAND_APPROVAL = { method: "item/commandExecution/requestApproval", id: 0, params: { kind: "command", threadId: THREAD, turnId: TURN, itemId: EXEC, startedAtMs: 1795623660574, environmentId: "local", command: POWERSHELL, cwd: CWD, commandActions: [{ type: "unknown", command: "node -e \"console.log(6*7)\"" }], proposedExecpolicyAmendment: ["node", "-e", "console.log(6*7)"], availableDecisions: ["accept", { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["node", "-e", "console.log(6*7)"] } }, "cancel"] } };
const FILE_APPROVAL = { method: "item/fileChange/requestApproval", id: 1, params: { threadId: THREAD, turnId: TURN, itemId: PATCH, startedAtMs: 1795623664744, reason: null, grantRoot: null } };
/** Codex asking before an MCP tool that is not marked read-only (Roblox Studio's execute_luau), tool description cut. */
const MCP_APPROVAL = { method: "mcpServer/elicitation/request", id: 0, params: { threadId: THREAD, turnId: TURN, serverName: "Roblox_Studio", environmentId: null, mode: "form", _meta: { codex_approval_kind: "mcp_tool_call", persist: ["session", "always"], tool_name: "execute_luau", tool_annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, tool_description: "Executes Luau code in Roblox Studio.", tool_params: { code: "print(1)", datamodel_type: "Edit", studio_id: "" }, tool_params_display: [{ name: "code", value: "print(1)", display_name: "code" }, { name: "datamodel_type", value: "Edit", display_name: "datamodel_type" }] }, message: "Allow the Roblox_Studio MCP server to run tool \"execute_luau\"?", requestedSchema: { type: "object", properties: {} } } };

/** The turn after the approvals, in order. */
const TURN_LINES: unknown[] = [
  { method: "turn/started", params: { threadId: THREAD, turn: { id: TURN, items: [], status: "inProgress", error: null } } },
  { method: "item/started", params: { item: { type: "reasoning", id: "rs_1", summary: [], content: [] }, threadId: THREAD, turnId: TURN } },
  { method: "item/completed", params: { item: { type: "reasoning", id: "rs_1", summary: [], content: [] }, threadId: THREAD, turnId: TURN } },
  { method: "item/started", params: { item: agentMessage(MSG1, "", "commentary"), threadId: THREAD, turnId: TURN } },
  ...["I", "’ll", " run", " the", " command", " and", " save", " its", " output", " to", " `", "hello", ".txt", "`."].map((word) => delta(MSG1, word)),
  { method: "item/completed", params: { item: agentMessage(MSG1, "I’ll run the command and save its output to `hello.txt`.", "commentary"), threadId: THREAD, turnId: TURN } },
];
const AFTER_COMMAND: unknown[] = [
  { method: "item/commandExecution/outputDelta", params: { threadId: THREAD, turnId: TURN, itemId: EXEC, delta: "42\n" } },
  { method: "item/completed", params: { item: commandItem("completed", { processId: "86884", aggregatedOutput: "42\n", exitCode: 0, durationMs: 511 }), threadId: THREAD, turnId: TURN } },
  usage(TURN, [13509, 0, 164], [13509, 0, 164]),
  { method: "item/started", params: { item: fileItem("inProgress"), threadId: THREAD, turnId: TURN } },
];
const AFTER_FILE: unknown[] = [
  { method: "item/completed", params: { item: fileItem("completed"), threadId: THREAD, turnId: TURN } },
  usage(TURN, [27255, 13312, 266], [13746, 13312, 102]),
  { method: "item/started", params: { item: agentMessage(MSG2, "", "final_answer"), threadId: THREAD, turnId: TURN } },
  ...["Ran", " the", " command", " and", " created", " `", "hello", ".txt", "`", " containing", " `", "42", "`."].map((word) => delta(MSG2, word)),
  { method: "item/completed", params: { item: agentMessage(MSG2, "Ran the command and created `hello.txt` containing `42`.", "final_answer"), threadId: THREAD, turnId: TURN } },
  usage(TURN, [41175, 26880, 283], [13920, 13568, 17]),
  { method: "turn/completed", params: { threadId: THREAD, turn: { id: TURN, items: [], status: "completed", error: null } } },
];
/** The configured default model, refused for a free ChatGPT account. */
const MODEL_REFUSED: unknown[] = [
  { method: "error", params: { error: { message: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.", codexErrorInfo: "modelNotFound", additionalDetails: null }, willRetry: false, threadId: THREAD, turnId: TURN } },
  { method: "turn/completed", params: { threadId: THREAD, turn: { id: TURN, items: [], status: "failed", error: { message: "The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.", codexErrorInfo: "modelNotFound", additionalDetails: null } } } },
];

const codex = CLI_AGENTS.find((agent) => agent.id === "codex")!;
const request = (texts: string[], model = "default"): ProviderRequest => ({
  model, system: "", tools: [], maxTokens: 1000,
  messages: texts.map((text, index) => ({ role: index % 2 === 0 ? "user" as const : "assistant" as const, content: [{ type: "text" as const, text }] })),
});

interface Started { command: string; args: readonly string[]; env: Readonly<Record<string, string>> | undefined; received: { id?: number; method: string; params: Record<string, unknown> }[]; replies: { id?: unknown; result?: unknown; error?: unknown }[]; killed: boolean }
interface Script {
  emit: (message: unknown) => void;
  /** Sends a request to ADCode and resolves with its answer. */
  ask: (message: { method: string; id: number; params: unknown }) => Promise<{ result?: unknown; error?: unknown }>;
  params: Record<string, unknown>;
}
type TurnScript = (script: Script) => Promise<void> | void;

/**
 * A `codex app-server`: answers the handshake and threads like the real one, and plays `turn`
 * after each `turn/start`. `resumable` decides whether `thread/resume` finds the thread.
 */
function fakeCodex(turn: TurnScript, options: { resumable?: boolean } = {}) {
  const started: Started[] = [];
  const live: CliLiveSpawn = (command, args, spawnOptions) => {
    const record: Started = { command, args, env: spawnOptions.env, received: [], replies: [], killed: false };
    started.push(record);
    const queue: string[] = [];
    const waiting: ((line: string | null) => void)[] = [];
    const answers = new Map<unknown, (reply: { result?: unknown; error?: unknown }) => void>();
    const emit = (message: unknown): void => { const line = JSON.stringify(message); const resolve = waiting.shift(); if (resolve) resolve(line); else queue.push(line); };
    const answer = (id: number, result: unknown): void => { setTimeout(() => emit({ id, result }), 1); };
    const process: CliLiveProcess = {
      next: () => (queue.length > 0 ? Promise.resolve(queue.shift()!) : record.killed ? Promise.resolve(null) : new Promise((resolve) => waiting.push(resolve))),
      send: (line) => {
        const message = JSON.parse(line) as { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: unknown };
        if (message.method === undefined) { record.replies.push(message); answers.get(message.id)?.(message); return; }
        record.received.push({ ...(message.id === undefined ? {} : { id: message.id }), method: message.method, params: message.params ?? {} });
        const id = message.id;
        if (id === undefined) return;
        switch (message.method) {
          case "initialize": answer(id, { userAgent: "adcode/0.172.0 (Windows 10.0.26200; x86_64)", codexHome: "C:\\Users\\me\\.codex", platformFamily: "windows", platformOs: "windows" }); break;
          case "thread/start": answer(id, { thread: { id: THREAD, sessionId: THREAD, preview: "", ephemeral: false, status: { type: "idle" } }, model: "gpt-5.6-luna", approvalPolicy: message.params?.["approvalPolicy"], sandbox: { type: "workspaceWrite" } }); break;
          case "thread/resume":
            if (options.resumable === false) setTimeout(() => emit({ id, error: { code: -32600, message: `no rollout found for thread id ${String(message.params?.["threadId"])}` } }), 1);
            else answer(id, { thread: { id: message.params?.["threadId"], status: { type: "idle" } } });
            break;
          case "turn/start":
            answer(id, { turn: { id: TURN, items: [], itemsView: "notLoaded", status: "inProgress", error: null } });
            setTimeout(() => { void turn({ emit, params: message.params ?? {}, ask: (request) => new Promise((resolve) => { answers.set(request.id, resolve); emit(request); }) }); }, 2);
            break;
          case "turn/interrupt":
            answer(id, {});
            setTimeout(() => emit({ method: "turn/completed", params: { threadId: THREAD, turn: { id: TURN, items: [], status: "interrupted", error: null } } }), 3);
            break;
          default: setTimeout(() => emit({ id, error: { code: -32601, message: "unknown method" } }), 1);
        }
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

/** The real turn, approvals and all. */
const realTurn: TurnScript = async ({ emit, ask }) => {
  for (const line of TURN_LINES) emit(line);
  emit({ method: "item/started", params: { item: commandItem("inProgress"), threadId: THREAD, turnId: TURN } });
  const first = await ask(COMMAND_APPROVAL);
  if ((first.result as { decision?: string }).decision === "decline") {
    emit({ method: "item/completed", params: { item: commandItem("declined"), threadId: THREAD, turnId: TURN } });
    emit({ method: "item/started", params: { item: agentMessage("msg_3", "", "final_answer"), threadId: THREAD, turnId: TURN } });
    emit(delta("msg_3", "Permission to run it was not granted."));
    emit({ method: "turn/completed", params: { threadId: THREAD, turn: { id: TURN, items: [], status: "completed", error: null } } });
    return;
  }
  for (const line of AFTER_COMMAND) emit(line);
  await ask(FILE_APPROVAL);
  for (const line of AFTER_FILE) emit(line);
};

const words = (text: string): TurnScript => ({ emit }) => {
  emit({ method: "turn/started", params: { threadId: THREAD, turn: { id: TURN, items: [], status: "inProgress", error: null } } });
  emit(delta("msg_w", text));
  emit({ method: "turn/completed", params: { threadId: THREAD, turn: { id: TURN, items: [], status: "completed", error: null } } });
};

const noSpawn: CliSpawn = () => { throw new Error("a chat with a running Codex never uses codex exec"); };

async function collect(stream: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const events: ProviderEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
const textOf = (events: ProviderEvent[]): string => events.map((event) => (event.kind === "text" ? event.text : "")).join("");
const thinkingOf = (events: ProviderEvent[]): string => events.map((event) => (event.kind === "thinking" ? event.text : "")).join("");
const methods = (started: Started): string[] => started.received.map((message) => message.method);

describe("Codex over app-server: reading it", () => {
  it("streams words, joins a message's words and starts a new block for the next message", () => {
    const state = codexTurnState(CWD);
    const events = [...TURN_LINES, ...AFTER_COMMAND, ...AFTER_FILE].flatMap((line) => codexEvents((line as { method: string }).method, (line as { params: unknown }).params, state));
    const texts = events.filter((event) => event.kind === "text");
    expect(texts[0]).toEqual({ kind: "text", text: "I" });
    expect(texts[1]).toEqual({ kind: "text", text: "’ll", joined: true });
    // The second message's first word is a new block; the finished copies are not shown again.
    expect(texts.filter((event) => event.kind === "text" && event.joined !== true).map((event) => (event as { text: string }).text)).toEqual(["I", "Ran"]);
    expect(texts.map((event) => (event as { text: string }).text).join("")).toBe("I’ll run the command and save its output to `hello.txt`.Ran the command and created `hello.txt` containing `42`.");
    const lines = events.filter((event) => event.kind === "thinking").map((event) => (event as { text: string }).text);
    expect(lines).toContain("› Ran: node -e \"console.log(6*7)\"\n");
    expect(lines).toContain("› Changed: hello.txt\n");
  });

  it("shows a message or reasoning that came whole, and says what failed or was refused", () => {
    const state = codexTurnState(CWD);
    expect(codexEvents("item/completed", { item: agentMessage("m", "Done.", "final_answer") }, state)).toEqual([{ kind: "text", text: "Done." }]);
    expect(codexEvents("item/completed", { item: { type: "reasoning", id: "r", summary: ["Checking the tests"], content: [] } }, state)).toEqual([{ kind: "thinking", text: "Checking the tests\n" }]);
    expect(codexEvents("item/completed", { item: commandItem("failed", { exitCode: 1 }) }, state)).toEqual([{ kind: "thinking", text: "› Ran: node -e \"console.log(6*7)\" (exit 1)\n" }]);
    expect(codexEvents("item/completed", { item: commandItem("declined") }, state)).toEqual([{ kind: "thinking", text: "› Not allowed: node -e \"console.log(6*7)\"\n" }]);
    state.declined.add(EXEC);
    expect(codexEvents("item/completed", { item: commandItem("declined") }, state)).toEqual([]);
    expect(codexEvents("item/completed", { item: { type: "mcpToolCall", id: "t", server: "adcode", tool: "read_file", status: "completed" } }, state)).toEqual([{ kind: "thinking", text: "› Used: adcode read_file\n" }]);
    expect(codexEvents("turn/plan/updated", { plan: [{ step: "Read the code", status: "completed" }, { step: "Fix it", status: "inProgress" }] }, state)).toEqual([{ kind: "thinking", text: "✓ Read the code\n· Fix it\n" }]);
    expect(codexEvents("error", { error: { message: "stream disconnected" }, willRetry: true }, state)[0]).toMatchObject({ kind: "status" });
    expect(codexEvents("error", (MODEL_REFUSED[0] as { params: unknown }).params, state)).toEqual([]);
  });

  it("reads the command Codex asked for, not its PowerShell wrapper", () => {
    expect(codexCommandText(COMMAND_APPROVAL.params)).toBe("node -e \"console.log(6*7)\"");
    expect(codexCommandText({ command: "ls -la" })).toBe("ls -la");
  });

  it("counts one turn's tokens as the growth of the thread's totals", () => {
    const fresh = new CodexUsage();
    fresh.start(TURN);
    for (const line of [AFTER_COMMAND[2], AFTER_FILE[1], AFTER_FILE.at(-2)]) fresh.update((line as { params: unknown }).params);
    expect([fresh.input, fresh.cached, fresh.output]).toEqual([41175, 26880, 283]);

    // A resumed thread first reports its old total (from the earlier turn): that is the starting point.
    const resumed = new CodexUsage();
    resumed.update(usage(TURN, [41175, 26880, 283], [13920, 13568, 17]).params);
    const next = "01a21384-24bd-72b3-899f-377330eb450b";
    resumed.start(next);
    resumed.update(usage(next, [59330, 40192, 512], [18155, 13312, 229]).params);
    resumed.update(usage(next, [77787, 58112, 630], [18457, 17920, 118]).params);
    resumed.update(usage(next, [96435, 76416, 640], [18648, 18304, 10]).params);
    expect([resumed.input, resumed.cached, resumed.output]).toEqual([96435 - 41175, 76416 - 26880, 640 - 283]);

    // No starting point, or a total that shrank (a compaction): the newest call is counted.
    const cold = new CodexUsage();
    cold.start(next);
    cold.update(usage(next, [59330, 40192, 512], [18155, 13312, 229]).params);
    cold.update(usage(next, [20000, 0, 600], [20000, 0, 88]).params);
    expect([cold.input, cold.cached, cold.output]).toEqual([18155 + 20000, 13312, 229 + 88]);
  });
});

describe("Codex over app-server: its questions", () => {
  it("turns its approval requests into ADCode's question and answers in the shape each wants", () => {
    const state = codexTurnState(CWD);
    codexEvents("item/started", { item: fileItem("inProgress") }, state);
    expect(codexRequestPlan("Codex CLI", COMMAND_APPROVAL.method, COMMAND_APPROVAL.params, state, "adcode")).toEqual({ ask: { agent: "Codex CLI", action: "run a command", tool: "shell", detail: "node -e \"console.log(6*7)\"" } });
    expect(codexRequestPlan("Codex CLI", FILE_APPROVAL.method, FILE_APPROVAL.params, state, "adcode")).toEqual({ ask: { agent: "Codex CLI", action: "change files", tool: "apply_patch", detail: "hello.txt" } });
    // `acceptForSession` is Codex's own per-session approval; the rule amendment it offers would be written to its rules file.
    expect(codexApprovalReply(COMMAND_APPROVAL.method, COMMAND_APPROVAL.params, "allow")).toEqual({ decision: "accept" });
    expect(codexApprovalReply(COMMAND_APPROVAL.method, COMMAND_APPROVAL.params, "session")).toEqual({ decision: "acceptForSession" });
    expect(codexApprovalReply(FILE_APPROVAL.method, FILE_APPROVAL.params, "deny")).toEqual({ decision: "decline" });
  });

  it("asks before another server's MCP tool, never before ADCode's own, and cancels what needs someone at Codex", () => {
    const state = codexTurnState(CWD);
    expect(codexRequestPlan("Codex CLI", MCP_APPROVAL.method, MCP_APPROVAL.params, state, "adcode")).toEqual({ ask: { agent: "Codex CLI", action: "use Roblox_Studio's execute luau tool", tool: "Roblox_Studio execute_luau", detail: "code: print(1), datamodel_type: Edit" } });
    expect(codexRequestPlan("Codex CLI", MCP_APPROVAL.method, { ...MCP_APPROVAL.params, serverName: "adcode" }, state, "adcode")).toEqual({ allow: true });
    expect(codexApprovalReply(MCP_APPROVAL.method, MCP_APPROVAL.params, "allow")).toEqual({ action: "accept", content: {}, _meta: null });
    expect(codexApprovalReply(MCP_APPROVAL.method, MCP_APPROVAL.params, "session")).toEqual({ action: "accept", content: {}, _meta: { persist: "session" } });
    expect(codexApprovalReply(MCP_APPROVAL.method, MCP_APPROVAL.params, "deny")).toEqual({ action: "decline", content: null, _meta: null });
    expect(codexRequestPlan("Codex CLI", MCP_APPROVAL.method, { mode: "url", serverName: "x", url: "https://x", _meta: null }, state, "adcode")).toEqual({ reply: { action: "cancel", content: null, _meta: null } });
    expect(codexRequestPlan("Codex CLI", "item/tool/requestUserInput", {}, state, "adcode")).toHaveProperty("error");
  });

  it("asks for more access in words and grants only what was asked", () => {
    const params = { threadId: THREAD, turnId: TURN, itemId: "p", cwd: CWD, reason: "Needs to download packages", permissions: { network: { enabled: true }, fileSystem: null } };
    expect(codexRequestPlan("Codex CLI", "item/permissions/requestApproval", params, codexTurnState(CWD), null)).toEqual({ ask: { agent: "Codex CLI", action: "get more access", tool: "permissions", detail: "the network", reason: "Needs to download packages" } });
    expect(codexApprovalReply("item/permissions/requestApproval", params, "session")).toEqual({ permissions: { network: { enabled: true } }, scope: "session" });
    expect(codexApprovalReply("item/permissions/requestApproval", params, "deny")).toEqual({ permissions: {}, scope: "turn" });
  });
});

describe("Codex over app-server: the provider", () => {
  it("starts app-server with ADCode's tools, a sandboxed thread that asks, and streams the reply", async () => {
    const fake = fakeCodex(realTurn);
    const asks: CliPermissionAsk[] = [];
    const sessions = new Map<string, { id: string; messages: number }>();
    const provider = createCodexProvider({
      spec: codex, models: ["default"], spawn: noSpawn, live: fake.live, cwd: () => CWD, sessions, conversation: () => "chat-1",
      mcp: () => ({ configPath: "C:/tmp/mcp.json", server: "adcode", url: "http://127.0.0.1:4100/mcp", token: "secret" }),
      askPermission: async (ask) => { asks.push(ask); return "allow"; },
    });
    const events = await collect(provider.stream(request(["Run node and save the output"]), new AbortController().signal));
    const started = fake.started[0]!;
    expect(started.args).toEqual(["app-server", "-c", "mcp_servers.adcode.url=http://127.0.0.1:4100/mcp", "-c", `mcp_servers.adcode.bearer_token_env_var=${CLI_BRIDGE_TOKEN_ENV}`]);
    expect(started.env).toEqual({ [CLI_BRIDGE_TOKEN_ENV]: "secret" });
    expect(started.args.join(" ")).not.toContain("secret");
    expect(methods(started)).toEqual(["initialize", "initialized", "thread/start", "turn/start"]);
    expect(started.received[2]!.params).toEqual({ cwd: CWD, approvalPolicy: "on-request", sandbox: "workspace-write" });
    expect(started.received[3]!.params).toEqual({ threadId: THREAD, input: [{ type: "text", text: "Run node and save the output", text_elements: [] }] });
    // Word by word: many text events, not one at the end.
    expect(events.filter((event) => event.kind === "text").length).toBeGreaterThan(20);
    expect(textOf(events)).toBe("I’ll run the command and save its output to `hello.txt`.\n\nRan the command and created `hello.txt` containing `42`.");
    expect(asks.map((ask) => [ask.action, ask.detail])).toEqual([["run a command", "node -e \"console.log(6*7)\""], ["change files", "hello.txt"]]);
    expect(started.replies.map((reply) => reply.result)).toEqual([{ decision: "accept" }, { decision: "accept" }]);
    expect(thinkingOf(events)).toContain("› You allowed: shell (node -e \"console.log(6*7)\")");
    expect(events.find((event) => event.kind === "status" && event.text.includes("waiting for your answer"))).toBeDefined();
    expect(events.find((event) => event.kind === "usage")).toEqual({ kind: "usage", inputTokens: 41175, outputTokens: 283, cachedTokens: 26880 });
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "end-turn" });
    expect([...sessions.values()]).toEqual([{ id: THREAD, messages: 1 }]);
  });

  it("answers Allow for this chat with Codex's session approval, and Deny with decline", async () => {
    for (const [answer, decision] of [["session", "acceptForSession"], ["deny", "decline"]] as const) {
      const fake = fakeCodex(realTurn);
      const provider = createCodexProvider({ spec: codex, models: ["default"], spawn: noSpawn, live: fake.live, cwd: () => CWD, askPermission: async (): Promise<CliPermissionAnswer> => answer });
      const events = await collect(provider.stream(request(["Run node"]), new AbortController().signal));
      expect(fake.started[0]!.replies[0]!.result).toEqual({ decision });
      if (answer === "deny") {
        expect(thinkingOf(events)).toContain("› You declined: shell");
        // The person said no in the dialog: the declined item is not reported a second time.
        expect(thinkingOf(events)).not.toContain("› Not allowed:");
        expect(textOf(events)).toContain("Permission to run it was not granted.");
      }
    }
  });

  it("with nobody to ask, declines and says where the switch is", async () => {
    const fake = fakeCodex(async ({ emit, ask }) => {
      emit({ method: "turn/started", params: { threadId: THREAD, turn: { id: TURN, status: "inProgress" } } });
      await ask(COMMAND_APPROVAL);
      emit({ method: "item/completed", params: { item: commandItem("declined"), threadId: THREAD, turnId: TURN } });
      emit({ method: "turn/completed", params: { threadId: THREAD, turn: { id: TURN, items: [], status: "completed", error: null } } });
    });
    const provider = createCodexProvider({ spec: codex, models: ["default"], spawn: noSpawn, live: fake.live, cwd: () => CWD });
    const events = await collect(provider.stream(request(["Run node"]), new AbortController().signal));
    expect(fake.started[0]!.replies[0]!.result).toEqual({ decision: "decline" });
    expect(textOf(events)).toContain("Turn on Full access for this chat");
  });

  it("Full access runs the thread unsandboxed and never asks", async () => {
    const fake = fakeCodex(realTurn);
    let asked = 0;
    const provider = createCodexProvider({ spec: codex, models: ["default"], spawn: noSpawn, live: fake.live, cwd: () => CWD, bypassPermissions: () => true, askPermission: async () => { asked += 1; return "deny"; } });
    await collect(provider.stream(request(["Run node"]), new AbortController().signal));
    expect(fake.started[0]!.received[2]!.params).toMatchObject({ approvalPolicy: "never", sandbox: "danger-full-access" });
    expect(asked).toBe(0);
    expect(fake.started[0]!.replies.map((reply) => reply.result)).toEqual([{ decision: "accept" }, { decision: "accept" }]);
  });

  it("keeps the process for the chat's next message, with the model and effort it was asked for", async () => {
    const fake = fakeCodex(words("Hi there."));
    const liveProcesses = new Map<string, CliLiveEntry>();
    const sessions = new Map<string, { id: string; messages: number }>();
    const options = { spec: codex, models: ["gpt-5.6-luna"], spawn: noSpawn, live: fake.live, liveProcesses, sessions, cwd: () => CWD, conversation: () => "chat-2", modelEfforts: { "gpt-5.6-luna": ["low", "medium", "high"] } };
    const first = await collect(createCodexProvider(options).stream({ ...request(["Hello"], "gpt-5.6-luna"), effort: "low" }, new AbortController().signal));
    expect(textOf(first)).toBe("Hi there.");
    // A rebuilt provider still finds the running process.
    const second = await collect(createCodexProvider(options).stream({ ...request(["Hello", "Hi there.", "And again"], "gpt-5.6-luna"), effort: "high" }, new AbortController().signal));
    expect(textOf(second)).toBe("Hi there.");
    expect(fake.started).toHaveLength(1);
    expect(methods(fake.started[0]!)).toEqual(["initialize", "initialized", "thread/start", "turn/start", "turn/start"]);
    expect(fake.started[0]!.received[2]!.params).toMatchObject({ model: "gpt-5.6-luna" });
    expect(fake.started[0]!.received[3]!.params).toMatchObject({ effort: "low" });
    // Resuming sends only the newest message: Codex has the rest.
    expect(fake.started[0]!.received[4]!.params).toMatchObject({ effort: "high", input: [{ type: "text", text: "And again", text_elements: [] }] });
  });

  it("resumes the chat's thread in a new process, and starts afresh with the transcript when Codex no longer has it", async () => {
    const sessions = new Map([["codex:default:chat:chat-3", { id: THREAD, messages: 1 }]]);
    const kept = fakeCodex(words("Forty-two."));
    await collect(createCodexProvider({ spec: codex, models: ["default"], spawn: noSpawn, live: kept.live, sessions, cwd: () => CWD, conversation: () => "chat-3" }).stream(request(["Run it", "42", "What did it print?"]), new AbortController().signal));
    expect(methods(kept.started[0]!)).toEqual(["initialize", "initialized", "thread/resume", "turn/start"]);
    expect(kept.started[0]!.received[2]!.params).toMatchObject({ threadId: THREAD, excludeTurns: true, approvalPolicy: "on-request" });
    expect(kept.started[0]!.received[3]!.params).toMatchObject({ input: [{ text: "What did it print?" }] });

    const gone = fakeCodex(words("It printed 42."), { resumable: false });
    const goneSessions = new Map([["codex:default:chat:chat-4", { id: "old-thread", messages: 1 }]]);
    const events = await collect(createCodexProvider({ spec: codex, models: ["default"], spawn: noSpawn, live: gone.live, sessions: goneSessions, cwd: () => CWD, conversation: () => "chat-4" }).stream(request(["Run it", "42", "What did it print?"]), new AbortController().signal));
    expect(textOf(events)).toBe("It printed 42.");
    expect(methods(gone.started[0]!)).toEqual(["initialize", "initialized", "thread/resume", "thread/start", "turn/start"]);
    const prompt = ((gone.started[0]!.received[4]!.params["input"] as { text: string }[])[0]!).text;
    expect(prompt).toContain("The conversation so far:");
    expect(prompt).toContain("Now:\nWhat did it print?");
    expect(goneSessions.get("codex:default:chat:chat-4")).toEqual({ id: THREAD, messages: 3 });
  });

  it("Stop interrupts the turn, shows at once, and keeps Codex for the next message", async () => {
    const controller = new AbortController();
    const fake = fakeCodex(({ emit }) => {
      emit({ method: "turn/started", params: { threadId: THREAD, turn: { id: TURN, status: "inProgress" } } });
      emit(delta("msg_s", "Once upon"));
      // Then nothing until interrupted, like a long story.
    });
    const liveProcesses = new Map<string, CliLiveEntry>();
    const provider = createCodexProvider({ spec: codex, models: ["default"], spawn: noSpawn, live: fake.live, liveProcesses, cwd: () => CWD, conversation: () => "chat-5" });
    const events: ProviderEvent[] = [];
    for await (const event of provider.stream(request(["Write a long story"]), controller.signal)) {
      events.push(event);
      if (event.kind === "text") controller.abort();
    }
    expect(events.at(-1)).toEqual({ kind: "stop", reason: "cancelled" });
    expect(fake.started[0]!.received.find((message) => message.method === "turn/interrupt")?.params).toEqual({ threadId: THREAD, turnId: TURN });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.started[0]!.killed).toBe(false);
    expect([...liveProcesses.values()][0]!.busy).toBe(false);
  });

  it("says why a turn failed, in Codex's words", async () => {
    const fake = fakeCodex(({ emit }) => { for (const line of MODEL_REFUSED) emit(line); });
    const provider = createCodexProvider({ spec: codex, models: ["default"], spawn: noSpawn, live: fake.live, cwd: () => CWD });
    await expect(collect(provider.stream(request(["hi"]), new AbortController().signal))).rejects.toMatchObject({ message: "Codex CLI: The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.", code: "cli-failed" });
  });

  it("without a way to keep a process, falls back to codex exec", () => {
    const provider = createCodexProvider({ spec: codex, models: ["default"], spawn: noSpawn, cwd: () => CWD });
    expect(provider.id).toBe("cli-codex");
    expect(codexThreadParams({ cwd: CWD, model: "default", bypass: false })).not.toHaveProperty("model");
    expect(codexAppServerArgs(null)).toEqual(["app-server"]);
  });
});

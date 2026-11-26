/**
 * Codex CLI over its app-server protocol (`codex app-server`): JSON-RPC 2.0, one message per
 * line on stdin and stdout, the protocol the Codex IDE extension and T3 Code drive it with.
 *
 * `codex exec --json` - what ADCode used before - only reports an item once it is finished, so
 * a whole answer appeared at once, and it cannot ask anybody anything, so a command that needed
 * approval simply failed. Over app-server the reply streams word by word
 * (`item/agentMessage/delta`), and a command or file change that needs approval arrives as a
 * request (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`) that
 * waits for ADCode's answer, which the person gives in ADCode's own dialog.
 *
 * The client sends `initialize` and `initialized`, then `thread/start` (or `thread/resume` for
 * a conversation Codex already has), then one `turn/start` per message; `turn/interrupt` stops
 * a turn without ending the process. One process serves a chat's every turn, as `acp.ts` does
 * for ACP agents, so only the first message waits for Codex to start.
 *
 * Every method, notification and answer shape here was checked against codex-cli 0.172.0 - its
 * generated schema (`codex app-server generate-ts`) and real turns, captured in the tests.
 * Per-turn token counts as differences of the thread's running totals follow T3 Code
 * (CodexTurnTokenUsage.ts, MIT; see NOTICE).
 *
 * Pure apart from the injected `CliLiveSpawn`, so every rule is tested.
 */
import { EventQueue } from "./acp.ts";
import { HEARTBEAT_MS, LIVE_IDLE_MS, LIVE_MAX, SIGNED_OUT, activity, cliEffort, cliEnv, cliPrompt, cliProviderId, codexBridgeOverrides, conversationKey, createCliProvider, dropLive, isSafeCliToken, permissionOutcome, permissionWaiting, unfinishedRunNote, withHeartbeat, type CliEvent, type CliLiveEntry, type CliLiveProcess, type CliMcpServer, type CliPermissionAnswer, type CliPermissionAsk, type CliProviderOptions } from "./cliAgents.ts";
import type { Provider, ProviderEvent } from "./types.ts";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);
const obj = (value: unknown): Record<string, unknown> => (record(value) ? value : {});

/** `codex app-server`, with ADCode's tool bridge as config overrides when it is running. */
export function codexAppServerArgs(mcp: CliMcpServer | null | undefined): string[] {
  return ["app-server", ...codexBridgeOverrides(mcp)];
}

/**
 * How a thread runs. A chat gets Codex's own "Auto": edits and commands inside the project in
 * its sandbox, and a question - to the person, through ADCode - before anything that needs more
 * (the network, a path outside the project). Full access is `--dangerously-bypass-approvals-and-sandbox`
 * as thread settings: no sandbox, and no questions.
 */
export function codexThreadParams(options: { readonly cwd: string; readonly model: string; readonly bypass: boolean; readonly readOnly?: boolean }): Record<string, unknown> {
  // A side chat (/btw) reads and answers: a read-only sandbox, whatever Full access says.
  const readOnly = options.readOnly === true;
  return {
    cwd: options.cwd,
    approvalPolicy: options.bypass && !readOnly ? "never" : "on-request",
    sandbox: readOnly ? "read-only" : options.bypass ? "danger-full-access" : "workspace-write",
    ...(options.model !== "default" && isSafeCliToken(options.model) ? { model: options.model } : {}),
  };
}

/** One message as `turn/start`. The reasoning level goes with the turn, so changing it needs no new process. */
export function codexTurnParams(threadId: string, text: string, effort?: string): Record<string, unknown> {
  return { threadId, input: [{ type: "text", text, text_elements: [] }], ...(effort === undefined ? {} : { effort }) };
}

/* ── Running token totals into one turn's usage ─────────────────────────── */

interface Totals { readonly input: number; readonly cached: number; readonly output: number }

function totals(value: unknown): Totals | null {
  if (!record(value)) return null;
  // Codex counts cached input inside inputTokens and reasoning inside outputTokens, as OpenAI does.
  return { input: num(value["inputTokens"]), cached: num(value["cachedInputTokens"]), output: num(value["outputTokens"]) };
}

/**
 * One turn's tokens from `thread/tokenUsage/updated`, which reports the thread's running total
 * and the newest model call (`last`). A turn's share is the growth of the total while it runs.
 * An update from before the turn (a resumed thread reports its old total first) only sets the
 * starting point; when there is none, or the total went backwards (a compaction), `last` is
 * counted instead. Lives with the process, so the next turn starts from this one's total.
 */
export class CodexUsage {
  private baseline: Totals | null = null;
  private turn: string | null = null;
  input = 0;
  cached = 0;
  output = 0;

  /** A new turn: what it uses is counted from here. */
  start(turnId: string): void {
    this.turn = turnId;
    this.input = 0;
    this.cached = 0;
    this.output = 0;
  }

  update(params: unknown): void {
    const p = obj(params);
    const usage = obj(p["tokenUsage"]);
    const total = totals(usage["total"]);
    if (total === null) return;
    if (this.turn === null || str(p["turnId"]) !== this.turn) { this.baseline = total; return; }
    const before = this.baseline;
    const grew = before !== null && total.input >= before.input && total.cached >= before.cached && total.output >= before.output;
    const delta = grew ? { input: total.input - before.input, cached: total.cached - before.cached, output: total.output - before.output } : totals(usage["last"]) ?? { input: 0, cached: 0, output: 0 };
    this.baseline = total;
    this.input += delta.input;
    this.cached += delta.cached;
    this.output += delta.output;
  }
}

/* ── Notifications as the chat's events ─────────────────────────────────── */

/** What one turn remembers between notifications. */
export interface CodexTurnState {
  /** The agent message whose words came last: the next delta of the same message joins them. */
  textItem: string | null;
  /** Items whose words or reasoning streamed, so their finished copy is not shown again. */
  readonly streamed: Set<string>;
  /** Each file change's paths, from `item/started`, for the approval question. */
  readonly files: Map<string, string[]>;
  /** Items the person turned down in ADCode's dialog: the chat already says so. */
  readonly declined: Set<string>;
  /** The project, so a changed file reads as `src/app.ts`, not a whole Windows path. */
  readonly cwd: string;
}

export function codexTurnState(cwd: string): CodexTurnState {
  return { textItem: null, streamed: new Set(), files: new Map(), declined: new Set(), cwd };
}

function shortPath(path: string, cwd: string): string {
  const full = path.replace(/\\/g, "/");
  const root = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  return root !== "" && full.toLowerCase().startsWith(`${root.toLowerCase()}/`) ? full.slice(root.length + 1) : full;
}

/**
 * A command as Codex parsed it. On Windows `command` is the whole PowerShell wrapper
 * (`"C:\…\powershell.exe" -Command 'node -e …'`); `commandActions` holds what was asked for.
 */
export function codexCommandText(item: unknown): string {
  const value = obj(item);
  const actions = Array.isArray(value["commandActions"]) ? value["commandActions"].map((action) => str(obj(action)["command"])).filter((text) => text !== "") : [];
  return actions.length > 0 ? actions.join(" && ") : str(value["command"]);
}

function changedPaths(item: Record<string, unknown>, cwd: string): string[] {
  return (Array.isArray(item["changes"]) ? item["changes"] : []).map((change) => shortPath(str(obj(change)["path"]), cwd)).filter((path) => path !== "");
}

/** One notification, as the chat's events. Thread and turn routing is the caller's. */
export function codexEvents(method: string, params: unknown, state: CodexTurnState): CliEvent[] {
  const p = obj(params);
  switch (method) {
    case "item/agentMessage/delta": {
      const text = str(p["delta"]);
      const item = str(p["itemId"]);
      if (text === "") return [];
      const joined = state.textItem === item;
      state.textItem = item;
      state.streamed.add(item);
      return [{ kind: "text", text, ...(joined ? { joined: true } : {}) }];
    }
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta": {
      const text = str(p["delta"]);
      if (text === "") return [];
      state.streamed.add(str(p["itemId"]));
      return [{ kind: "thinking", text }];
    }
    case "item/started": {
      const item = obj(p["item"]);
      if (item["type"] === "fileChange") state.files.set(str(item["id"]), changedPaths(item, state.cwd));
      return [];
    }
    case "item/completed": return codexItemEvents(obj(p["item"]), state);
    case "turn/plan/updated": {
      const steps = Array.isArray(p["plan"]) ? p["plan"].filter(record) : [];
      if (steps.length === 0) return [];
      return [{ kind: "thinking", text: `${steps.map((step) => `${step["status"] === "completed" ? "✓" : "·"} ${str(step["step"])}`).join("\n")}\n` }];
    }
    case "error": {
      // A failure Codex will not retry ends the turn, and turn/completed carries it.
      if (p["willRetry"] !== true) return [];
      return [{ kind: "status", text: `Codex hit a problem and is trying again: ${str(obj(p["error"])["message"]).slice(0, 160)}` }];
    }
    case "model/rerouted":
      return [{ kind: "status", text: `Codex switched this turn from ${str(p["fromModel"])} to ${str(p["toModel"])}.` }];
    default:
      return [];
  }
}

function codexItemEvents(item: Record<string, unknown>, state: CodexTurnState): CliEvent[] {
  const id = str(item["id"]);
  const status = str(item["status"]);
  switch (item["type"]) {
    case "agentMessage": {
      // Streamed already; only a message that came whole (no deltas) is shown here.
      if (state.streamed.has(id) || str(item["text"]) === "") return [];
      state.textItem = id;
      return [{ kind: "text", text: str(item["text"]) }];
    }
    case "reasoning": {
      if (state.streamed.has(id)) return [{ kind: "thinking", text: "\n" }];
      const parts = [...(Array.isArray(item["summary"]) ? item["summary"] : []), ...(Array.isArray(item["content"]) ? item["content"] : [])].map(str).filter((text) => text !== "");
      return parts.length === 0 ? [] : [{ kind: "thinking", text: `${parts.join("\n")}\n` }];
    }
    case "commandExecution": {
      const command = codexCommandText(item);
      if (status === "declined") return state.declined.has(id) ? [] : [activity("Not allowed", command)];
      const exit = typeof item["exitCode"] === "number" && item["exitCode"] !== 0 ? ` (exit ${item["exitCode"]})` : "";
      return [activity("Ran", `${command}${exit}`)];
    }
    case "fileChange": {
      const paths = changedPaths(item, state.cwd).join(", ");
      if (status === "declined") return state.declined.has(id) ? [] : [activity("Not allowed to change", paths)];
      return [activity(status === "failed" ? "Could not change" : "Changed", paths)];
    }
    case "mcpToolCall": {
      const name = `${str(item["server"])} ${str(item["tool"])}`.trim();
      if (status === "failed") return [activity(`${name} failed`, str(obj(item["error"])["message"]))];
      return [activity("Used", name)];
    }
    case "dynamicToolCall": return [activity("Used", str(item["tool"]))];
    case "webSearch": return [activity("Searched the web for", str(item["query"]))];
    case "collabAgentToolCall": return [activity("Started a helper", str(item["prompt"]))];
    case "contextCompaction": return [activity("Compacted the conversation", "")];
    default: return [];
  }
}

/* ── Codex's questions ──────────────────────────────────────────────────── */

/** What to do with a request Codex sent: ask the person, allow it, or answer it as given. */
export type CodexRequestPlan =
  | { readonly ask: CliPermissionAsk }
  | { readonly allow: true }
  | { readonly reply: unknown }
  | { readonly error: string };

/**
 * A request from Codex, as ADCode handles it. `bridge` is ADCode's own tool server: Codex asks
 * before a tool of it that is not marked read-only, and ADCode's own confirmation dialogs already
 * stand in front of anything guarded there, so it is allowed without a second question - the same
 * reach Claude Code gets with `--allowedTools mcp__adcode`.
 */
export function codexRequestPlan(agent: string, method: string, params: unknown, state: CodexTurnState, bridge: string | null): CodexRequestPlan {
  const p = obj(params);
  const reason = str(p["reason"]);
  const why = reason === "" ? {} : { reason };
  switch (method) {
    case "item/commandExecution/requestApproval":
      return { ask: { agent, action: p["kind"] === "writeStdin" ? "type into a running command" : "run a command", tool: "shell", detail: codexCommandText(p), ...why } };
    case "item/fileChange/requestApproval": {
      const paths = state.files.get(str(p["itemId"])) ?? [];
      const root = str(p["grantRoot"]);
      return { ask: { agent, action: root === "" ? "change files" : "write outside the project", tool: "apply_patch", detail: paths.join(", ") || root, ...why } };
    }
    case "item/permissions/requestApproval": {
      const wanted = obj(p["permissions"]);
      const files = obj(wanted["fileSystem"]);
      const detail = [obj(wanted["network"])["enabled"] === true ? "the network" : "", ...(Array.isArray(files["write"]) ? files["write"].map((path) => `write to ${shortPath(str(path), state.cwd)}`) : []), ...(Array.isArray(files["read"]) ? files["read"].map((path) => `read ${shortPath(str(path), state.cwd)}`) : [])].filter((part) => part !== "").join(", ");
      return { ask: { agent, action: "get more access", tool: "permissions", detail, ...why } };
    }
    case "mcpServer/elicitation/request": {
      const meta = obj(p["_meta"]);
      const server = str(p["serverName"]);
      // Only a tool approval can be answered; a form or a sign-in page needs someone at Codex itself.
      if (meta["codex_approval_kind"] !== "mcp_tool_call") return { reply: { action: "cancel", content: null, _meta: null } };
      if (bridge !== null && server === bridge) return { allow: true };
      const tool = str(meta["tool_name"]);
      const shown = Array.isArray(meta["tool_params_display"]) ? meta["tool_params_display"].map((entry) => { const item = obj(entry); return `${str(item["display_name"]) || str(item["name"])}: ${typeof item["value"] === "string" ? item["value"] : JSON.stringify(item["value"])}`; }).join(", ") : "";
      return { ask: { agent, action: `use ${server}'s ${tool.replace(/_/g, " ") || "tool"} tool`, tool: `${server} ${tool}`.trim(), detail: shown || str(p["message"]) } };
    }
    default:
      // Asking the person to type an answer, refreshing a ChatGPT sign-in: not something a chat can do.
      return { error: `ADCode does not answer ${method || "this request"}.` };
  }
}

/**
 * The person's answer in the shape the request wants. "session" is Codex's own per-session
 * approval (`acceptForSession`, an MCP tool's `persist: "session"`), never the rule amendment
 * Codex also offers, which it would write to its rules file. "deny" is `decline`, after which
 * Codex carries on and says it was not allowed; `cancel` would also end the turn.
 */
export function codexApprovalReply(method: string, params: unknown, answer: CliPermissionAnswer): unknown {
  if (method === "mcpServer/elicitation/request") {
    if (answer === "deny") return { action: "decline", content: null, _meta: null };
    return { action: "accept", content: {}, _meta: answer === "session" ? { persist: "session" } : null };
  }
  if (method === "item/permissions/requestApproval") {
    if (answer === "deny") return { permissions: {}, scope: "turn" };
    const wanted = obj(obj(params)["permissions"]);
    const granted = Object.fromEntries(Object.entries(wanted).filter(([, value]) => value !== null && value !== undefined));
    return { permissions: granted, scope: answer === "session" ? "session" : "turn" };
  }
  return { decision: answer === "deny" ? "decline" : answer === "session" ? "acceptForSession" : "accept" };
}

/* ── The connection ─────────────────────────────────────────────────────── */

/** A JSON-RPC error from Codex. */
export class CodexError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * The protocol over one running `codex app-server`: requests matched to their answers,
 * notifications and Codex's own requests handed to the turn that is listening. Reads stdout for
 * as long as the process lives. Codex numbers its requests from 0, so an id is any number.
 */
export class CodexConnection {
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private ended = false;
  onNotification: ((method: string, params: Record<string, unknown>) => void) | null = null;
  /** Answers a request from Codex; may take as long as the person does. A throw is sent back as an error. */
  onRequest: ((method: string, params: Record<string, unknown>) => Promise<unknown>) | null = null;
  /** Stdout closed: the process is gone. */
  onEnd: (() => void) | null = null;
  /** Token totals across the process's turns. */
  readonly usage = new CodexUsage();
  readonly process: CliLiveProcess;

  constructor(process: CliLiveProcess) {
    this.process = process;
    void this.pump();
  }

  get alive(): boolean {
    return !this.ended && this.process.alive();
  }

  /** The end of stderr, for a failure nothing else explains. */
  stderrTail(): string {
    // Its log lines are coloured and timestamped: "\x1b[2m2026-11-25T16:20:10.356Z\x1b[0m \x1b[31mERROR\x1b[0m …".
    return this.process.stderr().replace(/\x1b\[[0-9;]*m/g, "").trim().split(/\r?\n/).map((line) => line.replace(/^\d{4}-\d\d-\d\dT\S+\s+/, "").trim()).filter((line) => line !== "").slice(-3).join(" ");
  }

  private async pump(): Promise<void> {
    for (;;) {
      const line = await this.process.next();
      if (line === null) break;
      const trimmed = line.trim();
      if (!trimmed.startsWith("{")) continue;
      let message: unknown;
      try { message = JSON.parse(trimmed); } catch { continue; }
      if (record(message)) this.receive(message);
    }
    this.ended = true;
    const reason = this.stderrTail();
    for (const { reject } of this.pending.values()) reject(new CodexError(-32099, reason || "it stopped"));
    this.pending.clear();
    this.onEnd?.();
  }

  private receive(message: Record<string, unknown>): void {
    const id = message["id"];
    const method = str(message["method"]);
    if (method === "") {
      if (typeof id !== "number") return;
      const waiting = this.pending.get(id);
      if (waiting === undefined) return;
      this.pending.delete(id);
      if (record(message["error"])) {
        const error = message["error"];
        const code = typeof error["code"] === "number" && Number.isFinite(error["code"]) ? error["code"] : -32603;
        waiting.reject(new CodexError(code, str(error["message"]) || "the request failed"));
      } else waiting.resolve(message["result"]);
      return;
    }
    const params = obj(message["params"]);
    if (id === undefined || id === null) {
      if (method === "thread/tokenUsage/updated") this.usage.update(params);
      this.onNotification?.(method, params);
      return;
    }
    // Codex waits for this answer, so one is always sent.
    const handler = this.onRequest;
    void Promise.resolve()
      .then(() => (handler === null ? Promise.reject(new CodexError(-32601, `ADCode is not taking ${method} requests right now.`)) : handler(method, params)))
      .then(
        (result) => { this.send({ jsonrpc: "2.0", id, result }); },
        (error: unknown) => { this.send({ jsonrpc: "2.0", id, error: { code: error instanceof CodexError ? error.code : -32603, message: error instanceof Error ? error.message : String(error) } }); },
      );
  }

  private send(message: unknown): void {
    this.process.send(JSON.stringify(message));
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (!this.alive) return Promise.reject(new CodexError(-32099, this.stderrTail() || "it is not running"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.alive) this.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }
}

/* ── The provider ───────────────────────────────────────────────────────── */

/** A kept Codex still busy this long after Stop is not trusted with another turn. */
const CANCEL_GRACE_MS = 5_000;

const threadIdOf = (result: unknown): string => str(obj(obj(result)["thread"])["id"]);
const turnIdOf = (result: unknown): string => str(obj(obj(result)["turn"])["id"]);

/**
 * A chat answered by Codex over app-server: the same options as `createCliProvider`. Without
 * `live` (a build that cannot keep a process) it falls back to one `codex exec` per turn.
 */
export function createCodexProvider(options: CliProviderOptions): Provider {
  const live = options.live;
  if (live === undefined) return createCliProvider(options);
  const { spec } = options;
  const sessions = options.sessions ?? new Map<string, { id: string; messages: number }>();
  const liveProcesses = options.liveProcesses ?? new Map<string, CliLiveEntry>();
  return {
    id: cliProviderId(spec.id),
    displayName: spec.name,
    models: options.models,
    async *stream(request, signal): AsyncIterable<ProviderEvent> {
      const chat = options.conversation?.();
      const key = chat !== undefined && chat !== "" ? `${spec.id}:${request.model}:chat:${chat}` : conversationKey(spec.id, request.model, request);
      const prior = sessions.get(key);
      const resume = prior !== undefined && request.messages.length > prior.messages;
      const readOnly = options.readOnly?.() === true;
      const bypass = !readOnly && options.bypassPermissions?.() === true;
      const mcp = options.mcp?.() ?? null;
      const cwd = options.cwd();
      const effort = cliEffort(request, options.modelEfforts).effort;
      const args = codexAppServerArgs(mcp);
      const env = cliEnv(spec.id, mcp);
      // Model, access and tools are settled per thread and process; a change to any starts afresh
      // (and resumes the thread). The reasoning level goes with each turn.
      const signature = JSON.stringify([cwd, env, args, request.model, bypass, readOnly]);
      const fail = (error: unknown): never => {
        const message = error instanceof Error ? error.message : String(error);
        const out = SIGNED_OUT.test(message);
        throw Object.assign(new Error(`${spec.name}: ${message}${out ? ` Sign in by running \`${spec.signIn}\` in a terminal, then send your message again.` : ""}`), { code: out ? "cli-signed-out" : "cli-failed", retryable: false });
      };

      let entry = liveProcesses.get(key);
      let continued = false;
      if (entry !== undefined && !entry.busy && entry.signature === signature && resume && entry.session === prior.id && (entry.acp as CodexConnection | undefined)?.alive === true) {
        if (entry.idle !== undefined) clearTimeout(entry.idle);
        continued = true;
      } else {
        if (entry?.busy === true) fail(new Error("it is still answering the previous message in this chat."));
        dropLive(liveProcesses, key);
        for (const [other, kept] of [...liveProcesses].sort((a, b) => a[1].usedAt - b[1].usedAt)) {
          if (liveProcesses.size < LIVE_MAX) break;
          if (!kept.busy) dropLive(liveProcesses, other);
        }
        const process = live(spec.command, args, { cwd, env });
        // `acp` holds the protocol connection for any kept protocol agent.
        entry = { process, signature, session: null, busy: false, usedAt: Date.now(), acp: new CodexConnection(process) };
        liveProcesses.set(key, entry);
      }
      const kept = entry;
      const connection = kept.acp as CodexConnection;
      kept.busy = true;
      kept.usedAt = Date.now();

      let completed: Record<string, unknown> | null = null;
      let cancelled = false;
      try {
        if (!continued) {
          yield { kind: "status", text: `Starting ${spec.name}…` };
          try {
            await connection.request("initialize", { clientInfo: { name: "adcode", title: "ADCode", version: "1" } });
            connection.notify("initialized");
          } catch (error) { fail(error); }
          const thread = codexThreadParams({ cwd, model: request.model, bypass, readOnly });
          let threadId = "";
          if (resume) {
            // A thread Codex has cleaned up fails here; the conversation then starts afresh with its transcript.
            try { threadId = threadIdOf(await connection.request("thread/resume", { threadId: prior.id, ...thread, excludeTurns: true })) || prior.id; } catch { /* Gone: start a new thread below. */ }
          }
          continued = threadId !== "";
          if (!continued) {
            try { threadId = threadIdOf(await connection.request("thread/start", thread)); } catch (error) { fail(error); }
          }
          if (threadId === "") fail(new Error("it did not start a conversation."));
          kept.session = threadId;
        }
        const threadId = kept.session!;
        sessions.set(key, { id: threadId, messages: request.messages.length });

        const queue = new EventQueue<CliEvent | { kind: "end" }>();
        const state = codexTurnState(cwd);
        const denied: { tool: string; detail: string }[] = [];
        /** Text after the last refusal: Codex said for itself what it could not do. */
        let answeredSinceDenied = true;
        let turnId: string | null = null;
        let interrupted = false;
        const interrupt = (): void => {
          if (turnId === null || interrupted) return;
          interrupted = true;
          void connection.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
        };
        const begin = (id: string): void => {
          if (turnId !== null || id === "") return;
          turnId = id;
          connection.usage.start(id);
          // Stop came before Codex said which turn it was.
          if (cancelled) interrupt();
        };
        connection.onNotification = (method, params) => {
          if (str(params["threadId"]) !== threadId) return;
          if (method === "turn/started") { begin(str(obj(params["turn"])["id"])); return; }
          if (method === "turn/completed") {
            const turn = obj(params["turn"]);
            if (turnId !== null && str(turn["id"]) !== turnId) return;
            completed = turn;
            // A stopped turn that comes back leaves Codex ready for the next message.
            if (cancelled) kept.busy = false;
            queue.push({ kind: "end" });
            return;
          }
          for (const event of codexEvents(method, params, state)) queue.push(event);
        };
        /** Questions the person has not answered yet: the silence is theirs, not Codex's. */
        let waitingOnPerson = 0;
        connection.onRequest = async (method, params) => {
          const plan = codexRequestPlan(spec.name, method, params, state, mcp?.server ?? null);
          if ("error" in plan) throw new CodexError(-32601, plan.error);
          if ("reply" in plan) return plan.reply;
          if (("allow" in plan || bypass) && !readOnly) return codexApprovalReply(method, params, "allow");
          // In a side chat even what is normally allowed is refused: it looks, and changes nothing.
          const ask: CliPermissionAsk = "ask" in plan ? plan.ask : { agent: spec.name, action: "use a tool", tool: method, detail: "" };
          const asker = options.askPermission;
          if (asker === undefined || signal.aborted || readOnly) {
            denied.push({ tool: ask.tool, detail: ask.detail });
            answeredSinceDenied = false;
            queue.push({ kind: "thinking", text: `› ${readOnly ? "Not in a side chat" : "Not allowed in a chat"}: ${ask.tool}${ask.detail ? ` (${ask.detail.slice(0, 120)})` : ""}\n` });
            state.declined.add(str(params["itemId"]));
            return codexApprovalReply(method, params, "deny");
          }
          waitingOnPerson += 1;
          queue.push({ kind: "status", text: permissionWaiting(ask) });
          try {
            const answer = await asker(ask, signal).catch((): CliPermissionAnswer => "deny");
            if (answer === "deny") state.declined.add(str(params["itemId"]));
            queue.push({ kind: "thinking", text: permissionOutcome(ask, answer) });
            return codexApprovalReply(method, params, answer);
          } finally {
            waitingOnPerson -= 1;
          }
        };
        connection.onEnd = () => { queue.push({ kind: "end" }); };
        // Stop shows at once: the turn ends here while Codex winds its own turn down.
        const stop = (): void => { cancelled = true; interrupt(); queue.push({ kind: "end" }); };
        signal.addEventListener("abort", stop, { once: true });
        let failure: unknown = null;
        void connection.request("turn/start", codexTurnParams(threadId, cliPrompt(request, continued), effort))
          .then((result) => { begin(turnIdOf(result)); }, (error: unknown) => { failure = error; queue.push({ kind: "end" }); });
        let wrote = false;
        let lastText = "";
        try {
          for await (const beat of withHeartbeat(queue, options.heartbeatMs ?? HEARTBEAT_MS)) {
            if ("quietMs" in beat) {
              if (!signal.aborted && waitingOnPerson === 0) yield { kind: "status", text: `${spec.name} is still pondering - ${Math.round(beat.quietMs / 1000)} s with nothing new. It may be thinking hard, or waiting on a slow tool.` };
              continue;
            }
            const event = beat.line;
            if (event.kind === "end") break;
            if (signal.aborted) continue;
            if (event.kind === "status") { yield { kind: "status", text: event.text }; continue; }
            if (event.kind === "text") {
              const text = event.joined !== true && wrote && !lastText.endsWith("\n") && !event.text.startsWith("\n") ? `\n\n${event.text}` : event.text;
              wrote = true;
              answeredSinceDenied = true;
              lastText = event.joined === true ? lastText + event.text : event.text;
              yield { kind: "text", text };
            } else if (event.kind === "thinking") yield { kind: "thinking", text: event.text };
          }
        } finally {
          signal.removeEventListener("abort", stop);
          connection.onEnd = null;
          if (cancelled && completed === null) {
            // Stopped: the chat moved on, but Codex is still winding the turn down. Its
            // turn/completed is what frees the process for the next message; a question asked in
            // the meantime is declined (the signal is aborted, so nobody is asked).
            connection.onNotification = (method, params) => {
              if (method !== "turn/completed" || str(params["threadId"]) !== threadId) return;
              completed = obj(params["turn"]);
              kept.busy = false;
              connection.onNotification = null;
              connection.onRequest = null;
            };
          } else {
            connection.onNotification = null;
            connection.onRequest = null;
          }
        }
        if (signal.aborted) { yield { kind: "stop", reason: "cancelled" }; return; }
        if (failure !== null) fail(failure);
        const turn = completed as Record<string, unknown> | null;
        if (turn === null) fail(new Error(connection.stderrTail() || "it stopped part way through its answer."));
        const turnStatus = str(turn!["status"]);
        if (turnStatus === "failed") {
          const error = obj(turn!["error"]);
          fail(new Error([str(error["message"]) || "the turn failed", str(error["additionalDetails"])].filter(Boolean).join(" ")));
        }
        const note = turnStatus === "interrupted"
          ? `${spec.name} stopped before it finished. Say "continue" to pick up where it stopped.`
          : denied.length > 0 && !answeredSinceDenied ? unfinishedRunNote(spec.name, null, denied, bypass) : null;
        if (note !== null) yield { kind: "text", text: `${wrote && !lastText.endsWith("\n") ? "\n\n" : ""}${note}` };
        const usage = connection.usage;
        if (usage.input + usage.output > 0) yield { kind: "usage", inputTokens: usage.input, outputTokens: usage.output, cachedTokens: usage.cached };
        yield { kind: "stop", reason: "end-turn" };
      } finally {
        const turnDone = completed !== null;
        if (turnDone || !cancelled) kept.busy = false;
        if (!turnDone && cancelled) {
          // An interrupt normally ends the turn at once; one that does not leaves a stuck Codex.
          setTimeout(() => { if (completed === null && liveProcesses.get(key) === kept) dropLive(liveProcesses, key); else kept.busy = false; }, CANCEL_GRACE_MS);
        } else if (!connection.alive || !turnDone) {
          if (liveProcesses.get(key) === kept) dropLive(liveProcesses, key);
        } else {
          kept.idle = setTimeout(() => { if (liveProcesses.get(key) === kept && !kept.busy) dropLive(liveProcesses, key); }, options.liveIdleMs ?? LIVE_IDLE_MS);
          (kept.idle as { unref?: () => void }).unref?.();
        }
      }
    },
  };
}

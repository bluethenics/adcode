/**
 * Coding agents over the Agent Client Protocol (agentclientprotocol.com): OpenCode, Gemini CLI,
 * GitHub Copilot, Cursor, Qwen Code, Kiro, goose and the rest of `CLI_AGENTS` with
 * `protocol: "acp"`.
 *
 * ACP is JSON-RPC 2.0, one message per line on the agent's stdin and stdout. The client sends
 * `initialize`, then `session/new` (or `session/resume` / `session/load` for a conversation
 * the agent already has), then one `session/prompt` per turn; while a prompt runs, the agent
 * streams `session/update` notifications - words, thoughts, tool calls, its plan - and may ask
 * `session/request_permission` before a tool. `session/cancel` stops a turn without ending
 * the process.
 *
 * One process serves a chat's every turn, as T3 Code runs them: only the first turn waits for
 * the agent to start. Pure apart from the injected `CliLiveSpawn`, so every rule is tested.
 */
import { HEARTBEAT_MS, LIVE_IDLE_MS, LIVE_MAX, SIGNED_OUT, activity, cliEffort, cliPrompt, cliProviderId, conversationKey, dropLive, permissionOutcome, permissionWaiting, unfinishedRunNote, withHeartbeat, type CliEvent, type CliLiveEntry, type CliLiveProcess, type CliMcpServer, type CliModelInfo, type CliPermissionAnswer, type CliPermissionAsk, type CliProviderOptions, isSafeCliToken } from "./cliAgents.ts";
import type { Provider, ProviderEvent, ProviderRequest } from "./types.ts";

export const ACP_PROTOCOL_VERSION = 1;

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);

/** What ADCode tells an agent about itself: no file or terminal service, so it uses its own tools. */
export function acpInitializeParams(): Record<string, unknown> {
  return {
    protocolVersion: ACP_PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: "adcode", title: "ADCode", version: "1" },
  };
}

/** ADCode's tool bridge as an ACP MCP server, when the agent takes HTTP servers. */
export function acpMcpServers(mcp: CliMcpServer | null, agentCapabilities: unknown): unknown[] {
  if (mcp === null || mcp.url === undefined || mcp.token === undefined) return [];
  const caps = record(agentCapabilities) && record(agentCapabilities["mcpCapabilities"]) ? agentCapabilities["mcpCapabilities"] : {};
  if (caps["http"] !== true) return [];
  return [{ type: "http", name: mcp.server, url: mcp.url, headers: [{ name: "Authorization", value: `Bearer ${mcp.token}` }] }];
}

/**
 * The models a session offers. Newer agents describe them as a `configOptions` entry of
 * category "model" (set with `session/set_config_option`); older ones as `models` (set with
 * `session/set_model`). Both are read.
 */
export function parseAcpModels(result: unknown): CliModelInfo[] {
  if (!record(result)) return [];
  const out: CliModelInfo[] = [];
  const add = (id: string, name: string, description: string, current: boolean): void => {
    if (!isSafeCliToken(id) || out.some((model) => model.id === id)) return;
    out.push({ id, name: name.slice(0, 80) || id, ...(description === "" ? {} : { description: description.slice(0, 200) }), ...(current ? { isDefault: true } : {}) });
  };
  const options = Array.isArray(result["configOptions"]) ? result["configOptions"] : [];
  const model = options.find((option) => record(option) && (option["category"] === "model" || option["id"] === "model"));
  if (record(model) && Array.isArray(model["options"])) {
    for (const option of model["options"]) if (record(option)) add(str(option["value"]), str(option["name"]), str(option["description"]), option["value"] === model["currentValue"]);
  }
  const models = record(result["models"]) ? result["models"] : null;
  if (models !== null && Array.isArray(models["availableModels"])) {
    for (const option of models["availableModels"]) if (record(option)) add(str(option["modelId"]), str(option["name"]), str(option["description"]), option["modelId"] === models["currentModelId"]);
  }
  return out.slice(0, 2000);
}

/** How to switch a session to `model`, from what `session/new` reported. Null: it cannot be chosen. */
export function acpModelRequest(sessionId: string, result: unknown, model: string): { method: string; params: Record<string, unknown> } | null {
  if (model === "default" || !record(result)) return null;
  const options = Array.isArray(result["configOptions"]) ? result["configOptions"] : [];
  const option = options.find((item) => record(item) && (item["category"] === "model" || item["id"] === "model"));
  if (record(option) && Array.isArray(option["options"]) && option["options"].some((item) => record(item) && item["value"] === model)) {
    return option["currentValue"] === model ? null : { method: "session/set_config_option", params: { sessionId, configId: str(option["id"]), value: model } };
  }
  const models = record(result["models"]) ? result["models"] : null;
  if (models !== null && Array.isArray(models["availableModels"]) && models["availableModels"].some((item) => record(item) && item["modelId"] === model)) {
    return models["currentModelId"] === model ? null : { method: "session/set_model", params: { sessionId, modelId: model } };
  }
  return null;
}

/** The reasoning level, when the session offers one as a "thought_level" option. */
export function acpEffortRequest(sessionId: string, result: unknown, effort: string | undefined): { method: string; params: Record<string, unknown> } | null {
  if (effort === undefined || !record(result) || !Array.isArray(result["configOptions"])) return null;
  const option = result["configOptions"].find((item) => record(item) && item["category"] === "thought_level");
  if (!record(option) || !Array.isArray(option["options"]) || !option["options"].some((item) => record(item) && item["value"] === effort)) return null;
  return option["currentValue"] === effort ? null : { method: "session/set_config_option", params: { sessionId, configId: str(option["id"]), value: effort } };
}

/** Tool kinds a chat lets an agent run without asking: the same reach as Claude Code's acceptEdits. */
const ALLOWED_KINDS = new Set(["read", "edit", "search", "think", "fetch", "switch_mode"]);

/**
 * The answer to `session/request_permission`. In a chat there is nobody at the agent's own
 * prompt, so ADCode answers: reading, searching and editing in the project go ahead; running
 * commands, deleting and moving files need Full access, as they would at Claude Code's
 * acceptEdits. A refusal is reported so the chat can say why the turn stopped.
 */
export function acpPermission(params: unknown, bypass: boolean): { optionId: string | null; denied: { tool: string; detail: string } | null } {
  const call = record(params) && record(params["toolCall"]) ? params["toolCall"] : {};
  const kind = str(call["kind"]);
  const allow = bypass || ALLOWED_KINDS.has(kind);
  if (allow) return { optionId: pickPermissionOption(params, ["allow_once", "allow_always"]), denied: null };
  return { optionId: pickPermissionOption(params, ["reject_once", "reject_always"]), denied: { tool: kind || "tool", detail: str(call["title"]) } };
}

/** The first of the agent's offered options of these kinds, in order of preference. */
function pickPermissionOption(params: unknown, kinds: readonly string[]): string | null {
  const options = record(params) && Array.isArray(params["options"]) ? params["options"].filter(record) : [];
  for (const wanted of kinds) {
    const option = options.find((item) => item["kind"] === wanted);
    if (option !== undefined && str(option["optionId"]) !== "") return str(option["optionId"]);
  }
  return null;
}

const ACP_KIND_ACTION: Readonly<Record<string, string>> = {
  execute: "run a command", delete: "delete a file", move: "move a file", edit: "change a file", fetch: "fetch a web page", read: "read a file", search: "search files",
};

/** A `session/request_permission` as the question put to the person. */
export function acpPermissionAsk(agent: string, params: unknown): CliPermissionAsk {
  const call = record(params) && record(params["toolCall"]) ? params["toolCall"] : {};
  const raw = record(call["rawInput"]) ? call["rawInput"] : {};
  const kind = str(call["kind"]);
  const detail = str(raw["command"]) || str(call["title"]) || str(raw["path"]) || str(raw["filePath"]);
  return { agent, action: ACP_KIND_ACTION[kind] ?? "use a tool", tool: kind || "tool", detail };
}

/** The person's answer as one of the options the agent offered. "session" prefers allow_always. */
export function acpPermissionChoice(params: unknown, answer: CliPermissionAnswer): string | null {
  if (answer === "deny") return pickPermissionOption(params, ["reject_once", "reject_always"]);
  return pickPermissionOption(params, answer === "session" ? ["allow_always", "allow_once"] : ["allow_once", "allow_always"]);
}

/** One `session/update`, as the chat's events. `state` carries which kind came last, to join streamed words. */
export function acpUpdateEvents(update: unknown, state: { last: "text" | "thought" | "other" | null }): CliEvent[] {
  if (!record(update)) return [];
  const kind = str(update["sessionUpdate"]);
  const content = record(update["content"]) ? update["content"] : {};
  switch (kind) {
    case "agent_message_chunk": {
      const text = content["type"] === "text" ? str(content["text"]) : "";
      if (text === "") return [];
      const joined = state.last === "text";
      state.last = "text";
      return [{ kind: "text", text, ...(joined ? { joined: true } : {}) }];
    }
    case "agent_thought_chunk": {
      const text = content["type"] === "text" ? str(content["text"]) : "";
      if (text === "") return [];
      state.last = "thought";
      return [{ kind: "thinking", text }];
    }
    case "tool_call": {
      state.last = "other";
      const raw = record(update["rawInput"]) ? update["rawInput"] : {};
      const detail = str(update["title"]) || str(raw["command"]) || str(raw["path"]) || str(raw["filePath"]);
      return [activity(toolVerb(str(update["kind"])), detail)];
    }
    case "tool_call_update": {
      if (update["status"] !== "failed") return [];
      state.last = "other";
      return [activity("Failed", str(update["title"]) || str(update["toolCallId"]))];
    }
    case "plan": {
      const entries = Array.isArray(update["entries"]) ? update["entries"].filter(record) : [];
      if (entries.length === 0) return [];
      state.last = "other";
      return [{ kind: "thinking", text: `${entries.map((entry) => `${entry["status"] === "completed" ? "✓" : "·"} ${str(entry["content"])}`).join("\n")}\n` }];
    }
    default:
      return [];
  }
}

function toolVerb(kind: string): string {
  switch (kind) {
    case "read": return "Read";
    case "edit": return "Edited";
    case "delete": return "Deleted";
    case "move": return "Moved";
    case "search": return "Searched";
    case "execute": return "Ran";
    case "fetch": return "Fetched";
    case "think": return "Thought";
    default: return "Used a tool";
  }
}

/** A JSON-RPC error from the agent. */
export class AcpError extends Error {
  readonly code: number;
  readonly data: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

/**
 * The protocol over one running agent: requests matched to their answers, notifications and
 * the agent's own requests handed to whoever is listening. Reads stdout for as long as the
 * process lives.
 */
export class AcpConnection {
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private ended = false;
  /** The session whose updates are wanted; updates for any other (a replayed history) are dropped. */
  listening: string | null = null;
  onUpdate: ((update: unknown) => void) | null = null;
  /** Chooses the option for a `session/request_permission`; may take as long as the person does. */
  onPermission: ((params: unknown) => string | null | Promise<string | null>) | null = null;
  /** What `initialize` returned. */
  agent: Record<string, unknown> = {};

  readonly process: CliLiveProcess;

  constructor(process: CliLiveProcess) {
    this.process = process;
    void this.pump();
  }

  get alive(): boolean {
    return !this.ended && this.process.alive();
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
    const reason = this.process.stderr().trim().split(/\r?\n/).slice(-3).join(" ");
    for (const { reject } of this.pending.values()) reject(new AcpError(-32099, reason || "it stopped"));
    this.pending.clear();
  }

  private receive(message: Record<string, unknown>): void {
    const id = message["id"];
    const method = str(message["method"]);
    if (method === "" && typeof id === "number") {
      const waiting = this.pending.get(id);
      if (waiting === undefined) return;
      this.pending.delete(id);
      if (record(message["error"])) {
        const error = message["error"];
        const code = typeof error["code"] === "number" && Number.isFinite(error["code"]) ? error["code"] : -32603;
        // The detail often says more than the message ("Authentication required: run opencode auth login").
        const data = record(error["data"]) ? str(error["data"]["message"]) || str(error["data"]["details"]) : str(error["data"]);
        waiting.reject(new AcpError(code, [str(error["message"]) || "the request failed", data].filter(Boolean).join(": "), error["data"]));
      } else waiting.resolve(message["result"]);
      return;
    }
    if (method === "session/update") {
      const params = record(message["params"]) ? message["params"] : {};
      if (this.listening !== null && params["sessionId"] === this.listening) this.onUpdate?.(params["update"]);
      return;
    }
    if (id === undefined || id === null) return;
    if (method === "session/request_permission") {
      // The agent waits for this answer, so it is always sent - "cancelled" when nobody chose.
      const handler = this.onPermission;
      void Promise.resolve()
        .then(() => handler?.(message["params"]) ?? null)
        .catch(() => null)
        .then((optionId) => { this.reply(id, { outcome: optionId === null ? { outcome: "cancelled" } : { outcome: "selected", optionId } }); });
      return;
    }
    // ADCode offered no file system or terminal, so anything else is not a method it has.
    this.send({ jsonrpc: "2.0", id, error: { code: -32601, message: `ADCode does not provide ${method}` } });
  }

  private send(message: unknown): void {
    this.process.send(JSON.stringify(message));
  }

  private reply(id: unknown, result: unknown): void {
    this.send({ jsonrpc: "2.0", id, result });
  }

  request(method: string, params: unknown): Promise<unknown> {
    if (!this.alive) return Promise.reject(new AcpError(-32099, this.process.stderr().trim().split(/\r?\n/).slice(-3).join(" ") || "it is not running"));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    if (this.alive) this.send({ jsonrpc: "2.0", method, params });
  }
}

/** A queue a turn reads its events from while its prompt runs. */
class EventQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiting: ((result: IteratorResult<T>) => void) | null = null;
  private closed = false;
  push(item: T): void {
    if (this.closed) return;
    if (this.waiting !== null) { const resolve = this.waiting; this.waiting = null; resolve({ value: item, done: false }); } else this.items.push(item);
  }
  close(): void {
    this.closed = true;
    if (this.waiting !== null) { const resolve = this.waiting; this.waiting = null; resolve({ value: undefined, done: true }); }
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => { this.waiting = resolve; });
      },
    };
  }
}

/** The agent said the person must sign in (ACP's auth_required), or its message reads that way. */
function signedOut(error: unknown): boolean {
  return (error instanceof AcpError && error.code === -32000) || (error instanceof Error && SIGNED_OUT.test(error.message));
}

/** A kept agent stopped this long after a cancel is not trusted with another turn. */
const CANCEL_GRACE_MS = 5_000;

/** A chat answered by an ACP agent: the same options as `createCliProvider`, with `live` required. */
export function createAcpProvider(options: CliProviderOptions): Provider {
  const { spec } = options;
  const sessions = options.sessions ?? new Map<string, { id: string; messages: number }>();
  const liveProcesses = options.liveProcesses ?? new Map<string, CliLiveEntry>();
  const acpArgs = spec.acpArgs ?? [];
  return {
    id: cliProviderId(spec.id),
    displayName: spec.name,
    models: options.models,
    async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      const live = options.live;
      if (live === undefined) throw Object.assign(new Error(`${spec.name}: it needs a running process, which this build cannot start.`), { code: "cli-failed", retryable: false });
      const chat = options.conversation?.();
      const key = chat !== undefined && chat !== "" ? `${spec.id}:${request.model}:chat:${chat}` : conversationKey(spec.id, request.model, request);
      const prior = sessions.get(key);
      const resume = prior !== undefined && request.messages.length > prior.messages;
      const bypass = options.bypassPermissions?.() === true;
      const mcp = options.mcp?.() ?? null;
      const cwd = options.cwd();
      const effort = cliEffort(request, options.modelEfforts).effort;
      // Access and tools are settled per session, so a change to either starts afresh.
      const signature = JSON.stringify([cwd, acpArgs, request.model, effort ?? null, bypass, mcp?.url ?? null]);
      const fail = (error: unknown): never => {
        const message = error instanceof Error ? error.message : String(error);
        const out = signedOut(error);
        throw Object.assign(new Error(`${spec.name}: ${message}${out ? ` Sign in by running \`${spec.signIn}\` in a terminal, then send your message again.` : ""}`), { code: out ? "cli-signed-out" : "cli-failed", retryable: false });
      };

      let entry = liveProcesses.get(key);
      let continued = false;
      if (entry !== undefined && !entry.busy && entry.signature === signature && resume && entry.session === prior.id && (entry.acp as AcpConnection | undefined)?.alive === true) {
        if (entry.idle !== undefined) clearTimeout(entry.idle);
        continued = true;
      } else {
        if (entry?.busy === true) fail(new Error("it is still answering the previous message in this chat."));
        dropLive(liveProcesses, key);
        for (const [other, kept] of [...liveProcesses].sort((a, b) => a[1].usedAt - b[1].usedAt)) {
          if (liveProcesses.size < LIVE_MAX) break;
          if (!kept.busy) dropLive(liveProcesses, other);
        }
        const process = live(spec.command, acpArgs, { cwd });
        entry = { process, signature, session: null, busy: false, usedAt: Date.now(), acp: new AcpConnection(process) };
        liveProcesses.set(key, entry);
      }
      const kept = entry;
      const connection = kept.acp as AcpConnection;
      kept.busy = true;
      kept.usedAt = Date.now();

      let promptDone = false;
      let cancelled = false;
      try {
        // A new process: introduce ADCode, then pick the conversation up or start one.
        if (!continued) {
          yield { kind: "status", text: `Starting ${spec.name}…` };
          try {
            const introduced = await connection.request("initialize", acpInitializeParams());
            connection.agent = record(introduced) ? introduced : {};
          } catch (error) { fail(error); }
          const servers = acpMcpServers(mcp, connection.agent["agentCapabilities"]);
          let session: Record<string, unknown> | null = null;
          if (resume) {
            const caps = record(connection.agent["agentCapabilities"]) ? connection.agent["agentCapabilities"] : {};
            const sessionCaps = record(caps["sessionCapabilities"]) ? caps["sessionCapabilities"] : {};
            // Resume continues without replaying; load replays the history, which is not wanted.
            for (const method of [...(record(sessionCaps["resume"]) || sessionCaps["resume"] === true ? ["session/resume"] : []), ...(caps["loadSession"] === true ? ["session/load"] : [])]) {
              try {
                const result = await connection.request(method, { sessionId: prior.id, cwd, mcpServers: servers });
                session = { ...(record(result) ? result : {}), sessionId: prior.id };
                break;
              } catch { /* Gone or not resumable: try the next way, then start afresh. */ }
            }
          }
          continued = session !== null;
          if (session === null) {
            try {
              const result = await connection.request("session/new", { cwd, mcpServers: servers });
              session = record(result) ? result : {};
            } catch (error) { fail(error); }
          }
          const sessionId = str(session!["sessionId"]);
          if (sessionId === "") fail(new Error("it did not start a session."));
          kept.session = sessionId;
          for (const change of [acpModelRequest(sessionId, session, request.model), acpEffortRequest(sessionId, session, effort)]) {
            if (change === null) continue;
            try { await connection.request(change.method, change.params); } catch (error) { fail(error); }
          }
        }
        const sessionId = kept.session!;
        sessions.set(key, { id: sessionId, messages: request.messages.length });

        const queue = new EventQueue<CliEvent | { kind: "end" }>();
        const state: { last: "text" | "thought" | "other" | null } = { last: null };
        const denied: { tool: string; detail: string }[] = [];
        connection.listening = sessionId;
        connection.onUpdate = (update) => { for (const event of acpUpdateEvents(update, state)) queue.push(event); };
        /** Questions the person has not answered yet: the silence is theirs, not the agent's. */
        let waitingOnPerson = 0;
        connection.onPermission = (params) => {
          const answer = acpPermission(params, bypass);
          if (answer.denied === null) return answer.optionId;
          const asker = options.askPermission;
          if (asker === undefined || signal.aborted) {
            denied.push(answer.denied);
            queue.push({ kind: "thinking", text: `› Not allowed in a chat: ${answer.denied.tool}${answer.denied.detail ? ` (${answer.denied.detail.slice(0, 120)})` : ""}\n` });
            return answer.optionId;
          }
          // Running a command or deleting a file: the person decides, in ADCode's own dialog.
          const ask = acpPermissionAsk(spec.name, params);
          waitingOnPerson += 1;
          queue.push({ kind: "status", text: permissionWaiting(ask) });
          return asker(ask, signal)
            .catch((): CliPermissionAnswer => "deny")
            .then((choice) => {
              queue.push({ kind: "thinking", text: permissionOutcome(ask, choice) });
              return acpPermissionChoice(params, choice);
            })
            .finally(() => { waitingOnPerson -= 1; });
        };
        // Stop shows at once: the turn ends here, while the agent winds its own turn down.
        const stop = (): void => { cancelled = true; connection.notify("session/cancel", { sessionId }); queue.push({ kind: "end" }); };
        signal.addEventListener("abort", stop, { once: true });
        let result: unknown = null;
        let failure: unknown = null;
        const prompt = connection.request("session/prompt", { sessionId, prompt: [{ type: "text", text: cliPrompt(request, continued) }] })
          .then((value) => { result = value; }, (error: unknown) => { failure = error; })
          // A cancelled prompt that comes back leaves the agent ready for the next message.
          .finally(() => { promptDone = true; if (cancelled) kept.busy = false; queue.push({ kind: "end" }); });
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
              lastText = event.joined === true ? lastText + event.text : event.text;
              yield { kind: "text", text };
            } else if (event.kind === "thinking") yield { kind: "thinking", text: event.text };
          }
          if (!signal.aborted) await prompt;
        } finally {
          signal.removeEventListener("abort", stop);
          connection.onUpdate = null;
          connection.onPermission = null;
        }
        if (signal.aborted) { yield { kind: "stop", reason: "cancelled" }; return; }
        if (failure !== null) fail(failure);
        const done = record(result) ? result : {};
        const usage = record(done["usage"]) ? done["usage"] : {};
        const cached = num(usage["cachedReadTokens"]);
        const input = num(usage["inputTokens"]) + cached + num(usage["cachedWriteTokens"]);
        const stopReason = str(done["stopReason"]);
        if (stopReason === "refusal" && !wrote) fail(new Error("it declined to answer that."));
        const note = denied.length > 0 && !wrote ? unfinishedRunNote(spec.name, null, denied, bypass) : stopReason === "max_turn_requests" ? `${spec.name} stopped at its own step limit. Say "continue" to pick up where it stopped.` : null;
        if (note !== null) yield { kind: "text", text: `${wrote && !lastText.endsWith("\n") ? "\n\n" : ""}${note}` };
        if (input + num(usage["outputTokens"]) > 0) yield { kind: "usage", inputTokens: input, outputTokens: num(usage["outputTokens"]) + num(usage["thoughtTokens"]), cachedTokens: cached };
        yield { kind: "stop", reason: stopReason === "max_tokens" ? "max-tokens" : "end-turn" };
      } finally {
        if (promptDone || !cancelled) kept.busy = false;
        if (!promptDone && cancelled) {
          // A cancel normally ends the prompt at once; one that does not leaves a stuck agent.
          setTimeout(() => { if (!promptDone && liveProcesses.get(key) === kept) dropLive(liveProcesses, key); else kept.busy = false; }, CANCEL_GRACE_MS);
        } else if (!connection.alive || (!promptDone && !cancelled)) {
          if (liveProcesses.get(key) === kept) dropLive(liveProcesses, key);
        } else {
          kept.idle = setTimeout(() => { if (liveProcesses.get(key) === kept && !kept.busy) dropLive(liveProcesses, key); }, options.liveIdleMs ?? LIVE_IDLE_MS);
          (kept.idle as { unref?: () => void }).unref?.();
        }
      }
    },
  };
}

/**
 * Coding CLIs already installed on this computer, used as models inside ADCode.
 *
 * Claude Code, Codex, OpenCode and Gemini CLI each have a headless mode that takes a prompt on
 * stdin and streams JSON events. Wrapping that as a `Provider` puts the CLI in ADCode's model
 * picker: the person chats in ADCode's chat, with its history, editor context and usage view,
 * while the CLI answers with its own model, account and tools. Billing stays with the CLI's own
 * subscription; ADCode never sees its credentials.
 *
 * Some CLIs have no headless mode at all (Freebuff is an interactive TUI). Those are offered as
 * terminal agents instead: `headless: false`, and the desktop opens them in a terminal tab.
 *
 * Pure: no Node, no Electron. The desktop injects `spawn`, so every parser here is tested against
 * the CLIs' real output captured as strings.
 */
import type { Message, Provider, ProviderEvent, ProviderRequest } from "./types.ts";

export type CliAgentId = "claude" | "codex" | "opencode" | "gemini" | "freebuff";

export interface CliAgentSpec {
  readonly id: CliAgentId;
  readonly name: string;
  /** The executable's name on PATH. */
  readonly command: string;
  /** Takes a prompt and answers without a terminal. False: offered as a terminal agent only. */
  readonly headless: boolean;
  /** Models offered before any are listed: "default" is whatever the CLI is set to use. */
  readonly models: readonly string[];
  /** Arguments that print the CLI's own model list, one per line; missing when it has none. */
  readonly listModels?: readonly string[];
  /** What to run in a terminal to sign in, when the CLI reports it is signed out. */
  readonly signIn: string;
  readonly install: string;
  readonly docs: string;
}

export const CLI_AGENTS: readonly CliAgentSpec[] = [
  { id: "claude", name: "Claude Code", command: "claude", headless: true, models: ["default", "opus", "sonnet", "haiku"], signIn: "claude", install: "npm install -g @anthropic-ai/claude-code", docs: "https://docs.claude.com/en/docs/claude-code/overview" },
  { id: "codex", name: "Codex CLI", command: "codex", headless: true, models: ["default"], signIn: "codex login", install: "npm install -g @openai/codex", docs: "https://developers.openai.com/codex/cli" },
  { id: "opencode", name: "OpenCode", command: "opencode", headless: true, models: ["default"], listModels: ["models"], signIn: "opencode auth login", install: "npm install -g opencode-ai", docs: "https://opencode.ai/docs/cli/" },
  { id: "gemini", name: "Gemini CLI", command: "gemini", headless: true, models: ["default"], signIn: "gemini", install: "npm install -g @google/gemini-cli", docs: "https://github.com/google-gemini/gemini-cli" },
  { id: "freebuff", name: "Freebuff", command: "freebuff", headless: false, models: [], signIn: "freebuff login", install: "npm install -g freebuff", docs: "https://www.npmjs.com/package/freebuff" },
];

/** Provider ids are `cli-<agent>`, so they can never collide with a catalogue provider. */
export const CLI_PROVIDER_PREFIX = "cli-";
export const cliProviderId = (id: CliAgentId): string => `${CLI_PROVIDER_PREFIX}${id}`;
export function cliAgentFor(providerId: string): CliAgentSpec | undefined {
  return providerId.startsWith(CLI_PROVIDER_PREFIX) ? CLI_AGENTS.find((agent) => `${CLI_PROVIDER_PREFIX}${agent.id}` === providerId) : undefined;
}

/**
 * A model name safe to pass as one argument. On Windows these CLIs are `.cmd` shims that need a
 * shell, so everything that reaches an argument list is held to characters no shell treats
 * specially. The prompt never does: it goes on stdin.
 */
export function isSafeCliToken(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:/@+=-]{0,199}$/.test(value);
}

/** The arguments for one headless turn. `session` resumes the CLI's own conversation. */
export function cliArgs(id: CliAgentId, options: { readonly model: string; readonly session?: string }): string[] {
  const model = options.model !== "default" && isSafeCliToken(options.model) ? options.model : null;
  const session = options.session !== undefined && isSafeCliToken(options.session) ? options.session : null;
  switch (id) {
    case "claude":
      // acceptEdits: it may edit files in the project, but shell commands still need the
      // person's own allow-list, as they would at its prompt.
      return ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "acceptEdits", ...(model ? ["--model", model] : []), ...(session ? ["--resume", session] : [])];
    case "codex":
      // `-` reads the prompt from stdin. workspace-write: edits inside the project, no network.
      return ["exec", ...(session ? ["resume", session] : []), "--json", "--skip-git-repo-check", ...(session ? [] : ["--sandbox", "workspace-write"]), ...(model ? ["-m", model] : []), "-"];
    case "opencode":
      return ["run", "--format", "json", ...(model ? ["-m", model] : []), ...(session ? ["--session", session] : [])];
    case "gemini":
      return ["--output-format", "stream-json", ...(model ? ["-m", model] : []), ...(session ? ["--resume", session] : [])];
    case "freebuff":
      return [];
  }
}

/** Model ids from a CLI's list command: one `provider/model` per line, nothing else. */
export function parseModelList(output: string): string[] {
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const model = line.trim();
    if (/^[A-Za-z0-9][\w.-]*\/\S+$/.test(model) && isSafeCliToken(model)) seen.add(model);
  }
  return [...seen].slice(0, 2000);
}

/* ── Turning a conversation into one prompt ─────────────────────────────── */

const MAX_TRANSCRIPT = 60_000;
const MAX_CONTEXT = 8_000;

function messageText(message: Message): string {
  return message.content.map((block) => {
    if (block.type === "text") return block.text;
    if (block.type === "image") return "[image]";
    if (block.type === "tool-call") return `[used ${block.name}]`;
    return "";
  }).filter((part) => part.trim() !== "").join("\n").trim();
}

/**
 * What ADCode adds that the CLI cannot know: the editor's live context (the open file, the
 * selection, the cursor line) - the part of the system prompt after its stable instructions.
 * ADCode's own tool instructions are left out: the CLI brings its own tools.
 */
export function editorContext(request: ProviderRequest): string {
  const stable = request.cache?.stableSystem;
  if (stable === undefined || stable >= request.system.length) return "";
  const context = request.system.slice(stable).trim();
  return context.length > MAX_CONTEXT ? `${context.slice(0, MAX_CONTEXT)}\n[context shortened]` : context;
}

/**
 * The prompt for one turn. Resuming sends only the newest message: the CLI remembers the rest.
 * Starting fresh in the middle of a chat (it began with another model) sends the conversation
 * so far as a transcript, newest kept when it is long.
 */
export function cliPrompt(request: ProviderRequest, resume: boolean): string {
  const users = request.messages.filter((message) => message.role === "user" && messageText(message) !== "");
  const latest = users.at(-1);
  const ask = latest === undefined ? "" : messageText(latest);
  const context = editorContext(request);
  const parts: string[] = [];
  if (context !== "") parts.push(`Context from the ADCode editor:\n${context}`);
  const earlier = resume ? [] : request.messages.slice(0, latest === undefined ? 0 : request.messages.lastIndexOf(latest));
  const lines = earlier.map((message) => ({ role: message.role === "user" ? "User" : "Assistant", text: messageText(message) })).filter((line) => line.text !== "");
  if (lines.length > 0) {
    let transcript = lines.map((line) => `${line.role}: ${line.text}`).join("\n\n");
    if (transcript.length > MAX_TRANSCRIPT) transcript = `[earlier messages left out]\n${transcript.slice(-MAX_TRANSCRIPT)}`;
    parts.push(`The conversation so far:\n${transcript}`);
  }
  parts.push(parts.length > 0 ? `Now:\n${ask}` : ask);
  return parts.join("\n\n");
}

/** A conversation's identity across turns: the CLI, the model, and how it began. */
export function conversationKey(id: CliAgentId, model: string, request: ProviderRequest): string {
  const first = request.messages.find((message) => message.role === "user");
  const text = `${id}\u0000${model}\u0000${first === undefined ? "" : messageText(first)}`;
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  return `${id}:${hash.toString(36)}:${text.length}`;
}

/* ── Reading each CLI's events ──────────────────────────────────────────── */

export type CliEvent =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "thinking"; readonly text: string }
  | { readonly kind: "session"; readonly id: string }
  | { readonly kind: "usage"; readonly input: number; readonly output: number; readonly cached: number }
  | { readonly kind: "error"; readonly message: string };

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);

/** One line of a tool's activity, as a person would say it. */
function activity(verb: string, detail: string): CliEvent {
  const line = detail.replace(/\s+/g, " ").trim();
  return { kind: "thinking", text: `› ${verb}${line ? `: ${line.length > 160 ? `${line.slice(0, 157)}…` : line}` : ""}\n` };
}

function toolDetail(input: unknown): string {
  if (!record(input)) return "";
  for (const key of ["command", "file_path", "filePath", "path", "pattern", "query", "url", "description"]) if (typeof input[key] === "string") return input[key];
  return "";
}

/** A provider's error, which some CLIs pass along as a JSON string inside their own message. */
function errorText(raw: unknown): string {
  const text = record(raw) ? str(raw["message"]) || str(record(raw["data"]) ? raw["data"]["message"] : "") || str(raw["name"]) : str(raw);
  try {
    const inner: unknown = JSON.parse(text);
    if (record(inner)) return str(record(inner["error"]) ? inner["error"]["message"] : "") || str(inner["message"]) || text;
  } catch { /* Not JSON: the text is the message. */ }
  return text;
}

function claudeLine(event: Record<string, unknown>): CliEvent[] {
  const out: CliEvent[] = [];
  if (typeof event["session_id"] === "string" && (event["type"] === "system" || event["type"] === "result")) out.push({ kind: "session", id: event["session_id"] });
  if (event["type"] === "assistant" && record(event["message"])) {
    // "<synthetic>" messages are the CLI talking about itself ("Not logged in"); the result
    // line repeats them as an error, which is where they belong.
    if (event["message"]["model"] === "<synthetic>") return out;
    const content = Array.isArray(event["message"]["content"]) ? event["message"]["content"] : [];
    for (const block of content) {
      if (!record(block)) continue;
      if (block["type"] === "text" && str(block["text"])) out.push({ kind: "text", text: str(block["text"]) });
      else if (block["type"] === "thinking" && str(block["thinking"])) out.push({ kind: "thinking", text: str(block["thinking"]) });
      else if (block["type"] === "tool_use") out.push(activity(str(block["name"]) || "Tool", toolDetail(block["input"])));
    }
  }
  if (event["type"] === "result") {
    const usage = record(event["usage"]) ? event["usage"] : {};
    out.push({ kind: "usage", input: num(usage["input_tokens"]) + num(usage["cache_read_input_tokens"]) + num(usage["cache_creation_input_tokens"]), output: num(usage["output_tokens"]), cached: num(usage["cache_read_input_tokens"]) });
    if (event["is_error"] === true) out.push({ kind: "error", message: str(event["result"]) || str(event["terminal_reason"]) || "the request failed" });
  }
  return out;
}

function codexLine(event: Record<string, unknown>): CliEvent[] {
  const type = str(event["type"]);
  if (type === "thread.started" && typeof event["thread_id"] === "string") return [{ kind: "session", id: event["thread_id"] }];
  if (type === "turn.failed") return [{ kind: "error", message: errorText(event["error"]) || "the turn failed" }];
  if (type === "error") return [{ kind: "error", message: errorText(event["message"]) }];
  if (type === "turn.completed" && record(event["usage"])) {
    const usage = event["usage"];
    return [{ kind: "usage", input: num(usage["input_tokens"]), output: num(usage["output_tokens"]), cached: num(usage["cached_input_tokens"]) }];
  }
  if (type !== "item.completed" || !record(event["item"])) return [];
  const item = event["item"];
  switch (item["type"]) {
    case "agent_message": return str(item["text"]) ? [{ kind: "text", text: str(item["text"]) }] : [];
    case "reasoning": return str(item["text"]) ? [{ kind: "thinking", text: `${str(item["text"])}\n` }] : [];
    case "command_execution": return [activity("Ran", `${str(item["command"])}${typeof item["exit_code"] === "number" && item["exit_code"] !== 0 ? ` (exit ${item["exit_code"]})` : ""}`)];
    case "file_change": return [activity("Changed", (Array.isArray(item["changes"]) ? item["changes"] : []).map((change) => (record(change) ? str(change["path"]) : "")).filter(Boolean).join(", "))];
    case "mcp_tool_call": return [activity("Used", `${str(item["server"])} ${str(item["tool"])}`)];
    case "web_search": return [activity("Searched", str(item["query"]))];
    // "error" items are configuration warnings; a real failure arrives as turn.failed.
    default: return [];
  }
}

function openCodeLine(event: Record<string, unknown>): CliEvent[] {
  const out: CliEvent[] = [];
  if (typeof event["sessionID"] === "string") out.push({ kind: "session", id: event["sessionID"] });
  const part = record(event["part"]) ? event["part"] : {};
  switch (event["type"]) {
    case "text": if (str(part["text"])) out.push({ kind: "text", text: str(part["text"]) }); break;
    case "reasoning": if (str(part["text"])) out.push({ kind: "thinking", text: `${str(part["text"])}\n` }); break;
    case "tool_use": {
      const state = record(part["state"]) ? part["state"] : {};
      out.push(activity(str(part["tool"]) || "Tool", str(state["title"]) || toolDetail(state["input"])));
      break;
    }
    case "step_finish": {
      const tokens = record(part["tokens"]) ? part["tokens"] : {};
      const cache = record(tokens["cache"]) ? tokens["cache"] : {};
      out.push({ kind: "usage", input: num(tokens["input"]) + num(cache["read"]), output: num(tokens["output"]) + num(tokens["reasoning"]), cached: num(cache["read"]) });
      break;
    }
    case "error": out.push({ kind: "error", message: errorText(event["error"]) || "the request failed" }); break;
  }
  return out;
}

function geminiLine(event: Record<string, unknown>): CliEvent[] {
  const out: CliEvent[] = [];
  if (event["type"] === "init" && typeof event["session_id"] === "string") out.push({ kind: "session", id: event["session_id"] });
  if (event["type"] === "message" && event["role"] === "assistant" && str(event["content"])) out.push({ kind: "text", text: str(event["content"]) });
  if (event["type"] === "tool_use") out.push(activity(str(event["tool_name"]) || "Tool", toolDetail(event["parameters"])));
  if (event["type"] === "error") out.push({ kind: "error", message: errorText(event["message"] ?? event["error"]) });
  if (event["type"] === "result") {
    const stats = record(event["stats"]) ? event["stats"] : {};
    out.push({ kind: "usage", input: num(stats["input_tokens"]), output: num(stats["output_tokens"]), cached: num(stats["cached"]) });
    if (event["status"] === "error") out.push({ kind: "error", message: errorText(event["error"]) || "the request failed" });
  }
  return out;
}

/**
 * One CLI's stdout, line by line. Lines that are not JSON - a banner, a progress spinner, a
 * warning some versions print - are dropped rather than shown as the model's words.
 */
export function createCliLineParser(id: CliAgentId): (line: string) => CliEvent[] {
  const read = id === "claude" ? claudeLine : id === "codex" ? codexLine : id === "opencode" ? openCodeLine : id === "gemini" ? geminiLine : () => [];
  return (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) return [];
    try {
      const event: unknown = JSON.parse(trimmed);
      return record(event) ? read(event) : [];
    } catch {
      return [];
    }
  };
}

/* ── The provider ───────────────────────────────────────────────────────── */

export interface CliProcess {
  /** stdout, one line at a time, ending when the process closes it. */
  readonly lines: AsyncIterable<string>;
  /** Resolves with the exit code once the process has ended. */
  readonly exit: Promise<number | null>;
  /** The end of stderr, for an error message when nothing else explains a failure. */
  stderr(): string;
  kill(): void;
}

/** Starts `command args` in `cwd`, writes `input` to its stdin and closes it. */
export type CliSpawn = (command: string, args: readonly string[], options: { readonly cwd: string; readonly input: string }) => CliProcess;

export interface CliProviderOptions {
  readonly spec: CliAgentSpec;
  readonly models: readonly string[];
  readonly spawn: CliSpawn;
  /** The open project, where the CLI works; resolved per request. */
  readonly cwd: () => string;
  /** Shared across providers built for the same CLI, so a rebuilt provider still resumes. */
  readonly sessions?: Map<string, { readonly id: string; readonly messages: number }>;
}

const SIGNED_OUT = /not logged in|please run \/login|not authenticated|unauthori[sz]ed|login required|sign in|api key/i;

export function createCliProvider(options: CliProviderOptions): Provider {
  const { spec } = options;
  const sessions = options.sessions ?? new Map<string, { id: string; messages: number }>();
  return {
    id: cliProviderId(spec.id),
    displayName: spec.name,
    models: options.models,
    async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      const key = conversationKey(spec.id, request.model, request);
      const prior = sessions.get(key);
      const resume = prior !== undefined && request.messages.length > prior.messages;
      const process = options.spawn(spec.command, cliArgs(spec.id, { model: request.model, ...(resume ? { session: prior.id } : {}) }), { cwd: options.cwd(), input: cliPrompt(request, resume) });
      const stop = (): void => process.kill();
      signal.addEventListener("abort", stop, { once: true });
      const parse = createCliLineParser(spec.id);
      let session: string | null = null;
      let failure: string | null = null;
      let wrote = false;
      let lastText = "";
      const usage = { input: 0, output: 0, cached: 0 };
      try {
        for await (const line of process.lines) {
          if (signal.aborted) break;
          for (const event of parse(line)) {
            if (event.kind === "session") session = event.id;
            else if (event.kind === "usage") { usage.input += event.input; usage.output += event.output; usage.cached += event.cached; }
            else if (event.kind === "error") failure ??= event.message;
            else if (event.kind === "text") {
              // Separate answers the CLI sent as separate messages, as it would show them.
              const text = wrote && !lastText.endsWith("\n") && !event.text.startsWith("\n") ? `\n\n${event.text}` : event.text;
              wrote = true; lastText = event.text;
              yield { kind: "text", text };
            } else yield { kind: "thinking", text: event.text };
          }
        }
        const code = await process.exit;
        if (signal.aborted) { yield { kind: "stop", reason: "cancelled" }; return; }
        if (failure === null && code !== 0 && !wrote) failure = process.stderr().trim().split(/\r?\n/).slice(-3).join(" ") || `it exited with code ${String(code)}`;
        if (failure !== null) {
          const hint = SIGNED_OUT.test(failure) ? ` Sign in by running \`${spec.signIn}\` in a terminal, then send your message again.` : "";
          throw Object.assign(new Error(`${spec.name}: ${failure}${hint}`), { code: SIGNED_OUT.test(failure) ? "cli-signed-out" : "cli-failed", retryable: false });
        }
        if (session !== null) sessions.set(key, { id: session, messages: request.messages.length });
        if (usage.input + usage.output > 0) yield { kind: "usage", inputTokens: usage.input, outputTokens: usage.output, cachedTokens: usage.cached };
        yield { kind: "stop", reason: "end-turn" };
      } finally {
        signal.removeEventListener("abort", stop);
        if (!signal.aborted) process.kill();
      }
    },
  };
}

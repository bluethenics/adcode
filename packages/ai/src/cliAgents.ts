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
import { effortFor } from "./effort.ts";

export type CliAgentId =
  | "claude" | "codex" | "opencode" | "gemini" | "freebuff"
  // Agents that speak the Agent Client Protocol (acp.ts), taken from the public ACP registry.
  | "copilot" | "cursor" | "qwen" | "kiro" | "goose" | "kimi" | "droid" | "auggie" | "cline"
  | "kilo" | "grok" | "qoder" | "codebuddy" | "devin" | "vibe";

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
  /**
   * How to ask the CLI which models this account can use, when it has no list command:
   * Claude Code answers an `initialize` control request on its stream-JSON input, Codex a
   * `model/list` call on its app-server. Both report names and descriptions, and only what
   * the signed-in account is offered - so the list is live, not a copy kept in ADCode.
   */
  readonly modelProtocol?: "claude-initialize" | "codex-app-server" | "acp";
  /**
   * "acp": the agent speaks the Agent Client Protocol (JSON-RPC on stdio) when started with
   * `acpArgs`. One process then serves a chat's every turn (acp.ts), so only the first waits
   * for it to start: OpenCode measured 10-14 s a message through `opencode run`, 5.6 s for a
   * message to a running `opencode acp` (both with its free big-pickle model).
   */
  readonly protocol?: "acp";
  readonly acpArgs?: readonly string[];
  /**
   * Listed even when it is not installed, with a way to install it. The rest are listed only
   * once they are on this computer, so the model picker is not a wall of Install buttons.
   */
  readonly featured?: boolean;
  /** The npm package it installs from, for telling the person a newer version is out. */
  readonly npmPackage?: string;
  /** What to run in a terminal to sign in, when the CLI reports it is signed out. */
  readonly signIn: string;
  readonly install: string;
  readonly docs: string;
}

/**
 * ACP agents, as the public registry (cdn.agentclientprotocol.com/registry/v1) launches them,
 * checked 21 Nov 2026. Each is found on PATH by `command`, never downloaded by ADCode. An agent
 * with no one-line npm install has `install: ""`: it is listed only once installed, and the
 * docs link says how. An agent whose ACP switch needs a character `isSafeCliToken` refuses (Junie's `--acp=true`) is left out.
 */
const acp = (id: CliAgentId, name: string, command: string, acpArgs: readonly string[], extra: { signIn?: string; install: string; docs: string; npmPackage?: string; featured?: boolean }): CliAgentSpec => ({
  id, name, command, headless: true, models: ["default"], modelProtocol: "acp", protocol: "acp", acpArgs, signIn: extra.signIn ?? command, install: extra.install, docs: extra.docs,
  ...(extra.npmPackage === undefined ? {} : { npmPackage: extra.npmPackage }), ...(extra.featured === true ? { featured: true } : {}),
});

export const CLI_AGENTS: readonly CliAgentSpec[] = [
  { id: "claude", name: "Claude Code", command: "claude", headless: true, featured: true, npmPackage: "@anthropic-ai/claude-code", models: ["default", "opus", "sonnet", "haiku"], modelProtocol: "claude-initialize", signIn: "claude", install: "npm install -g @anthropic-ai/claude-code", docs: "https://docs.claude.com/en/docs/claude-code/overview" },
  { id: "codex", name: "Codex CLI", command: "codex", headless: true, featured: true, npmPackage: "@openai/codex", models: ["default"], modelProtocol: "codex-app-server", signIn: "codex login", install: "npm install -g @openai/codex", docs: "https://developers.openai.com/codex/cli" },
  acp("opencode", "OpenCode", "opencode", ["acp"], { featured: true, npmPackage: "opencode-ai", signIn: "opencode auth login", install: "npm install -g opencode-ai", docs: "https://opencode.ai/docs/acp/" }),
  acp("gemini", "Gemini CLI", "gemini", ["--acp"], { featured: true, npmPackage: "@google/gemini-cli", install: "npm install -g @google/gemini-cli", docs: "https://geminicli.com" }),
  acp("copilot", "GitHub Copilot CLI", "copilot", ["--acp"], { featured: true, npmPackage: "@github/copilot", install: "npm install -g @github/copilot", docs: "https://github.com/features/copilot/cli/" }),
  acp("cursor", "Cursor Agent", "cursor-agent", ["acp"], { signIn: "cursor-agent login", install: "", docs: "https://cursor.com/docs/cli/acp" }),
  acp("qwen", "Qwen Code", "qwen", ["--acp"], { npmPackage: "@qwen-code/qwen-code", install: "npm install -g @qwen-code/qwen-code", docs: "https://qwenlm.github.io/qwen-code-docs/en/users/overview" }),
  acp("kiro", "Kiro CLI", "kiro-cli", ["acp"], { signIn: "kiro-cli login", install: "", docs: "https://kiro.dev/docs/cli/acp/" }),
  acp("goose", "goose", "goose", ["acp"], { signIn: "goose configure", install: "", docs: "https://block.github.io/goose/" }),
  acp("kimi", "Kimi Code", "kimi", ["acp"], { npmPackage: "@moonshot-ai/kimi-code", install: "npm install -g @moonshot-ai/kimi-code", docs: "https://moonshotai.github.io/kimi-code/" }),
  acp("droid", "Factory Droid", "droid", ["exec", "--output-format", "acp-daemon"], { npmPackage: "droid", install: "npm install -g droid", docs: "https://factory.ai/product/cli" }),
  acp("auggie", "Auggie CLI", "auggie", ["--acp"], { signIn: "auggie login", npmPackage: "@augmentcode/auggie", install: "npm install -g @augmentcode/auggie", docs: "https://www.augmentcode.com/" }),
  acp("cline", "Cline", "cline", ["--acp"], { signIn: "cline auth", npmPackage: "cline", install: "npm install -g cline", docs: "https://cline.bot/cli" }),
  acp("kilo", "Kilo", "kilo", ["acp"], { signIn: "kilo auth login", install: "", docs: "https://kilo.ai/" }),
  acp("grok", "Grok Build", "grok", ["agent", "stdio"], { npmPackage: "@xai-official/grok", install: "npm install -g @xai-official/grok", docs: "https://x.ai/cli" }),
  acp("qoder", "Qoder CLI", "qodercli", ["--acp"], { npmPackage: "@qoder-ai/qodercli", install: "npm install -g @qoder-ai/qodercli", docs: "https://qoder.com" }),
  acp("codebuddy", "CodeBuddy Code", "codebuddy", ["--acp"], { npmPackage: "@tencent-ai/codebuddy-code", install: "npm install -g @tencent-ai/codebuddy-code", docs: "https://www.codebuddy.cn/cli/" }),
  acp("devin", "Devin", "devin", ["acp"], { signIn: "devin login", install: "", docs: "https://docs.devin.ai/cli" }),
  acp("vibe", "Mistral Vibe", "vibe-acp", [], { signIn: "vibe", install: "", docs: "https://mistral.ai/products/vibe" }),
  { id: "freebuff", name: "Freebuff", command: "freebuff", headless: false, featured: true, npmPackage: "freebuff", models: [], signIn: "freebuff login", install: "npm install -g freebuff", docs: "https://www.npmjs.com/package/freebuff" },
];

/** The first x.y.z in a `--version` line ("2.1.284 (Claude Code)", "opencode 1.19.5"). */
export function cliVersionNumber(line: string | null): string | null {
  return line === null ? null : /\b(\d+)\.(\d+)\.(\d+)\b/.exec(line)?.[0] ?? null;
}

/** True when `latest` is a later x.y.z than what `installed` says. Anything unreadable is not newer. */
export function isNewerCliVersion(installed: string | null, latest: string | null): boolean {
  const have = cliVersionNumber(installed);
  const out = cliVersionNumber(latest);
  if (have === null || out === null) return false;
  const a = have.split(".").map(Number);
  const b = out.split(".").map(Number);
  for (let index = 0; index < 3; index++) if (b[index]! !== a[index]!) return b[index]! > a[index]!;
  return false;
}

/** The terminal command that updates an npm-installed agent; null for one installed another way. */
export function cliUpdateCommand(spec: CliAgentSpec): string | null {
  return spec.npmPackage === undefined || !/^(@[a-z0-9-]+\/)?[a-z0-9][a-z0-9.-]*$/.test(spec.npmPackage) ? null : `npm install -g ${spec.npmPackage}@latest`;
}

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
  // `_` is inert in cmd.exe and POSIX shells alike; it is here for `mcp__adcode`. A leading
  // `/` lets an absolute POSIX path through (the tool bridge's config file); a leading `-`
  // stays out, since that would be read as an option.
  return /^[A-Za-z0-9/][\w.:/@+=-]{0,199}$/.test(value);
}

/**
 * An MCP server for the CLI to load for one turn: ADCode's tool bridge. `configPath` is a
 * file in the CLI's own config format (JSON cannot pass `isSafeCliToken`, a path can), and
 * `server` is the name inside it, which the CLI uses to name the server's tools.
 */
export interface CliMcpServer {
  /** Claude Code's `--mcp-config` file. Must pass `isSafeCliToken`, or Claude Code runs without it. */
  readonly configPath: string;
  readonly server: string;
  /** The bridge's address, for Codex's `-c mcp_servers.<server>.url=` override. */
  readonly url?: string;
  /** The key, handed to Codex through `CLI_BRIDGE_TOKEN_ENV`, never on the command line. */
  readonly token?: string;
  /** OpenCode's config file with the server in it, handed over as `OPENCODE_CONFIG`. */
  readonly openCodeConfig?: string;
}

/**
 * The environment variable Codex reads the bridge's key from (`bearer_token_env_var`).
 * Checked with codex-cli 0.157.1: `codex -c mcp_servers.adcode.url=… -c
 * mcp_servers.adcode.bearer_token_env_var=ADCODE_TOOL_BRIDGE_TOKEN mcp get adcode` lists it as
 * a streamable-HTTP server with bearer auth.
 */
export const CLI_BRIDGE_TOKEN_ENV = "ADCODE_TOOL_BRIDGE_TOKEN";

/**
 * Environment for one turn: how OpenCode and Codex find ADCode's tools. OpenCode merges the
 * file named by `OPENCODE_CONFIG` with the person's own config (checked with `opencode mcp
 * list`); Codex reads the key from `CLI_BRIDGE_TOKEN_ENV`. Claude Code needs nothing here.
 */
export function cliEnv(id: CliAgentId, mcp: CliMcpServer | null | undefined): Record<string, string> {
  if (mcp === null || mcp === undefined) return {};
  if (id === "opencode" && mcp.openCodeConfig !== undefined) return { OPENCODE_CONFIG: mcp.openCodeConfig };
  if (id === "codex" && mcp.token !== undefined && mcp.url !== undefined) return { [CLI_BRIDGE_TOKEN_ENV]: mcp.token };
  return {};
}

/** The arguments for one headless turn. `session` resumes the CLI's own conversation. */
export function cliArgs(id: CliAgentId, options: { readonly model: string; readonly session?: string; readonly mcp?: CliMcpServer | null; readonly effort?: string; readonly bypassPermissions?: boolean }): string[] {
  // A level is one lowercase word from the model's own list (effortFor); anything else is dropped.
  const effort = options.effort !== undefined && EFFORT_WORD.test(options.effort) ? options.effort : null;
  const model = options.model !== "default" && isSafeCliToken(options.model) ? options.model : null;
  const session = options.session !== undefined && isSafeCliToken(options.session) ? options.session : null;
  const mcp = options.mcp !== undefined && options.mcp !== null && isSafeCliToken(options.mcp.configPath) && /^[a-z][a-z0-9-]{0,40}$/.test(options.mcp.server) ? options.mcp : null;
  const bypass = options.bypassPermissions === true;
  // Codex takes the bridge as two config overrides; a value that is not TOML is read as a string.
  const codexBridge = mcp !== null && mcp.url !== undefined && mcp.token !== undefined
    ? [`mcp_servers.${mcp.server}.url=${mcp.url}`, `mcp_servers.${mcp.server}.bearer_token_env_var=${CLI_BRIDGE_TOKEN_ENV}`].filter(isSafeCliToken)
    : [];
  switch (id) {
    case "claude":
      // acceptEdits: it may edit files in the project, but shell commands still need the
      // person's own allow-list, as they would at its prompt. `--allowedTools mcp__<server>`
      // allows every tool of that one server (Claude Code's permissions docs); ADCode's own
      // confirmation dialogs still stand in front of anything guarded. Both flags take
      // several values, so they go last, where only options can follow them.
      //
      // Full access is the one exception: the person switched it on for this turn, so the CLI
      // runs with its own permission questions off. That is a real bypass: the turn has the
      // CLI's full machine access, not merely ADCode's dialogs skipped.
      return ["-p", "--output-format", "stream-json", "--verbose", ...(bypass ? ["--dangerously-skip-permissions"] : ["--permission-mode", "acceptEdits"]), ...(model ? ["--model", model] : []), ...(effort ? ["--effort", effort] : []), ...(session ? ["--resume", session] : []), ...(mcp ? ["--mcp-config", mcp.configPath, "--allowedTools", `mcp__${mcp.server}`] : [])];
    case "codex":
      // `-` reads the prompt from stdin. workspace-write: edits inside the project, no network.
      // Full access drops both the sandbox and the approval prompts for this turn.
      return ["exec", ...(session ? ["resume", session] : []), "--json", "--skip-git-repo-check", ...(bypass ? ["--dangerously-bypass-approvals-and-sandbox"] : session ? [] : ["--sandbox", "workspace-write"]), ...(model ? ["-m", model] : []), ...(effort ? ["-c", `model_reasoning_effort=${effort}`] : []), ...(codexBridge.length === 2 ? codexBridge.flatMap((value) => ["-c", value]) : []), "-"];
    case "opencode":
      // `--thinking` streams the model's reasoning: without it a thinking model (DeepSeek)
      // sends nothing for a minute or more and the chat looks stuck. `run` turns down every
      // permission question by itself and then ends the turn (checked with opencode 1.19.5:
      // "permission requested: external_directory; auto-rejecting"), so Full access passes
      // `--auto`, its own switch for approving what is not explicitly denied.
      return ["run", "--format", "json", "--thinking", ...(bypass ? ["--auto"] : []), ...(model ? ["-m", model] : []), ...(effort ? ["--variant", effort] : []), ...(session ? ["--session", session] : [])];
    case "gemini":
      return ["--output-format", "stream-json", ...(model ? ["-m", model] : []), ...(session ? ["--resume", session] : [])];
    default:
      // Freebuff has no headless mode; ACP agents take `acpArgs` and their turns over stdin.
      return [];
  }
}

/**
 * The arguments for a CLI kept running across turns, or null when it has no such mode.
 *
 * Only Claude Code has one: with `--input-format stream-json` it reads one user message per
 * stdin line and keeps the conversation in the same process, so a turn after the first skips
 * the 3-5 s it takes to start (measured with Claude Code 2.1.284: first words 1.2 s after a
 * message to a running process, 5 s for a fresh `claude -p`). `--include-partial-messages`
 * streams the reply word by word instead of a whole message at a time.
 */
export function cliLiveArgs(id: CliAgentId, options: Parameters<typeof cliArgs>[1]): string[] | null {
  if (id !== "claude") return null;
  const [print, ...rest] = cliArgs(id, options);
  return [print!, "--input-format", "stream-json", "--include-partial-messages", ...rest];
}

/** One user message on Claude Code's stream-json input. */
export function claudeUserLine(prompt: string): string {
  return JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: prompt }] } });
}

/** The line that ends a turn on Claude Code's stream-json output. */
export function isClaudeResultLine(line: string): boolean {
  if (!line.includes("\"result\"")) return false;
  try {
    const event: unknown = JSON.parse(line.trim());
    return record(event) && event["type"] === "result";
  } catch {
    return false;
  }
}

/** A model a CLI offers, as it describes it. */
export interface CliModelInfo {
  /** What is passed to the CLI's model flag. Always passes `isSafeCliToken`. */
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** The model the CLI uses when none is chosen. */
  readonly isDefault?: boolean;
  /** Its reasoning levels, in the CLI's words (low ... max), when the CLI says. */
  readonly efforts?: readonly string[];
}

const EFFORT_WORD = /^[a-z]{2,12}$/;
const efforts = (values: unknown): string[] => (Array.isArray(values) ? values.filter((value): value is string => typeof value === "string" && EFFORT_WORD.test(value)).slice(0, 8) : []);

/** The lines to write to a CLI to ask for its models, one JSON message each. */
export function modelRequest(protocol: NonNullable<CliAgentSpec["modelProtocol"]>): unknown[] {
  if (protocol === "claude-initialize") return [{ type: "control_request", request_id: "adcode-models", request: { subtype: "initialize" } }];
  return [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "adcode", version: "1" } } },
    { jsonrpc: "2.0", method: "initialized" },
    codexPageRequest(2),
  ];
}

/** Codex's next page of models. Page requests are numbered from 2; 1 is the handshake. */
export function codexPageRequest(id: number, cursor?: string): unknown {
  return { jsonrpc: "2.0", id, method: "model/list", params: cursor === undefined ? {} : { cursor } };
}

const text = (value: unknown, limit: number): string => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, limit) : "");

/**
 * Claude Code's answer to `initialize`: its `models`, each a value for `--model` with a name.
 * A value the model flag could not carry safely (`claude-fable-5-1[1m]`, its long-context
 * variant) falls back to the full model name it resolves to, which Claude Code also accepts.
 */
export function parseClaudeModels(message: unknown): CliModelInfo[] | null {
  const response = (message as { type?: unknown; response?: { response?: { models?: unknown } } } | null);
  if (response?.type !== "control_response") return null;
  const models = response.response?.response?.models;
  if (!Array.isArray(models)) return [];
  const out: CliModelInfo[] = [];
  for (const raw of models) {
    const model = raw as { value?: unknown; resolvedModel?: unknown; displayName?: unknown; description?: unknown; supportedEffortLevels?: unknown };
    const value = text(model.value, 200);
    const id = isSafeCliToken(value) ? value : text(model.resolvedModel, 200);
    if (!isSafeCliToken(id) || out.some((item) => item.id === id)) continue;
    const description = text(model.description, 200);
    const levels = efforts(model.supportedEffortLevels);
    out.push({ id, name: text(model.displayName, 80) || id, ...(description === "" ? {} : { description }), ...(id === "default" ? { isDefault: true } : {}), ...(levels.length === 0 ? {} : { efforts: levels }) });
  }
  return out;
}

/** Codex's answer to `model/list`: the page of models and the cursor to the next, if any. Hidden models are left out. */
export function parseCodexModels(message: unknown): { models: CliModelInfo[]; next: string | null } | null {
  const reply = message as { id?: unknown; result?: { data?: unknown; nextCursor?: unknown }; error?: unknown } | null;
  if (typeof reply?.id !== "number" || reply.id < 2) return null;
  const data = reply.result?.data;
  if (!Array.isArray(data)) return { models: [], next: null };
  const models: CliModelInfo[] = [];
  for (const raw of data) {
    const model = raw as { id?: unknown; model?: unknown; displayName?: unknown; description?: unknown; hidden?: unknown; isDefault?: unknown; supportedReasoningEfforts?: unknown };
    const id = text(model.model, 200) || text(model.id, 200);
    if (model.hidden === true || !isSafeCliToken(id)) continue;
    const description = text(model.description, 200);
    const levels = efforts(Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts.map((entry: unknown) => (entry as { reasoningEffort?: unknown } | null)?.reasoningEffort) : []);
    models.push({ id, name: text(model.displayName, 80) || id, ...(description === "" ? {} : { description }), ...(model.isDefault === true ? { isDefault: true } : {}), ...(levels.length === 0 ? {} : { efforts: levels }) });
  }
  const next = reply.result?.nextCursor;
  return { models, next: typeof next === "string" && next !== "" ? next : null };
}

/**
 * The list ADCode shows: the CLI's own default first, then everything it reported, with the
 * built-in aliases filling in only when the CLI could not be asked (signed out, an old
 * version, no answer in time) - so there is always something to choose.
 */
export function mergeCliModels(spec: CliAgentSpec, reported: readonly CliModelInfo[]): CliModelInfo[] {
  if (reported.length > 0) {
    const hasDefault = reported.some((model) => model.id === "default");
    const ordered = [...reported].sort((a, b) => Number(b.id === "default") - Number(a.id === "default") || Number(b.isDefault === true) - Number(a.isDefault === true));
    return hasDefault ? ordered : [{ id: "default", name: `${spec.name}'s default model`, isDefault: true }, ...ordered];
  }
  return spec.models.map((id) => ({ id, name: id === "default" ? `${spec.name}'s default model` : id, ...(id === "default" ? { isDefault: true } : {}) }));
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
  /** `joined`: more of the text just sent (a streamed word), not a new message. */
  | { readonly kind: "text"; readonly text: string; readonly joined?: boolean }
  | { readonly kind: "thinking"; readonly text: string }
  | { readonly kind: "session"; readonly id: string }
  | { readonly kind: "usage"; readonly input: number; readonly output: number; readonly cached: number }
  | { readonly kind: "error"; readonly message: string }
  /** The CLI turned down one of its own tool calls for want of permission (it asked nobody). */
  | { readonly kind: "denied"; readonly tool: string; readonly detail: string }
  /** One model step ended; `reason` is the CLI's word for why ("stop", "tool-calls"). */
  | { readonly kind: "step"; readonly reason: string };

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);

/** One line of a tool's activity, as a person would say it. */
export function activity(verb: string, detail: string): CliEvent {
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

/**
 * Claude Code's lines. With `--include-partial-messages` the words arrive as `stream_event`
 * deltas and the whole message follows; the deltas are shown and the whole message only
 * supplies what was not streamed (its tool calls, or text from a CLI that sent no deltas).
 */
function createClaudeReader(): (event: Record<string, unknown>) => CliEvent[] {
  /** Words were streamed for the message in progress, so its whole text is not shown again. */
  let streamedText = false;
  let streamedThinking = false;
  /** The next text delta starts a new block: it is a new message, not more of the last one. */
  let newBlock = true;
  return (event) => {
    const out: CliEvent[] = [];
    if (typeof event["session_id"] === "string" && (event["type"] === "system" || event["type"] === "result")) out.push({ kind: "session", id: event["session_id"] });
    if (event["type"] === "stream_event" && record(event["event"])) {
      const inner = event["event"];
      if (inner["type"] === "message_start") { streamedText = false; streamedThinking = false; }
      else if (inner["type"] === "content_block_start") newBlock = true;
      else if (inner["type"] === "content_block_delta" && record(inner["delta"])) {
        const delta = inner["delta"];
        if (delta["type"] === "text_delta" && str(delta["text"])) {
          out.push({ kind: "text", text: str(delta["text"]), ...(newBlock ? {} : { joined: true }) });
          newBlock = false;
          streamedText = true;
        } else if (delta["type"] === "thinking_delta" && str(delta["thinking"])) {
          out.push({ kind: "thinking", text: str(delta["thinking"]) });
          streamedThinking = true;
        }
      }
      return out;
    }
    if (event["type"] === "assistant" && record(event["message"])) {
      // "<synthetic>" messages are the CLI talking about itself ("Not logged in"); the result
      // line repeats them as an error, which is where they belong.
      if (event["message"]["model"] === "<synthetic>") return out;
      const content = Array.isArray(event["message"]["content"]) ? event["message"]["content"] : [];
      for (const block of content) {
        if (!record(block)) continue;
        if (block["type"] === "text" && str(block["text"])) { if (!streamedText) out.push({ kind: "text", text: str(block["text"]) }); }
        else if (block["type"] === "thinking" && str(block["thinking"])) { if (!streamedThinking) out.push({ kind: "thinking", text: str(block["thinking"]) }); }
        else if (block["type"] === "tool_use") out.push(activity(str(block["name"]) || "Tool", toolDetail(block["input"])));
      }
    }
    if (event["type"] === "result") out.push(...claudeResult(event));
    return out;
  };
}

function claudeResult(event: Record<string, unknown>): CliEvent[] {
  const out: CliEvent[] = [];
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
      const tool = str(part["tool"]) || "Tool";
      const detail = str(state["title"]) || toolDetail(state["input"]);
      if (state["status"] === "error") {
        // A failed call used to read like a finished one: the run then ended and nobody knew why.
        const problem = str(state["error"]).replace(/\s+/g, " ").trim();
        out.push(activity(`${tool} failed`, `${detail}${detail && problem ? " - " : ""}${problem.slice(0, 200)}`));
        if (/rejected permission|permission (was )?denied|auto-reject/i.test(problem)) out.push({ kind: "denied", tool, detail });
      } else out.push(activity(tool, detail));
      break;
    }
    case "step_finish": {
      const tokens = record(part["tokens"]) ? part["tokens"] : {};
      const cache = record(tokens["cache"]) ? tokens["cache"] : {};
      out.push({ kind: "usage", input: num(tokens["input"]) + num(cache["read"]), output: num(tokens["output"]) + num(tokens["reasoning"]), cached: num(cache["read"]) });
      if (str(part["reason"])) out.push({ kind: "step", reason: str(part["reason"]) });
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
  const read = id === "claude" ? createClaudeReader() : id === "codex" ? codexLine : id === "opencode" ? openCodeLine : id === "gemini" ? geminiLine : () => [];
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
export type CliSpawn = (command: string, args: readonly string[], options: { readonly cwd: string; readonly input: string; readonly env?: Readonly<Record<string, string>> }) => CliProcess;

/** A CLI left running between turns, its stdin open. */
export interface CliLiveProcess {
  /** The next stdout line, or null once stdout has closed. Turns take lines from here in turn. */
  next(): Promise<string | null>;
  /** Writes one line to stdin. */
  send(line: string): void;
  alive(): boolean;
  readonly exit: Promise<number | null>;
  stderr(): string;
  kill(): void;
}

/** Starts `command args` in `cwd` and leaves stdin open. */
export type CliLiveSpawn = (command: string, args: readonly string[], options: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> }) => CliLiveProcess;

/** A running CLI kept for one chat: reused while nothing that shapes its command line changes. */
export interface CliLiveEntry {
  readonly process: CliLiveProcess;
  /** The command line and folder it was started with, minus the session to resume. */
  readonly signature: string;
  /** The CLI's own session in that process. */
  session: string | null;
  busy: boolean;
  idle?: ReturnType<typeof setTimeout>;
  usedAt: number;
  /** For an ACP agent: the protocol connection over `process` (acp.ts). */
  acp?: unknown;
}

/** A kept process quiet this long is stopped; the next turn resumes its session in a new one. */
export const LIVE_IDLE_MS = 10 * 60_000;
/** At most this many kept at once (each is a running CLI); the longest unused goes first. */
export const LIVE_MAX = 3;

/** One turn's lines from a kept process: up to and including the line that ends it. */
async function* liveTurn(process: CliLiveProcess): AsyncIterable<string> {
  for (;;) {
    const line = await process.next();
    if (line === null) return;
    yield line;
    // Returning here, not on the next pull, leaves the next turn's first line where it is.
    if (isClaudeResultLine(line)) return;
  }
}

export interface CliProviderOptions {
  readonly spec: CliAgentSpec;
  readonly models: readonly string[];
  readonly spawn: CliSpawn;
  /** The open project, where the CLI works; resolved per request. */
  readonly cwd: () => string;
  /** Shared across providers built for the same CLI, so a rebuilt provider still resumes. */
  readonly sessions?: Map<string, { readonly id: string; readonly messages: number }>;
  /**
   * ADCode's tool bridge, resolved per turn because it can be switched off or move port
   * while a provider lives. Null: not running, or its config path cannot pass the shell.
   *
   * Claude Code takes it as `--mcp-config`, Codex as `-c` overrides with the key in the
   * environment, OpenCode as a config file named by `OPENCODE_CONFIG` (all three checked
   * against the real CLIs). Gemini CLI is not given it: it reads MCP servers only from its own
   * settings file, and it could not be checked here - people add it with the copied config.
   */
  readonly mcp?: () => CliMcpServer | null;
  /** Each model's reasoning levels as the CLI reported them, so the person's choice maps onto them. */
  readonly modelEfforts?: Readonly<Record<string, readonly string[]>>;
  /**
   * The person's Full access switch, read per turn.
   *
   * True: the CLI runs with its own permission questions off (`--dangerously-skip-permissions`
   * for Claude Code, `--dangerously-bypass-approvals-and-sandbox` for Codex), so that turn has
   * the CLI's full machine access. Read per turn so turning Full access off in the chat
   * applies to the very next message.
   */
  readonly bypassPermissions?: () => boolean;
  /**
   * The ADCode chat this provider answers, read per turn. The CLI's own session is remembered
   * per chat, so two chats that began with the same words ("hi", "continue") never resume each
   * other's conversation. Without it, the conversation is recognised by its first message.
   */
  readonly conversation?: () => string | undefined;
  /** How long the CLI may say nothing before the chat is told it is still working. */
  readonly heartbeatMs?: number;
  /**
   * Keeps a CLI that can take several turns (Claude Code) running between them, so only a
   * chat's first turn waits for it to start. Without it, every turn starts the CLI afresh.
   */
  readonly live?: CliLiveSpawn;
  /** Shared across providers like `sessions`, so a rebuilt provider finds the running process. */
  readonly liveProcesses?: Map<string, CliLiveEntry>;
  readonly liveIdleMs?: number;
}

export function dropLive(processes: Map<string, CliLiveEntry>, key: string): void {
  const entry = processes.get(key);
  if (entry === undefined) return;
  if (entry.idle !== undefined) clearTimeout(entry.idle);
  entry.process.kill();
  processes.delete(key);
}

/** Quiet for this long and the chat says so: a thinking model or a slow tool, not a hang. */
export const HEARTBEAT_MS = 15_000;

type Beat<T> = { readonly line: T } | { readonly quietMs: number };

/** `source`, with a tick every `everyMs` of silence so the caller can say it is still going. */
export async function* withHeartbeat<T>(source: AsyncIterable<T>, everyMs: number): AsyncIterable<Beat<T>> {
  const iterator = source[Symbol.asyncIterator]();
  let pending = iterator.next();
  let quietSince = Date.now();
  for (;;) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = new Promise<"tick">((resolve) => { timer = setTimeout(() => resolve("tick"), everyMs); });
    const next = await Promise.race([pending, tick]);
    clearTimeout(timer);
    if (next === "tick") { yield { quietMs: Date.now() - quietSince }; continue; }
    if (next.done === true) return;
    quietSince = Date.now();
    pending = iterator.next();
    yield { line: next.value };
  }
}

/**
 * What to tell the person when a run ended part way: the CLI's last step asked for tools and
 * then it stopped, without a word. Null when it finished properly.
 */
export function unfinishedRunNote(name: string, lastStep: string | null, denied: readonly { readonly tool: string; readonly detail: string }[], bypass: boolean): string | null {
  if (denied.length > 0) {
    const what = denied.slice(-3).map((item) => (item.detail ? `${item.tool} (${item.detail.slice(0, 80)})` : item.tool)).join(", ");
    return bypass
      ? `${name} stopped: it was refused permission for ${what}. Its own settings deny that; change them in its config file, then say "continue".`
      : `${name} stopped: in a chat it cannot ask you, so it turned down its own permission request for ${what} and ended the turn. Turn on Full access for this chat, or allow it in ${name}'s permission settings, then say "continue".`;
  }
  if (lastStep === "tool-calls") return `${name} ended its run straight after a tool call, without an answer. Say "continue" to pick up where it stopped.`;
  return null;
}

/** The person's effort (low ... max) as the nearest level this model has, or nothing for Auto or a model with no levels. */
export function cliEffort(request: ProviderRequest, levels: Readonly<Record<string, readonly string[]>> | undefined): { effort?: string } {
  const level = effortFor(request.effort, levels?.[request.model]);
  return level === undefined ? {} : { effort: level };
}

export const SIGNED_OUT = /not logged in|please run \/login|not authenticated|unauthori[sz]ed|login required|sign in|api key/i;

export function createCliProvider(options: CliProviderOptions): Provider {
  const { spec } = options;
  const sessions = options.sessions ?? new Map<string, { id: string; messages: number }>();
  const liveProcesses = options.liveProcesses ?? new Map<string, CliLiveEntry>();
  return {
    id: cliProviderId(spec.id),
    displayName: spec.name,
    models: options.models,
    async *stream(request: ProviderRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      const chat = options.conversation?.();
      const key = chat !== undefined && chat !== "" ? `${spec.id}:${request.model}:chat:${chat}` : conversationKey(spec.id, request.model, request);
      const prior = sessions.get(key);
      const resume = prior !== undefined && request.messages.length > prior.messages;
      const bypass = options.bypassPermissions?.() === true;
      const mcp = spec.id === "claude" || spec.id === "codex" || spec.id === "opencode" ? options.mcp?.() ?? null : null;
      const argOptions = { model: request.model, mcp: spec.id === "claude" || spec.id === "codex" ? mcp : null, ...cliEffort(request, options.modelEfforts), bypassPermissions: bypass };
      const cwd = options.cwd();
      const env = cliEnv(spec.id, mcp);
      const liveArgs = options.live === undefined ? null : cliLiveArgs(spec.id, argOptions);
      const liveEntry = liveArgs === null ? undefined : liveProcesses.get(key);
      // A kept process for this chat is used when it is idle, alive, already holds this
      // conversation, and would be started the same way today (model, effort, access, tools).
      let entry: CliLiveEntry | null = null;
      let lines: AsyncIterable<string>;
      let process: Pick<CliProcess, "exit" | "stderr" | "kill">;
      if (liveArgs !== null && options.live !== undefined && liveEntry?.busy !== true) {
        const signature = JSON.stringify([cwd, env, liveArgs]);
        if (liveEntry !== undefined && resume && liveEntry.signature === signature && liveEntry.session === prior.id && liveEntry.process.alive()) {
          entry = liveEntry;
          if (entry.idle !== undefined) clearTimeout(entry.idle);
        } else {
          dropLive(liveProcesses, key);
          for (const [other, kept] of [...liveProcesses].sort((a, b) => a[1].usedAt - b[1].usedAt)) {
            if (liveProcesses.size < LIVE_MAX) break;
            if (!kept.busy) dropLive(liveProcesses, other);
          }
          const started = options.live(spec.command, cliLiveArgs(spec.id, { ...argOptions, ...(resume ? { session: prior.id } : {}) }) ?? liveArgs, { cwd, env });
          entry = { process: started, signature, session: resume ? prior.id : null, busy: false, usedAt: Date.now() };
          liveProcesses.set(key, entry);
        }
        entry.busy = true;
        entry.usedAt = Date.now();
        entry.process.send(claudeUserLine(cliPrompt(request, resume)));
        lines = liveTurn(entry.process);
        process = entry.process;
      } else {
        const once = options.spawn(spec.command, cliArgs(spec.id, { ...argOptions, ...(resume ? { session: prior.id } : {}) }), { cwd, env, input: cliPrompt(request, resume) });
        lines = once.lines;
        process = once;
      }
      /** The kept process answered to the end of the turn and can take the next one. */
      let turnEnded = false;
      const stop = (): void => process.kill();
      signal.addEventListener("abort", stop, { once: true });
      const parse = createCliLineParser(spec.id);
      let session: string | null = null;
      let failure: string | null = null;
      let wrote = false;
      let lastText = "";
      let lastStep: string | null = null;
      /** Text since the last step that asked for tools: an answer, not narration before a call. */
      let answeredSinceTools = false;
      const denied: { tool: string; detail: string }[] = [];
      const usage = { input: 0, output: 0, cached: 0 };
      // The CLI's own session is kept whenever it named one - also after a failure or a Stop -
      // so "continue" resumes its conversation, tool results and all, instead of a transcript.
      const remember = (): void => { if (session !== null) sessions.set(key, { id: session, messages: request.messages.length }); };
      try {
        for await (const beat of withHeartbeat(lines, options.heartbeatMs ?? HEARTBEAT_MS)) {
          if (signal.aborted) break;
          if ("quietMs" in beat) {
            yield { kind: "status", text: `${spec.name} is still pondering - ${Math.round(beat.quietMs / 1000)} s with nothing new. It may be thinking hard, or waiting on a slow tool.` };
            continue;
          }
          if (entry !== null && isClaudeResultLine(beat.line)) turnEnded = true;
          for (const event of parse(beat.line)) {
            if (event.kind === "session") session = event.id;
            else if (event.kind === "usage") { usage.input += event.input; usage.output += event.output; usage.cached += event.cached; }
            else if (event.kind === "error") failure ??= event.message;
            else if (event.kind === "denied") denied.push({ tool: event.tool, detail: event.detail });
            else if (event.kind === "step") { lastStep = event.reason; if (event.reason === "tool-calls") answeredSinceTools = false; }
            else if (event.kind === "text") {
              // Separate answers the CLI sent as separate messages, as it would show them;
              // a streamed word joins the text before it.
              const text = event.joined !== true && wrote && !lastText.endsWith("\n") && !event.text.startsWith("\n") ? `\n\n${event.text}` : event.text;
              wrote = true; lastText = event.joined === true ? lastText + event.text : event.text; answeredSinceTools = true;
              yield { kind: "text", text };
            } else yield { kind: "thinking", text: event.text };
          }
        }
        // A kept process stays running after its turn: it exits only when it failed.
        // A stopped kept process is not waited for: the stop is shown at once.
        const code = turnEnded || (entry !== null && signal.aborted) ? 0 : await process.exit;
        if (entry !== null) entry.session = session ?? entry.session;
        remember();
        if (signal.aborted) { yield { kind: "stop", reason: "cancelled" }; return; }
        if (failure === null && code !== 0 && !wrote) failure = process.stderr().trim().split(/\r?\n/).slice(-3).join(" ") || `it exited with code ${String(code)}`;
        if (failure !== null) {
          const hint = SIGNED_OUT.test(failure) ? ` Sign in by running \`${spec.signIn}\` in a terminal, then send your message again.` : "";
          throw Object.assign(new Error(`${spec.name}: ${failure}${hint}`), { code: SIGNED_OUT.test(failure) ? "cli-signed-out" : "cli-failed", retryable: false });
        }
        // A run that ended right after asking for tools stopped part way: say so, and why.
        const note = answeredSinceTools ? null : unfinishedRunNote(spec.name, lastStep, denied, bypass);
        if (note !== null) yield { kind: "text", text: `${wrote && !lastText.endsWith("\n") ? "\n\n" : ""}${note}` };
        if (usage.input + usage.output > 0) yield { kind: "usage", inputTokens: usage.input, outputTokens: usage.output, cachedTokens: usage.cached };
        yield { kind: "stop", reason: "end-turn" };
      } finally {
        signal.removeEventListener("abort", stop);
        if (entry !== null) {
          entry.busy = false;
          // Stopped, cut short, or the CLI died: never hand that process another turn.
          if (signal.aborted || !turnEnded || !entry.process.alive()) {
            if (liveProcesses.get(key) === entry) dropLive(liveProcesses, key);
            else entry.process.kill();
          } else {
            const kept = entry;
            kept.idle = setTimeout(() => { if (liveProcesses.get(key) === kept && !kept.busy) dropLive(liveProcesses, key); }, options.liveIdleMs ?? LIVE_IDLE_MS);
            (kept.idle as { unref?: () => void }).unref?.();
          }
        } else if (!signal.aborted) process.kill();
      }
    },
  };
}

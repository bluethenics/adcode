/**
 * The tool bridge: ADCode's own tools, offered to the other coding agents on this computer.
 *
 * Claude Code, Codex, Cursor and the rest speak MCP, so the bridge is an MCP server over
 * Streamable HTTP, inside the main process, on 127.0.0.1. It lists the same app tools the
 * in-app assistant is offered and calls them through the same runner, so every confirmation
 * dialog and every setting that guards them still applies - an outside agent gets no more
 * than ADCode's own chat would.
 *
 * Three locks on the door, all in `toolBridgeModel.ts`: it listens on loopback only, every
 * request must carry the key from `tool-bridge.json`, and a Host or Origin that a web page
 * could have produced (DNS rebinding) is refused before the key is even looked at.
 *
 * No Electron import: `startToolBridgeServer` runs under plain Node with a stub runner, and
 * the desktop wiring (the setting, userData, the live runner) arrives through
 * `configureToolBridge` from `index.ts`.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { join } from "node:path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { CliMcpServer, ToolDefinition, ToolRunner, ToolRunResult } from "@adcode/ai";
import type { ToolBridgeView } from "../shared/api.ts";
import {
  BRIDGE_CALL_CEILING_MS,
  BRIDGE_PATH,
  BRIDGE_SERVER_NAME,
  bridgeConfigs,
  bridgeUrl,
  claudeMcpConfig,
  cliConfigPath,
  isBridgePort,
  newBridgeToken,
  parseBridgeState,
  refuseRequest,
  type BridgeState,
} from "./toolBridgeModel.ts";

const SERVER_VERSION = "1.0.0";
/** How often a long call tells a client that asked for progress that it is still going. */
const PROGRESS_EVERY_MS = 20_000;

export interface ToolBridgeServerOptions {
  /** The port to try first - last launch's, so configs pasted elsewhere stay valid. */
  readonly port: number | null;
  /** Read per request, so a regenerated key takes effect without a restart. */
  readonly token: () => string;
  /** Read per request, so a tool switched off in Settings disappears from the list. */
  readonly tools: () => readonly ToolDefinition[];
  readonly runner: ToolRunner;
  readonly ceilingMs?: number;
}

export interface ToolBridgeServer {
  readonly port: number;
  close(): Promise<void>;
}

type McpContent = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

function toMcp(result: ToolRunResult): { content: McpContent[]; isError: boolean } {
  const content: McpContent[] = [{ type: "text", text: result.content }];
  for (const image of result.images ?? []) content.push({ type: "image", data: image.data, mimeType: image.mediaType });
  return { content, isError: result.isError };
}

const failure = (text: string) => ({ content: [{ type: "text" as const, text }], isError: true });

/**
 * One tool at a time, per tool, as the in-app runner has them: two agents both driving the
 * Browser panel, or both changing the same setting, would otherwise interleave.
 */
function createSerialiser(): <T>(key: string, run: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<void>>();
  return (key, run) => {
    const next = (tails.get(key) ?? Promise.resolve()).then(run, run);
    const tail = next.then(() => undefined, () => undefined);
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return next;
  };
}

function createMcpServer(options: ToolBridgeServerOptions, serial: ReturnType<typeof createSerialiser>): Server {
  const server = new Server({ name: BRIDGE_SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });
  const ceiling = options.ceilingMs ?? BRIDGE_CALL_CEILING_MS;

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: options.tools().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as { type: "object"; [key: string]: unknown },
      annotations: { readOnlyHint: !tool.mutating },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const name = request.params.name;
    // Checked at call time too: a tool listed a minute ago may have been switched off since.
    if (!options.tools().some((tool) => tool.name === name)) return failure(`ADCode does not offer a tool named ${JSON.stringify(name)} right now. List the tools again.`);
    const input = typeof request.params.arguments === "object" && request.params.arguments !== null ? request.params.arguments : {};
    const timeout = AbortSignal.timeout(ceiling);
    const signal = AbortSignal.any([extra.signal, timeout]);

    const progressToken = request.params._meta?.progressToken;
    let ticks = 0;
    const progress = progressToken === undefined ? undefined : setInterval(() => {
      void extra.sendNotification({ method: "notifications/progress", params: { progressToken, progress: ++ticks, message: "Still working - ADCode may be waiting for the person to confirm." } }).catch(() => undefined);
    }, PROGRESS_EVERY_MS);

    try {
      const run = serial(name, () => signal.aborted
        ? Promise.resolve<ToolRunResult>({ content: "Cancelled.", isError: true })
        : options.runner.run({ type: "tool-call", id: `bridge-${randomUUID()}`, name, input }, signal));
      // A runner that ignores its signal must still not hold the request past the ceiling; the
      // queue keeps waiting on the real call, so the next one still runs after it.
      const stopped = new Promise<ToolRunResult>((resolve) => {
        const settle = (): void => resolve({ content: timeout.aborted ? `Stopped after ${Math.round(ceiling / 60_000)} minutes.` : "Cancelled.", isError: true });
        if (signal.aborted) settle();
        else signal.addEventListener("abort", settle, { once: true });
      });
      return toMcp(await Promise.race([run, stopped]));
    } catch (error) {
      // A tool call must never take the server down: the agent would lose every other call too.
      return failure(`Tool failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (progress !== undefined) clearInterval(progress);
    }
  });

  return server;
}

function answer(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32_000, message }, id: null }));
}

function listen(http: HttpServer, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const failed = (error: Error): void => { http.removeListener("listening", ready); reject(error); };
    const ready = (): void => {
      http.removeListener("error", failed);
      const address = http.address();
      resolve(typeof address === "object" && address !== null ? address.port : port);
    };
    http.once("error", failed);
    http.once("listening", ready);
    // 127.0.0.1, never 0.0.0.0 or "localhost" (which may resolve to ::1 or the LAN on odd setups).
    http.listen(port, "127.0.0.1");
  });
}

/** The server alone: no files, no settings. Stateless - each POST gets a fresh MCP server. */
export async function startToolBridgeServer(options: ToolBridgeServerOptions): Promise<ToolBridgeServer> {
  const serial = createSerialiser();
  let port = 0;
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const refused = refuseRequest({ host: req.headers.host, origin: req.headers.origin, authorization: req.headers.authorization }, { port, token: options.token() });
      if (refused !== null) {
        answer(res, refused.status, refused.message, refused.status === 401 ? { "www-authenticate": `Bearer realm="${BRIDGE_SERVER_NAME}"` } : {});
        return;
      }
      if ((req.url ?? "").split("?")[0] !== BRIDGE_PATH) { answer(res, 404, `Not found. The MCP endpoint is ${BRIDGE_PATH}.`); return; }
      // Stateless: there is no session to stream notifications on or to delete, so GET and
      // DELETE are answered as the MCP spec allows - 405 - and clients carry on with POST.
      if (req.method !== "POST") { answer(res, 405, "Method not allowed.", { allow: "POST" }); return; }
      const server = createMcpServer(options, serial);
      // No session id generator: stateless, a fresh transport per request.
      const transport = new StreamableHTTPServerTransport({});
      // The client hanging up closes the transport, which aborts the call's signal.
      res.on("close", () => { void transport.close(); void server.close(); });
      try {
        // The SDK's own class against its own interface trips exactOptionalPropertyTypes only.
        await server.connect(transport as Transport);
        await transport.handleRequest(req, res);
      } catch (error) {
        answer(res, 500, error instanceof Error ? error.message : "The bridge failed.");
      }
    })();
  });
  http.on("clientError", (_error, socket) => { socket.destroy(); });
  try {
    port = await listen(http, options.port ?? 0);
  } catch {
    // Last launch's port is taken: any free one, and the configs shown in ADCode change with it.
    port = await listen(http, 0);
  }
  return {
    port,
    close: () => new Promise<void>((resolve) => {
      http.close(() => resolve());
      http.closeAllConnections();
    }),
  };
}

/* ── The desktop's bridge: one per app, following its setting ─────────────────────────── */

export interface ToolBridgeDeps {
  /** userData: where the key and Claude Code's config live. */
  readonly directory: string;
  /** The setting, read fresh each time. */
  readonly enabled: () => boolean;
  readonly onSettingsChanged: (listener: () => void) => void;
  readonly tools: () => readonly ToolDefinition[];
  readonly runner: () => ToolRunner;
  /**
   * Folders for Claude Code's config file, in order of preference; the first whose path the
   * CLI shim accepts (`isCliSafe`) is used. userData first, as asked of every file ADCode
   * keeps; a fallback such as ~/.adcode for userData paths with a space - every macOS one
   * ("Application Support"), and Windows accounts named with a space.
   */
  readonly claudeDirectories: readonly string[];
  readonly isCliSafe: (value: string) => boolean;
}

const STATE_FILE = "tool-bridge.json";
/** The file `--mcp-config` names when ADCode runs Claude Code as its chat model. */
const CLAUDE_FILE = "tool-bridge-claude.json";
/** OpenCode's config with the bridge in it, named to OpenCode by `OPENCODE_CONFIG` for each run. */
const OPENCODE_FILE = "tool-bridge-opencode.json";

let deps: ToolBridgeDeps | null = null;
let state: BridgeState | null = null;
let running: ToolBridgeServer | null = null;
let problem: string | null = null;
/** Where Claude Code's config was last written, or null when no folder could be given to the CLI. */
let claudeFile: string | null = null;
let openCodeFile: string | null = null;
/** Start, stop and regenerate run one after another, so a quick toggle cannot start two servers. */
let lifecycle: Promise<unknown> = Promise.resolve();

function queued<T>(work: () => Promise<T>): Promise<T> {
  const next = lifecycle.then(work, work);
  lifecycle = next.catch(() => undefined);
  return next;
}

/** Written to a temporary file and renamed, so a crash mid-write never leaves half a key. */
async function writeAtomic(path: string, text: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

async function loadState(directory: string): Promise<BridgeState> {
  if (state !== null) return state;
  const saved = parseBridgeState(await readFile(join(directory, STATE_FILE), "utf8").catch(() => null));
  state = saved ?? { token: newBridgeToken(), port: null };
  if (saved === null) await saveState(directory, state);
  return state;
}

async function saveState(directory: string, next: BridgeState): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeAtomic(join(directory, STATE_FILE), `${JSON.stringify(next, null, 2)}\n`);
}

async function writeClaudeConfig(port: number, token: string): Promise<void> {
  if (deps === null) return;
  const { isCliSafe } = deps;
  const directory = deps.claudeDirectories.find((folder) => isCliSafe(cliConfigPath(join(folder, CLAUDE_FILE))));
  if (directory === undefined) { claudeFile = null; return; }
  try {
    await mkdir(directory, { recursive: true });
    await writeAtomic(join(directory, CLAUDE_FILE), claudeMcpConfig(bridgeUrl(port), token));
    claudeFile = join(directory, CLAUDE_FILE);
    // OpenCode's own shape: a remote server with its headers. Merged with the person's config, not replacing it.
    await writeAtomic(join(directory, OPENCODE_FILE), `${JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { [BRIDGE_SERVER_NAME]: { type: "remote", url: bridgeUrl(port), headers: { Authorization: `Bearer ${token}` }, enabled: true } } }, null, 2)}\n`);
    openCodeFile = join(directory, OPENCODE_FILE);
  } catch {
    // Claude Code as the chat model then runs without ADCode's tools; the bridge itself is fine.
    claudeFile = null;
  }
}

async function start(): Promise<void> {
  if (deps === null || running !== null || !deps.enabled()) return;
  const { directory } = deps;
  const runner = deps.runner();
  const tools = deps.tools;
  try {
    const current = await loadState(directory);
    running = await startToolBridgeServer({ port: current.port, token: () => state?.token ?? current.token, tools, runner });
    problem = null;
    if (!isBridgePort(current.port) || current.port !== running.port) {
      state = { token: current.token, port: running.port };
      await saveState(directory, state);
    }
  } catch (error) {
    problem = `The bridge could not start: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }
  await writeClaudeConfig(running.port, state?.token ?? "");
}

async function stop(): Promise<void> {
  const server = running;
  running = null;
  if (server !== null) await server.close();
  // The file holds the key; with nothing listening it is no use to anyone.
  if (claudeFile !== null) await rm(claudeFile, { force: true }).catch(() => undefined);
  if (openCodeFile !== null) await rm(openCodeFile, { force: true }).catch(() => undefined);
  claudeFile = null;
  openCodeFile = null;
}

/** Start or stop to match the setting. */
export function syncToolBridge(): Promise<void> {
  return queued(async () => {
    if (deps === null) return;
    if (deps.enabled()) await start();
    else await stop();
  });
}

/** Called once by `index.ts` after settings have loaded. */
export function configureToolBridge(next: ToolBridgeDeps): Promise<void> {
  deps = next;
  next.onSettingsChanged(() => { void syncToolBridge().catch(() => undefined); });
  return syncToolBridge();
}

export function stopToolBridge(): Promise<void> {
  return queued(stop);
}

function view(): ToolBridgeView {
  if (running === null || state === null) return { running: false, url: null, configs: [], problem };
  const url = bridgeUrl(running.port);
  return { running: true, url, configs: bridgeConfigs(url, state.token), problem: null };
}

export function toolBridgeView(): Promise<ToolBridgeView> {
  return queued(async () => view());
}

/** A new key: every config pasted elsewhere stops working until it is copied again. */
export function regenerateToolBridgeToken(): Promise<ToolBridgeView> {
  return queued(async () => {
    if (deps === null) return view();
    const current = await loadState(deps.directory);
    state = { token: newBridgeToken(), port: running?.port ?? current.port };
    await saveState(deps.directory, state);
    if (running !== null) await writeClaudeConfig(running.port, state.token);
    return view();
  });
}

/**
 * What Claude Code gets when ADCode runs it as the chat model: the config file's path, or
 * null while the bridge is off. Synchronous, from the state the lifecycle keeps current;
 * `cliArgs` drops a path the shell could misread (see `cliConfigPath`).
 */
export function claudeToolBridge(): CliMcpServer | null {
  if (deps === null || running === null || claudeFile === null || !deps.enabled()) return null;
  return {
    configPath: cliConfigPath(claudeFile),
    server: BRIDGE_SERVER_NAME,
    url: bridgeUrl(running.port),
    ...(state === null ? {} : { token: state.token }),
    ...(openCodeFile === null ? {} : { openCodeConfig: openCodeFile }),
  };
}

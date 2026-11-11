/**
 * The tool bridge's rules, apart from its server: who may call it, and the snippets that
 * tell another agent where it is.
 *
 * Kept free of Electron and of the HTTP server so every rule that decides whether a request
 * gets in can be tested as plain functions. The bridge itself (`toolBridge.ts`) only applies
 * these.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** The MCP server's name, which is also the prefix Claude Code gives its tools (`mcp__adcode__…`). */
export const BRIDGE_SERVER_NAME = "adcode";
/** The one path the bridge answers on. */
export const BRIDGE_PATH = "/mcp";
/** The longest a single tool call may take, a confirmation dialog included. */
export const BRIDGE_CALL_CEILING_MS = 10 * 60_000;

/** 32 random bytes, base64url: long enough that guessing is not a strategy, and safe in a header, JSON and TOML. */
export function newBridgeToken(): string {
  return randomBytes(32).toString("base64url");
}

export const isBridgeToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
export const isBridgePort = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 1024 && value <= 65_535;

/** What `tool-bridge.json` holds. Anything unreadable is treated as absent, so a fresh key is made. */
export interface BridgeState {
  readonly token: string;
  readonly port: number | null;
}

export function parseBridgeState(raw: string | null): BridgeState | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    if (!isBridgeToken(record["token"])) return null;
    return { token: record["token"], port: isBridgePort(record["port"]) ? record["port"] : null };
  } catch {
    return null;
  }
}

/**
 * Whether an Authorization header carries the bridge's key.
 *
 * Compared as hashes in constant time: the lengths are then always equal, so neither the
 * comparison nor an early length check tells a caller how close a guess came.
 */
export function bearerMatches(header: string | readonly string[] | undefined, token: string): boolean {
  if (typeof header !== "string" || token === "") return false;
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header);
  if (match === null) return false;
  const digest = (value: string): Buffer => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(match[1]!), digest(token));
}

/**
 * DNS-rebinding protection. A web page can make the browser send a request to 127.0.0.1 by
 * pointing its own domain there; the Host header then still names the page's domain, which
 * is what this refuses. Only the two loopback names, with the bridge's port, are accepted.
 */
export function hostAllowed(host: string | undefined, port: number): boolean {
  if (typeof host !== "string") return false;
  const value = host.trim().toLowerCase();
  return value === `127.0.0.1:${port}` || value === `localhost:${port}`;
}

/**
 * Coding agents are not browsers and send no Origin. Any Origin at all - even a loopback one,
 * which a page on another local port could send - means a browser is making the request on
 * some page's behalf, so it is refused.
 */
export const originAllowed = (origin: string | readonly string[] | undefined): boolean => origin === undefined;

export interface BridgeRequestHeaders {
  readonly host?: string | undefined;
  readonly origin?: string | readonly string[] | undefined;
  readonly authorization?: string | readonly string[] | undefined;
}

/** Null lets the request through; otherwise the status and words to answer with. */
export function refuseRequest(headers: BridgeRequestHeaders, expected: { readonly port: number; readonly token: string }): { readonly status: 401 | 403; readonly message: string } | null {
  if (!hostAllowed(headers.host, expected.port)) return { status: 403, message: "This address only answers requests made to 127.0.0.1 or localhost." };
  if (!originAllowed(headers.origin)) return { status: 403, message: "Requests from web pages are not accepted." };
  if (!bearerMatches(headers.authorization, expected.token)) return { status: 401, message: "Missing or wrong key. Copy a fresh config from ADCode: Tools > Memory > Let other AI tools use ADCode." };
  return null;
}

export const bridgeUrl = (port: number): string => `http://127.0.0.1:${port}${BRIDGE_PATH}`;

/** The file Claude Code reads with `--mcp-config` when ADCode runs it as a chat model. */
export function claudeMcpConfig(url: string, token: string): string {
  return `${JSON.stringify({ mcpServers: { [BRIDGE_SERVER_NAME]: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2)}\n`;
}

export interface BridgeConfigSnippet {
  readonly client: string;
  readonly text: string;
}

/**
 * Ready-to-paste configuration for the agents people use most, each checked against that
 * agent's own documentation: `claude mcp add --help` and code.claude.com for Claude Code,
 * cursor.com/docs for the `mcpServers` JSON, and Codex's MCP page for its TOML keys.
 */
export function bridgeConfigs(url: string, token: string): BridgeConfigSnippet[] {
  const header = `Bearer ${token}`;
  return [
    // --scope user: the bridge is the whole computer's, not one project's.
    { client: "Claude Code", text: `claude mcp add --scope user --transport http ${BRIDGE_SERVER_NAME} ${url} --header "Authorization: ${header}"` },
    { client: "Cursor and other mcpServers JSON", text: JSON.stringify({ mcpServers: { [BRIDGE_SERVER_NAME]: { url, headers: { Authorization: header } } } }, null, 2) },
    { client: "Codex (~/.codex/config.toml)", text: `[mcp_servers.${BRIDGE_SERVER_NAME}]\nurl = "${url}"\nhttp_headers = { "Authorization" = "${header}" }` },
  ];
}

/**
 * The config file's path as a CLI argument.
 *
 * On Windows the CLIs are `.cmd` shims run through a shell, and only `isSafeCliToken`'s
 * characters get through - no backslash. Forward slashes name the same file to a Node-based
 * CLI. A path that still fails (a space or bracket in the user's folder name) is dropped by
 * `cliArgs`, and Claude Code then runs without ADCode's tools rather than not at all.
 */
export const cliConfigPath = (path: string): string => path.replace(/\\/g, "/");

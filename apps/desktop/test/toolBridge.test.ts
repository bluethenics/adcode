/*
 * The tool bridge's door: who gets in, and the configs that tell other agents where it is.
 * The last block runs the real server on loopback with a stub runner and the MCP SDK's own
 * client, because a subtly wrong handshake does not throw - it just never connects.
 */
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ToolDefinition, ToolRunner } from "@adcode/ai";
import {
  bearerMatches,
  bridgeConfigs,
  bridgeUrl,
  claudeMcpConfig,
  cliConfigPath,
  hostAllowed,
  isBridgeToken,
  newBridgeToken,
  originAllowed,
  parseBridgeState,
  refuseRequest,
} from "../src/main/toolBridgeModel.ts";
import { startToolBridgeServer, type ToolBridgeServer } from "../src/main/toolBridge.ts";

const TOKEN = newBridgeToken();

describe("tool bridge rules", () => {
  it("makes 32-byte base64url keys", () => {
    expect(isBridgeToken(TOKEN)).toBe(true);
    expect(Buffer.from(TOKEN, "base64url")).toHaveLength(32);
    expect(newBridgeToken()).not.toBe(TOKEN);
  });

  it("accepts only the exact bearer key", () => {
    expect(bearerMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerMatches(`bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
    expect(bearerMatches(`Bearer ${TOKEN.slice(1)}`, TOKEN)).toBe(false);
    expect(bearerMatches(TOKEN, TOKEN)).toBe(false);
    expect(bearerMatches(`Basic ${TOKEN}`, TOKEN)).toBe(false);
    expect(bearerMatches(undefined, TOKEN)).toBe(false);
    expect(bearerMatches([`Bearer ${TOKEN}`], TOKEN)).toBe(false);
    expect(bearerMatches("Bearer ", "")).toBe(false);
  });

  it("refuses hosts and origins a web page could produce", () => {
    expect(hostAllowed("127.0.0.1:4100", 4100)).toBe(true);
    expect(hostAllowed("localhost:4100", 4100)).toBe(true);
    expect(hostAllowed("LOCALHOST:4100", 4100)).toBe(true);
    expect(hostAllowed("127.0.0.1:4101", 4100)).toBe(false);
    expect(hostAllowed("127.0.0.1", 4100)).toBe(false);
    expect(hostAllowed("evil.example:4100", 4100)).toBe(false);
    expect(hostAllowed("127.0.0.1.evil.example:4100", 4100)).toBe(false);
    expect(hostAllowed(undefined, 4100)).toBe(false);
    expect(originAllowed(undefined)).toBe(true);
    expect(originAllowed("http://127.0.0.1:4100")).toBe(false);
    expect(originAllowed("https://evil.example")).toBe(false);
    expect(originAllowed("null")).toBe(false);
  });

  it("checks the host before the key, so a rebound page learns nothing about the key", () => {
    const expected = { port: 4100, token: TOKEN };
    expect(refuseRequest({ host: "evil.example:4100", authorization: `Bearer ${TOKEN}` }, expected)?.status).toBe(403);
    expect(refuseRequest({ host: "127.0.0.1:4100", origin: "https://evil.example", authorization: `Bearer ${TOKEN}` }, expected)?.status).toBe(403);
    expect(refuseRequest({ host: "127.0.0.1:4100" }, expected)?.status).toBe(401);
    expect(refuseRequest({ host: "127.0.0.1:4100", authorization: "Bearer nope" }, expected)?.status).toBe(401);
    expect(refuseRequest({ host: "localhost:4100", authorization: `Bearer ${TOKEN}` }, expected)).toBeNull();
  });

  it("reads its saved state and treats anything else as absent", () => {
    expect(parseBridgeState(JSON.stringify({ token: TOKEN, port: 4100 }))).toEqual({ token: TOKEN, port: 4100 });
    expect(parseBridgeState(JSON.stringify({ token: TOKEN, port: 80 }))).toEqual({ token: TOKEN, port: null });
    expect(parseBridgeState(JSON.stringify({ token: "short", port: 4100 }))).toBeNull();
    expect(parseBridgeState("{not json")).toBeNull();
    expect(parseBridgeState(null)).toBeNull();
  });

  it("writes configs each agent accepts", () => {
    const url = bridgeUrl(4100);
    expect(url).toBe("http://127.0.0.1:4100/mcp");
    const [claude, json, codex] = bridgeConfigs(url, TOKEN);
    expect(claude?.text).toBe(`claude mcp add --scope user --transport http adcode http://127.0.0.1:4100/mcp --header "Authorization: Bearer ${TOKEN}"`);
    expect(JSON.parse(json!.text)).toEqual({ mcpServers: { adcode: { url, headers: { Authorization: `Bearer ${TOKEN}` } } } });
    expect(codex?.text).toBe(`[mcp_servers.adcode]\nurl = "http://127.0.0.1:4100/mcp"\nhttp_headers = { "Authorization" = "Bearer ${TOKEN}" }`);
    expect(JSON.parse(claudeMcpConfig(url, TOKEN))).toEqual({ mcpServers: { adcode: { type: "http", url, headers: { Authorization: `Bearer ${TOKEN}` } } } });
  });

  it("gives the CLI a path without backslashes", () => {
    expect(cliConfigPath("C:\\Users\\me\\AppData\\Roaming\\ADCode\\tool-bridge-claude.json")).toBe("C:/Users/me/AppData/Roaming/ADCode/tool-bridge-claude.json");
  });
});

describe("tool bridge server", () => {
  const TOOLS: ToolDefinition[] = [
    { name: "adcode_features", description: "Find a feature.", inputSchema: { type: "object", properties: { query: { type: "string" } } }, mutating: false },
    { name: "adcode_action", description: "Do something.", inputSchema: { type: "object", properties: {} }, mutating: true },
  ];
  let server: ToolBridgeServer | null = null;
  afterEach(async () => { await server?.close(); server = null; });

  const connect = async (port: number, token: string | null): Promise<Client> => {
    const client = new Client({ name: "test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(bridgeUrl(port)), token === null ? {} : { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
    await client.connect(transport as Transport);
    return client;
  };

  it("lists and calls tools with the key, one call per tool at a time, and refuses without it", async () => {
    let active = 0;
    let most = 0;
    const runner: ToolRunner = {
      async run(call) {
        active++; most = Math.max(most, active);
        await new Promise((resolve) => setTimeout(resolve, 30));
        active--;
        return { content: JSON.stringify({ ran: call.name, input: call.input }), isError: false };
      },
    };
    server = await startToolBridgeServer({ port: null, token: () => TOKEN, tools: () => TOOLS, runner });
    const client = await connect(server.port, TOKEN);
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(["adcode_features", "adcode_action"]);
    expect(listed.tools[0]?.annotations?.readOnlyHint).toBe(true);
    const [a, b] = await Promise.all([
      client.callTool({ name: "adcode_features", arguments: { query: "x" } }),
      client.callTool({ name: "adcode_features", arguments: { query: "y" } }),
    ]);
    expect(most).toBe(1);
    expect(a.content).toEqual([{ type: "text", text: JSON.stringify({ ran: "adcode_features", input: { query: "x" } }) }]);
    expect(b.isError).toBe(false);
    const unknown = await client.callTool({ name: "shell", arguments: {} });
    expect(unknown.isError).toBe(true);
    await client.close();

    await expect(connect(server.port, null)).rejects.toThrow();
    await expect(connect(server.port, newBridgeToken())).rejects.toThrow();
  });

  it("refuses a rebound Host and any Origin, and stops a call at its ceiling", async () => {
    const runner: ToolRunner = { run: () => new Promise(() => undefined) };
    server = await startToolBridgeServer({ port: null, token: () => TOKEN, tools: () => TOOLS, runner, ceilingMs: 100 });
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
    const headers = { Authorization: `Bearer ${TOKEN}`, "content-type": "application/json", accept: "application/json, text/event-stream" };
    const { request } = await import("node:http");
    const post = (extra: Record<string, string>) => new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port: server!.port, path: "/mcp", method: "POST", headers: { ...headers, ...extra } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on("error", reject);
      req.end(body);
    });
    expect(await post({ host: "evil.example" })).toBe(403);
    expect(await post({ origin: "https://evil.example" })).toBe(403);
    const client = await connect(server.port, TOKEN);
    const stopped = await client.callTool({ name: "adcode_action", arguments: {} });
    expect(stopped.isError).toBe(true);
    await client.close();
  });
});

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import type { AssistantServerInput } from "../shared/assistantControls.ts";
import type { McpSession, RemoteTool } from "./assistantControlsService.ts";

/** Real SDK transport, kept separate so policy and persistence can be tested offline. */
export async function connectAssistantMcp(server: AssistantServerInput, onClose: () => void): Promise<McpSession> {
  const client = new Client({ name: "adcode-assistant", version: "1.0.2" }, { capabilities: {} });
  const transport = server.transport === "stdio"
    ? new StdioClientTransport({ command: server.endpoint, args: [...server.args], stderr: "ignore", maxBufferSize: 2_000_000 })
    : new StreamableHTTPClientTransport(new URL(server.endpoint), { requestInit: { redirect: "error" } });
  client.onclose = onClose;
  // Revoke the cached tool catalogue immediately when its definitions change.
  // Reconnect discovers the new signatures and requires re-enabling changed tools.
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
    onClose();
    await client.close();
  });
  try {
    // SDK HTTP transport declares sessionId as string | undefined while its own
    // Transport interface uses an optional string (exactOptionalPropertyTypes).
    await client.connect(transport as Transport, { timeout: 12_000 });
  } catch (error) {
    await transport.close().catch(() => undefined);
    throw error;
  }
  return {
    async list() {
      const tools: RemoteTool[] = [];
      const names = new Set<string>();
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 12_000 });
        for (const tool of page.tools) {
          if (names.has(tool.name)) continue;
          if (tools.length >= 500) throw new Error("Server exposes more than 500 tools. Limit its tool list and reconnect.");
          names.add(tool.name);
          const entry = { name: tool.name, description: tool.description ?? "", inputSchema: tool.inputSchema };
          if (JSON.stringify(entry).length > 20_000) throw new Error(`Tool ${tool.name} has a schema too large for discovery.`);
          tools.push(entry);
        }
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error("Server repeated a tool-list cursor.");
        if (cursor) cursors.add(cursor);
        if (cursors.size > 30) throw new Error("Server tool pagination exceeded 30 pages.");
      } while (cursor);
      return tools;
    },
    async call(name, args, signal) {
      const response = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 30_000, maxTotalTimeout: 30_000 });
      const blocks = Array.isArray(response.content) ? response.content : [];
      const text = blocks.map((block: Record<string, unknown>) => {
        if (block["type"] === "text") return String(block["text"] ?? "");
        if (block["type"] === "resource" && typeof block["resource"] === "object" && block["resource"] !== null) {
          const resource = block["resource"] as Record<string, unknown>;
          return typeof resource["text"] === "string" ? resource["text"] : `[Resource: ${String(resource["uri"] ?? "unknown")}]`;
        }
        if (block["type"] === "resource_link") return `[Resource: ${String(block["name"] ?? "")} ${String(block["uri"] ?? "")}]`;
        return `[${String(block["type"] ?? "Unknown")} content returned; this assistant currently displays MCP text results.]`;
      }).join("\n");
      return { content: text || JSON.stringify(response.structuredContent ?? {}), isError: response.isError === true };
    },
    close: () => client.close(),
  };
}

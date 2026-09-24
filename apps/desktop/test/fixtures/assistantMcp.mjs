import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "adcode-test", version: "1" }, { capabilities: { tools: { listChanged: true } } });
server.setRequestHandler(ListToolsRequestSchema, async ({ params }) => params?.cursor === "page2" ? {
  tools: [{ name: "change_catalogue", description: "Notify a catalogue change", inputSchema: { type: "object" } }],
} : {
  tools: [{ name: "echo", description: "Echo text", inputSchema: { type: "object", properties: { text: { type: "string" } } } }], nextCursor: "page2",
});
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  if (params.name === "change_catalogue") {
    setTimeout(() => { void server.sendToolListChanged(); }, 50);
    return { content: [{ type: "text", text: "Catalogue changed" }] };
  }
  return { content: [{ type: "text", text: String(params.arguments?.["text"] ?? "hello") }] };
});
await server.connect(new StdioServerTransport());

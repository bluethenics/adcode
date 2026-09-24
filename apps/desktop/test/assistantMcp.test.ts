import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { connectAssistantMcp } from "../src/main/assistantMcp.ts";

it("connects to a real stdio MCP server, discovers paginated tools, calls one, and revokes a changed catalogue", async () => {
  const onClose = vi.fn();
  const session = await connectAssistantMcp({ id: "fixture", name: "Fixture", transport: "stdio", endpoint: process.execPath, args: [fileURLToPath(new URL("./fixtures/assistantMcp.mjs", import.meta.url))] }, onClose);
  try {
    expect((await session.list()).map(tool => tool.name)).toEqual(["echo", "change_catalogue"]);
    expect(await session.call("echo", { text: "MCP round trip" }, new AbortController().signal)).toEqual({ content: "MCP round trip", isError: false });
    await session.call("change_catalogue", {}, new AbortController().signal);
    await vi.waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2000 });
  } finally { await session.close(); }
});

/**
 * The Tools page as data: which agents may use a tool, what a server's last error means in
 * plain words, and a catalogue whose one-click entries actually work in ADCode.
 */
import { describe, expect, it } from "vitest";
import { TOOLS_WITHOUT_MEMORY, BUILT_IN_TOOLS } from "@adcode/ai";
import { parseAssistantServer } from "../src/main/assistantControlsService.ts";
import { MCP_CATALOGUE } from "../src/shared/mcpCatalogue.ts";
import { AGENT_PICKABLE_TOOLS, BUILT_IN_TOOLS_INFO } from "../src/renderer/tools/builtInTools.ts";
import { explainMcpError, matchesQuery, serverSummary, toolUsers } from "../src/renderer/tools/toolsModel.ts";
import type { AgentProfile } from "../src/renderer/ai/agentProfiles.ts";

const agent = (name: string, toolAccess?: AgentProfile["toolAccess"]): AgentProfile => ({
  id: `agent-${name.toLowerCase()}`, name, instructions: "x", provider: "anthropic", model: "claude-sonnet-5", ...(toolAccess === undefined ? {} : { toolAccess }),
});

describe("built-in tools in plain words", () => {
  it("describes exactly the tools the assistant has", () => {
    expect(BUILT_IN_TOOLS_INFO.map((tool) => tool.name).sort()).toEqual(BUILT_IN_TOOLS.map((tool) => tool.name).sort());
  });

  it("offers agents exactly the tools a board run is built with", () => {
    expect(AGENT_PICKABLE_TOOLS.map((tool) => tool.name).sort()).toEqual(TOOLS_WITHOUT_MEMORY.map((tool) => tool.name).sort());
  });
});

describe("who may use a tool", () => {
  const agents = [agent("Reviewer", "read-only"), agent("Tester"), agent("Picky", ["search"])];

  it("always includes the chat, then every agent whose access allows it", () => {
    expect(toolUsers("read_file", agents)).toEqual(["Chat", "Reviewer", "Tester"]);
    expect(toolUsers("search", agents)).toEqual(["Chat", "Reviewer", "Tester", "Picky"]);
    expect(toolUsers("edit_file", agents)).toEqual(["Chat", "Tester"]);
  });

  it("keeps memory tools to the chat, which is the only place they run", () => {
    expect(toolUsers("memory_write", agents)).toEqual(["Chat"]);
  });
});

describe("MCP errors in plain words", () => {
  it("names a program that is missing", () => {
    expect(explainMcpError("spawn npx ENOENT")).toBe("Couldn't start: npx wasn't found. Install Node.js from nodejs.org, then press Retry.");
    expect(explainMcpError("spawn uvx ENOENT")).toBe("Couldn't start: uvx wasn't found. Install it, then press Retry.");
  });

  it("explains refused logins, silence and timeouts", () => {
    expect(explainMcpError("HTTP 401 Unauthorized")).toMatch(/refused the sign-in/);
    expect(explainMcpError("connect ECONNREFUSED 127.0.0.1:3845")).toMatch(/Nothing is answering/);
    expect(explainMcpError("Request timed out")).toMatch(/took too long/);
  });

  it("passes anything else through, trimmed, and says nothing when there is no error", () => {
    expect(explainMcpError("Some odd failure\nwith a stack")).toBe("Some odd failure");
    expect(explainMcpError(null)).toBeNull();
  });
});

describe("summaries and search", () => {
  it("counts a server's tools and uses", () => {
    const tools = [{ calls: 3 }, { calls: 0 }, { calls: 58 }].map((tool, index) => ({ name: `t${index}`, description: "", enabled: true, lastDurationMs: null, lastError: null, ...tool }));
    expect(serverSummary(tools)).toBe("3 tools · 61 uses");
    expect(serverSummary([])).toBe("No tools yet");
  });

  it("matches a query across any of the given fields, ignoring case", () => {
    expect(matchesQuery("PLAY", ["Playwright", "browser"])).toBe(true);
    expect(matchesQuery("", ["anything"])).toBe(true);
    expect(matchesQuery("stripe", ["Playwright", "browser"])).toBe(false);
  });
});

describe("MCP catalogue", () => {
  it("has entries that pass the same server validator a hand-typed server does", () => {
    expect(MCP_CATALOGUE.length).toBeGreaterThanOrEqual(5);
    for (const entry of MCP_CATALOGUE) {
      expect(() => parseAssistantServer({ id: entry.id, name: entry.name, transport: entry.transport, endpoint: entry.endpoint, args: entry.args }), entry.id).not.toThrow();
    }
  });

  it("never asks for a credential in an argument", () => {
    for (const entry of MCP_CATALOGUE) {
      expect(entry.args.join(" "), entry.id).not.toMatch(/key|token|secret|password/i);
    }
  });

  it("gives every entry a purpose and unique id", () => {
    expect(new Set(MCP_CATALOGUE.map((entry) => entry.id)).size).toBe(MCP_CATALOGUE.length);
    for (const entry of MCP_CATALOGUE) expect(entry.purpose.length, entry.id).toBeGreaterThan(20);
  });
});

describe("chat-only tools", () => {
  it("keeps the project overview to the chat, since board runs are built without it", () => {
    expect(toolUsers("project_context", [agent("Tester")])).toEqual(["Chat"]);
  });
});

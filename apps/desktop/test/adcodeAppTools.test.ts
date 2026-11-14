import { describe, expect, it } from "vitest";
import type { ToolCallBlock } from "@adcode/ai";
import { defaultSettings, type SettingsValues } from "@adcode/settings";
import { createAdcodeAppTools, type AdcodeAppDeps } from "../src/main/adcodeAppTools.ts";
import { mcpCatalogueFor, MCP_CATALOGUE } from "../src/shared/mcpCatalogue.ts";
import { parseAssistantServer } from "../src/main/assistantControlsService.ts";
import type { AssistantControlsView, AssistantServerView } from "../src/shared/assistantControls.ts";

const call = (name: string, input: Record<string, unknown>): ToolCallBlock => ({ type: "tool-call", id: "c1", name, input });
const signal = new AbortController().signal;

/** A stand-in for the connectors service: it records actions and answers like the real one. */
function harness(options: { confirm?: boolean; connectTo?: "connected" | "error" } = {}) {
  const actions: Record<string, unknown>[] = [];
  const confirms: string[] = [];
  const commands: string[] = [];
  const written: [string, unknown][] = [];
  let servers: AssistantServerView[] = [];
  const values: SettingsValues = defaultSettings();
  const view = (): AssistantControlsView => ({ workspace: null, servers, skills: [], drafts: [], notice: null });
  const deps: AdcodeAppDeps = {
    platform: "win32",
    controls: {
      snapshot: () => Promise.resolve(view()),
      action: (input) => {
        const action = input as Record<string, unknown>;
        actions.push(action);
        if (action["kind"] === "save-server") {
          const record = parseAssistantServer(action["server"]);
          servers = [...servers.filter((item) => item.id !== record.id), { ...record, status: "disconnected", error: null, oauth: null, values: [], tools: [] }];
        }
        if (action["kind"] === "connect") {
          servers = servers.map((item) => item.id !== action["id"] ? item : options.connectTo === "error"
            ? { ...item, status: "error", error: "spawn failed" }
            : { ...item, status: "connected", tools: [{ name: "run_code", description: "", enabled: false, calls: 0, lastDurationMs: null, lastError: null }, { name: "list_children", description: "", enabled: false, calls: 0, lastDurationMs: null, lastError: null }] });
        }
        if (action["kind"] === "set-tool") {
          servers = servers.map((item) => item.id !== action["id"] ? item : { ...item, tools: item.tools.map((tool) => tool.name === action["tool"] ? { ...tool, enabled: true } : tool) });
        }
        return Promise.resolve(view());
      },
    },
    confirm: (title) => { confirms.push(title); return Promise.resolve(options.confirm ?? true); },
    settings: () => values,
    writeSetting: (id, value) => { written.push([id, value]); values[id] = value; return Promise.resolve(values); },
    runCommand: (command) => { commands.push(command); return true; },
  };
  return { tools: createAdcodeAppTools(deps), actions, confirms, commands, written };
}

describe("adcode_features", () => {
  it("answers 'can ADCode connect an MCP server' with the real feature", async () => {
    const { tools } = harness();
    const answer = await tools.run(call("adcode_features", { query: "mcp server connector" }), signal);
    expect(answer.isError).toBe(false);
    expect(answer.content.toLowerCase()).toContain("mcp");
  });

  it("lists commands it can run and settings with their current value", async () => {
    const { tools } = harness();
    const answer = JSON.parse((await tools.run(call("adcode_features", { query: "theme" }), signal)).content) as { features: { actions: Record<string, unknown>[] }[] };
    const actions = answer.features.flatMap((feature) => feature.actions);
    expect(actions.some((action) => action["setting"] === "adcode.appearance.theme" && Array.isArray(action["options"]))).toBe(true);
  });
});

describe("adcode_action", () => {
  it("runs a catalogue command in the window and claims no more than that", async () => {
    const { tools, commands } = harness();
    const answer = await tools.run(call("adcode_action", { command: "ai.showUsage" }), signal);
    expect(commands).toEqual(["ai.showUsage"]);
    expect(answer.content).toContain("does not report back");
  });

  it("refuses a command no feature offers", async () => {
    const { tools, commands } = harness();
    expect((await tools.run(call("adcode_action", { command: "app.quit" }), signal)).isError).toBe(true);
    expect(commands).toEqual([]);
  });

  it("changes an everyday setting at once and checks the value", async () => {
    const { tools, written, confirms } = harness();
    const theme = await tools.run(call("adcode_action", { setting: "adcode.appearance.theme", value: "not-a-theme" }), signal);
    expect(theme.isError).toBe(true);
    const motion = await tools.run(call("adcode_action", { setting: "adcode.appearance.motion", value: "reduce" }), signal);
    expect(motion.isError, motion.content).toBe(false);
    expect(written).toEqual([["adcode.appearance.motion", "reduce"]]);
    expect(confirms).toEqual([]);
  });

  it("asks before touching where edits land, and keeps it when the user says no", async () => {
    const { tools, written, confirms } = harness({ confirm: false });
    const answer = await tools.run(call("adcode_action", { setting: "adcode.ai.editPolicy", value: "review" }), signal);
    expect(confirms).toHaveLength(1);
    expect(answer.isError).toBe(true);
    expect(written).toEqual([]);
  });

  it("refuses to change the one setting that would let it switch off its own guard rails", async () => {
    const { tools, written, confirms } = harness();
    const on = await tools.run(call("adcode_action", { setting: "adcode.ai.fullAccess", value: true }), signal);
    expect(on.isError).toBe(true);
    expect(on.content).toContain("only the person");
    const off = await tools.run(call("adcode_action", { setting: "adcode.ai.fullAccess", value: false }), signal);
    expect(off.isError).toBe(true);
    expect(written).toEqual([]);
    expect(confirms).toEqual([]);
  });

  it("refuses to run the command that opens the person's full access card", async () => {
    const { tools, commands } = harness();
    const answer = await tools.run(call("adcode_action", { command: "ai.fullAccess" }), signal);
    expect(answer.isError).toBe(true);
    expect(commands).toEqual([]);
  });

  it("runs several commands and settings in one call, in order", async () => {
    const { tools, commands, written } = harness();
    const answer = await tools.run(call("adcode_action", {
      steps: [
        { command: "ai.showUsage" },
        { setting: "adcode.appearance.motion", value: "reduce" },
      ],
    }), signal);
    expect(answer.isError, answer.content).toBe(false);
    expect(commands).toEqual(["ai.showUsage"]);
    expect(written).toEqual([["adcode.appearance.motion", "reduce"]]);
    expect(answer.content).toContain("Step 1");
    expect(answer.content).toContain("Step 2");
  });

  it("stops a batch at the first failing step and says which one", async () => {
    const { tools, commands, written } = harness();
    const answer = await tools.run(call("adcode_action", {
      steps: [
        { command: "ai.showUsage" },
        { command: "app.quit" },
        { setting: "adcode.appearance.motion", value: "reduce" },
      ],
    }), signal);
    expect(answer.isError).toBe(true);
    expect(answer.content).toContain("Step 2");
    expect(commands).toEqual(["ai.showUsage"]);
    expect(written).toEqual([]);
  });
});

describe("adcode_connectors", () => {
  it("adds the Roblox Studio preset, connects it, and enables its tools with the user's yes", async () => {
    const { tools, actions, confirms } = harness();
    const added = await tools.run(call("adcode_connectors", { action: "add", preset: "roblox-studio" }), signal);
    expect(added.isError, added.content).toBe(false);
    expect(added.content).toContain("Connected with 2 tools, 0 enabled");
    expect(added.content).toContain("Enable Studio as MCP server");
    expect(actions.map((action) => action["kind"])).toEqual(["save-server", "connect"]);
    expect(actions[0]?.["server"]).toMatchObject({ endpoint: "cmd.exe", args: ["/c", "%LOCALAPPDATA%\\Roblox\\mcp.bat"] });

    const enabled = await tools.run(call("adcode_connectors", { action: "enable_tools", id: "roblox-studio", tools: ["*"] }), signal);
    expect(enabled.content).toContain("Enabled 2 tools");
    expect(confirms).toEqual(["Let the assistant use Roblox Studio?"]);
  });

  it("reports a failed connection as failed", async () => {
    const { tools } = harness({ connectTo: "error" });
    const added = await tools.run(call("adcode_connectors", { action: "add", id: "my-server", name: "Mine", transport: "stdio", command: "node", args: ["server.js"] }), signal);
    expect(added.content).toContain("did not connect: spawn failed");
  });

  it("lists presets so 'no tools connected' is never read as 'cannot connect'", async () => {
    const { tools } = harness();
    const listed = JSON.parse((await tools.run(call("adcode_connectors", { action: "list" }), signal)).content) as { connectors: unknown[]; presets: { id: string }[] };
    expect(listed.connectors).toEqual([]);
    expect(listed.presets.map((preset) => preset.id)).toContain("roblox-studio");
  });

  it("asks before removing one", async () => {
    const { tools, actions } = harness({ confirm: false });
    await tools.run(call("adcode_connectors", { action: "add", preset: "playwright" }), signal);
    const removed = await tools.run(call("adcode_connectors", { action: "remove", id: "playwright" }), signal);
    expect(removed.isError).toBe(true);
    expect(actions.some((action) => action["kind"] === "remove-server")).toBe(false);
  });
});

describe("the MCP catalogue per platform", () => {
  it("gives macOS Roblox's own binary and leaves Linux without it", () => {
    expect(mcpCatalogueFor("darwin").find((entry) => entry.id === "roblox-studio")).toMatchObject({ endpoint: "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP", args: [] });
    expect(mcpCatalogueFor("linux").some((entry) => entry.id === "roblox-studio")).toBe(false);
    expect(mcpCatalogueFor("linux").length).toBe(MCP_CATALOGUE.length - 1);
  });
});

/**
 * ADCode itself, as tools the assistant can use.
 *
 * Asked to connect Roblox Studio over MCP, the assistant answered that ADCode "may not
 * support MCP" and told the person to find a settings panel. ADCode has a whole connectors
 * page; the assistant had no way to know, so it guessed, and the guess was wrong. These
 * tools close that gap:
 *
 * - `adcode_features` searches the same feature catalogue the Feature library, the guide and
 *   universal search read (`@adcode/help`), so "can ADCode do X, and how" has a real answer;
 * - `adcode_action` runs one of that catalogue's commands in the window, or changes a
 *   setting, so the assistant does the thing instead of describing where the button is;
 * - `adcode_connectors` lists, adds, connects and enables MCP servers through the same
 *   service the Tools page uses - every rule that service enforces still applies.
 *
 * What the person must approve, they still approve: starting a connector's program, letting
 * the assistant use a connector's tools, removing one, and settings that touch ads, updates,
 * where edits land or what runs as a command. Plain Node, no Electron, so it is testable.
 */
import type { ToolDefinition, ToolRunner } from "@adcode/ai";
import { FEATURE_COMMANDS, searchFeatures, type FeatureRecord } from "@adcode/help";
import { getSetting, isValidSettingValue, type SettingsValues } from "@adcode/settings";
import type { AssistantControlsView, AssistantServerView } from "../shared/assistantControls.ts";
import { mcpCatalogueFor } from "../shared/mcpCatalogue.ts";

export const ADCODE_APP_TOOLS: readonly ToolDefinition[] = [
  {
    name: "adcode_features",
    description:
      "Search ADCode's own features - what the app can do, how to use it, and the exact command or setting that opens it. Use it before telling the user ADCode cannot do something or that they must do it themselves, and before explaining where something is. Examples: 'connect mcp server', 'dark theme', 'usage', 'commit', 'zoom'.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Words describing what the user wants to do in ADCode" } }, required: ["query"] },
    mutating: false,
    concurrent: true,
  },
  {
    name: "adcode_action",
    description:
      "Do something in ADCode for the user: run one command adcode_features returned (it opens that view or runs that action in the window), or change one setting to a value adcode_features listed. Pass command, or setting with value. Prefer this to telling the user which button to press.",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "A command id from adcode_features, e.g. ai.showUsage" },
        setting: { type: "string", description: "A setting id from adcode_features, e.g. adcode.appearance.theme" },
        value: { description: "The setting's new value: true/false for a switch, one of the listed options for a choice" },
      },
    },
    mutating: true,
  },
  {
    name: "adcode_connectors",
    description:
      "Manage ADCode's MCP connectors (external tool servers such as Roblox Studio, Playwright, Figma). list shows saved connectors, their status and tools, plus ready-made presets. add saves one - a preset id, or your own stdio command or http/sse url - and connects it. connect starts a saved one. enable_tools lets you use its tools (the user approves). disconnect and remove do what they say. After enable_tools, use discover_capabilities and call_mcp.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "add", "connect", "enable_tools", "disconnect", "remove"] },
        id: { type: "string", description: "The connector id (connect, enable_tools, disconnect, remove), or the id to save a custom one under: lowercase-with-hyphens" },
        preset: { type: "string", description: "add: a preset id from list, e.g. roblox-studio" },
        name: { type: "string", description: "add (custom): a display name" },
        transport: { type: "string", enum: ["stdio", "http", "sse"], description: "add (custom): stdio runs a program; http/sse call an address" },
        command: { type: "string", description: "add (custom, stdio): the program to run, e.g. npx or cmd.exe" },
        args: { type: "array", items: { type: "string" }, description: "add (custom, stdio): its arguments" },
        url: { type: "string", description: "add (custom, http/sse): the server address" },
        tools: { type: "array", items: { type: "string" }, description: "enable_tools: tool names, or [\"*\"] for every tool the connector has" },
      },
      required: ["action"],
    },
    mutating: true,
  },
];

export interface AdcodeAppDeps {
  readonly controls: {
    snapshot(): Promise<AssistantControlsView>;
    action(input: unknown): Promise<AssistantControlsView>;
  };
  readonly confirm: (title: string, detail: string, signal?: AbortSignal) => Promise<boolean>;
  /** win32, darwin or linux - where connector programs would start. */
  readonly platform: string;
  readonly settings: () => SettingsValues;
  readonly writeSetting: (id: string, value: boolean | string) => Promise<unknown>;
  /** Ask the workbench window to run a command. False when there is no window to ask. */
  readonly runCommand: (command: string) => boolean;
}

/** Every command a feature offers; nothing else can be run from here. */
const RUNNABLE: ReadonlySet<string> = new Set(Object.values(FEATURE_COMMANDS.children).flat());

/**
 * Settings the person confirms before the assistant changes them: what they earn, how the
 * app updates, where the assistant's edits land, and anything that names a program to run or
 * a server to send code to. Every text setting asks too.
 */
const GUARDED_PREFIXES = ["adcode.ads.", "adcode.updates."];
const GUARDED = new Set(["adcode.ai.editPolicy", "adcode.ai.isolatedWorkspaces", "adcode.ai.systemFileTools", "adcode.ai.customBaseUrl", "adcode.ai.provider", "adcode.ai.connections", "adcode.ai.agentProfiles", "adcode.language.customServers"]);

const result = (content: string, isError = false) => ({ content, isError });
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function describeFeature(record: FeatureRecord, values: SettingsValues): object {
  const { entry } = record;
  return {
    id: entry.id,
    title: entry.title,
    what: entry.plain,
    how: entry.how,
    ...(entry.shortcut === undefined ? {} : { shortcut: entry.shortcut }),
    actions: record.actions.flatMap((action): object[] => {
      if (action.kind === "command") return RUNNABLE.has(action.command) ? [{ command: action.command, label: action.label }] : [];
      if (action.kind === "toggle") return [];
      const setting = getSetting(action.settingId);
      if (setting === undefined || !setting.available) return [];
      return [{
        setting: setting.id,
        label: setting.label,
        current: values[setting.id] ?? setting.default,
        ...(setting.kind === "enum" ? { options: setting.options.map((option) => option.value) } : { type: setting.kind }),
      }];
    }),
  };
}

function connectorLine(server: AssistantServerView): object {
  return {
    id: server.id,
    name: server.name,
    status: server.status,
    ...(server.error === null ? {} : { error: server.error }),
    transport: server.transport,
    [server.transport === "stdio" ? "command" : "url"]: server.transport === "stdio" ? [server.endpoint, ...server.args].join(" ") : server.endpoint,
    tools: server.tools.map((tool) => ({ name: tool.name, enabled: tool.enabled })),
  };
}

export function createAdcodeAppTools(deps: AdcodeAppDeps): ToolRunner {
  const presets = () => mcpCatalogueFor(deps.platform);

  async function connectorReport(id: string, lead: string): Promise<string> {
    const view = await deps.controls.snapshot();
    const server = view.servers.find((item) => item.id === id);
    if (server === undefined) return `${lead} The connector ${id} is not saved.`;
    const enabled = server.tools.filter((tool) => tool.enabled).length;
    const state = server.status === "connected"
      ? `Connected with ${server.tools.length.toString()} tools, ${enabled.toString()} enabled for you.${enabled < server.tools.length ? " Use enable_tools to use the rest." : ""}`
      : server.status === "error"
        ? `It did not connect: ${server.error ?? "no reason given"}.`
        : "It is not connected. The user may have declined, or it is still starting.";
    return `${lead} ${state}\n${JSON.stringify(connectorLine(server))}`;
  }

  async function connectors(input: Record<string, unknown>, signal: AbortSignal) {
    const action = text(input["action"]);
    if (action === "list") {
      const view = await deps.controls.snapshot();
      const saved = new Set(view.servers.map((server) => server.id));
      return result(JSON.stringify({
        connectors: view.servers.map(connectorLine),
        presets: presets().map((entry) => ({ id: entry.id, name: entry.name, purpose: entry.purpose, before: entry.before, added: saved.has(entry.id) })),
        note: "The user can see and change all of this on the Tools page (Connectors). Presets and custom servers can both be added with action add.",
      }));
    }

    if (action === "add") {
      const presetId = text(input["preset"]);
      let server: { id: string; name: string; transport: string; endpoint: string; args: readonly string[] };
      let before: string | null = null;
      if (presetId !== "") {
        const preset = presets().find((entry) => entry.id === presetId);
        if (preset === undefined) return result(`No preset called ${presetId} on this computer. Presets: ${presets().map((entry) => entry.id).join(", ")}. Or add it as a custom server.`, true);
        server = { id: preset.id, name: preset.name, transport: preset.transport, endpoint: preset.endpoint, args: preset.args };
        before = preset.before;
      } else {
        const transport = text(input["transport"]) || (text(input["url"]) !== "" ? "http" : "stdio");
        const args = Array.isArray(input["args"]) ? input["args"].filter((arg): arg is string => typeof arg === "string") : [];
        server = {
          id: text(input["id"]),
          name: text(input["name"]) || text(input["id"]),
          transport,
          endpoint: transport === "stdio" ? text(input["command"]) : text(input["url"]),
          args: transport === "stdio" ? args : [],
        };
      }
      try {
        await deps.controls.action({ kind: "save-server", server });
      } catch (error) {
        return result(`Not saved: ${error instanceof Error ? error.message : String(error)}`, true);
      }
      if (signal.aborted) return result("Saved, then stopped before connecting.", true);
      // Connecting asks the user in the app's own dialog, showing the exact program it starts.
      try {
        await deps.controls.action({ kind: "connect", id: server.id });
      } catch (error) {
        return result(`Saved ${server.name}, but connecting failed: ${error instanceof Error ? error.message : String(error)}`, true);
      }
      const report = await connectorReport(server.id, `Saved ${server.name}.`);
      return result(before === null ? report : `${report}\nBefore it works: ${before}`);
    }

    const id = text(input["id"]);
    if (id === "") return result("Pass the connector's id. action list shows them.", true);
    const view = await deps.controls.snapshot();
    const server = view.servers.find((item) => item.id === id);
    if (server === undefined) return result(`No saved connector ${id}. Saved: ${view.servers.map((item) => item.id).join(", ") || "none"}. Use action add first.`, true);

    try {
      if (action === "connect") {
        await deps.controls.action({ kind: "connect", id });
        return result(await connectorReport(id, `Asked to connect ${server.name}.`));
      }
      if (action === "disconnect") {
        await deps.controls.action({ kind: "disconnect", id });
        return result(`Disconnected ${server.name}.`);
      }
      if (action === "remove") {
        if (!(await deps.confirm(`Remove ${server.name}?`, `The assistant wants to remove the connector ${server.name} and forget its saved values. You can add it again later.`, signal))) return result("The user kept the connector.", true);
        await deps.controls.action({ kind: "remove-server", id });
        return result(`Removed ${server.name}.`);
      }
      if (action === "enable_tools") {
        if (server.status !== "connected") return result(`${server.name} is ${server.status}. Connect it first.`, true);
        const asked = Array.isArray(input["tools"]) ? input["tools"].filter((tool): tool is string => typeof tool === "string") : [];
        const wanted = asked.includes("*") ? server.tools.map((tool) => tool.name) : asked;
        const unknown = wanted.filter((name) => !server.tools.some((tool) => tool.name === name));
        if (unknown.length > 0) return result(`${server.name} has no tool called ${unknown.join(", ")}. Its tools: ${server.tools.map((tool) => tool.name).join(", ")}.`, true);
        const toEnable = wanted.filter((name) => server.tools.some((tool) => tool.name === name && !tool.enabled));
        if (toEnable.length === 0) return result(wanted.length === 0 ? "Name the tools to enable, or pass [\"*\"]." : "Those tools are already enabled.");
        const shown = toEnable.length > 12 ? `${toEnable.slice(0, 12).join(", ")} and ${(toEnable.length - 12).toString()} more` : toEnable.join(", ");
        if (!(await deps.confirm(`Let the assistant use ${server.name}?`, `It asks to use these ${toEnable.length.toString()} tools: ${shown}.\n\nEach call is still shown to you before it runs.`, signal))) return result("The user did not enable those tools.", true);
        for (const tool of toEnable) await deps.controls.action({ kind: "set-tool", id, tool, enabled: true });
        return result(`Enabled ${toEnable.length.toString()} tools on ${server.name}. Find them with discover_capabilities and call them with call_mcp.`);
      }
    } catch (error) {
      return result(error instanceof Error ? error.message : String(error), true);
    }
    return result("Unknown action. Use list, add, connect, enable_tools, disconnect or remove.", true);
  }

  async function act(input: Record<string, unknown>, signal: AbortSignal) {
    const command = text(input["command"]);
    if (command !== "") {
      if (!RUNNABLE.has(command)) return result(`${command} is not an ADCode feature command. Find the right one with adcode_features.`, true);
      if (!deps.runCommand(command)) return result("No ADCode window is open to run it in.", true);
      // The window runs it without answering, so say only what is known.
      return result(`Sent ${command} to the ADCode window. It opens or runs there; the window does not report back, so do not claim more than that.`);
    }

    const id = text(input["setting"]);
    if (id === "") return result("Pass a command, or a setting with a value.", true);
    const setting = getSetting(id);
    if (setting === undefined || !setting.available) return result(`${id} is not a setting ADCode has. Find the right one with adcode_features.`, true);
    const value = input["value"];
    if (!isValidSettingValue(setting, value)) {
      return result(setting.kind === "enum"
        ? `${setting.label} takes one of: ${setting.options.map((option) => option.value).join(", ")}.`
        : `${setting.label} takes ${setting.kind === "boolean" ? "true or false" : "text"}.`, true);
    }
    const before = deps.settings()[id] ?? setting.default;
    if (before === value) return result(`${setting.label} is already ${String(value)}.`);
    const guarded = setting.kind === "text" || GUARDED.has(id) || GUARDED_PREFIXES.some((prefix) => id.startsWith(prefix));
    if (guarded && !(await deps.confirm(`Change ${setting.label}?`, `The assistant wants to change ${setting.label} from ${String(before)} to ${String(value)}.`, signal))) {
      return result("The user kept the setting as it was.", true);
    }
    await deps.writeSetting(id, value as boolean | string);
    return result(`${setting.label} changed from ${String(before)} to ${String(value)}.`);
  }

  return {
    async run(call, signal) {
      if (signal.aborted) return result("Cancelled.", true);
      const input = typeof call.input === "object" && call.input !== null ? call.input : {};
      if (call.name === "adcode_features") {
        const values = deps.settings();
        const found = searchFeatures(text(input["query"])).slice(0, 6);
        if (found.length === 0) {
          return result("No ADCode feature matches those words. Try other words before concluding ADCode cannot do it; if it still is not there, tell the user plainly that ADCode does not have it.");
        }
        return result(JSON.stringify({ features: found.map((record) => describeFeature(record, values)), hint: "Run a command or change a setting with adcode_action. For MCP servers use adcode_connectors." }));
      }
      if (call.name === "adcode_action") return act(input, signal);
      if (call.name === "adcode_connectors") return connectors(input, signal);
      return result("Unknown ADCode tool.", true);
    },
  };
}

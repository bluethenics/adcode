/**
 * Tools loaded on demand (2026-11-14).
 *
 * Tool definitions are most of every request: ADCode's chat offered forty, about 7,500 tokens,
 * sent again with every step - the same few that a coding turn uses (read, search, edit, run)
 * and many it rarely does (forks, team rooms, page audits, browser control, memory). Measured
 * against Claude Code, Codex, OpenCode and DeepSeek Harness on one task, that put ADCode behind
 * the leanest harness on tokens (docs/token-benchmark-2026-11-14.md).
 *
 * Now the rarely used tools travel as one line each inside `load_tools`. The model loads what a
 * task needs by name; from the next step those tools are sent whole, and they stay for the
 * rest of the conversation. A model that calls a listed tool directly has it run all the same,
 * and loaded from then on. The core set never changes, so a conversation that never loads
 * anything sends the same tools every step, and the provider's cache keeps hitting.
 */
import type { Message, ToolDefinition } from "./types.ts";

export const LOAD_TOOLS_NAME = "load_tools";

/**
 * Sent only on request. Chosen from the chat's real tool list by size and by how rarely a coding
 * turn needs them: the forks and team tools, browser control and page checks, connectors,
 * memory, project checks, helpers. Reading, searching, editing, running, the plan, questions,
 * previews, ADCode's own feature tools, MCP and skills stay in every request.
 */
export const DEFERRED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "view_page",
  "audit_page",
  "adcode_connectors",
  "adcode_browser",
  "adcode_room",
  "adcode_chats",
  "delegate_task",
  "fork_chats",
  "send_chat_message",
  "read_chat_messages",
  "wait_for_chat_forks",
  "list_chat_forks",
  "stop_chat",
  "run_project_checks",
  "inspect_project",
  "memory_search",
  "memory_write",
  "project_context",
  "load_builtin_skill",
  "move_file",
  "create_agent",
]);

/**
 * A catalogue entry: the description's first clause, cut at a word near 64 characters. The
 * name says most of it; the clause is there to tell two similar tools apart.
 */
export function summary(description: string): string {
  const first = (description.split(/(?<=[.!?])\s/)[0] ?? description).split(/[:;]\s|\s[-–]\s|\s\(/)[0]!.replace(/\.$/, "");
  if (first.length <= 64) return first;
  const cut = first.slice(0, 64);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 40)).trimEnd()}...`;
}

/** The catalogue tool: every deferred tool not yet loaded, one line each. */
export function loadToolsDefinition(waiting: readonly ToolDefinition[]): ToolDefinition {
  return {
    name: LOAD_TOOLS_NAME,
    description: [
      "Load these tools by name before using them; they then stay loaded:",
      ...waiting.map((tool) => `${tool.name}: ${summary(tool.description)}`),
    ].join("\n"),
    mutating: false,
    inputSchema: {
      type: "object",
      properties: { names: { type: "array", items: { type: "string" }, description: "Tool names from the list" } },
      required: ["names"],
    },
  };
}

/** The tools to send this step: everything not deferred, the deferred tools already loaded, and the catalogue for the rest. */
export function offeredTools(tools: readonly ToolDefinition[], deferred: ReadonlySet<string>, loaded: ReadonlySet<string>): ToolDefinition[] {
  if (deferred.size === 0) return [...tools];
  const sent = tools.filter((tool) => !deferred.has(tool.name) || loaded.has(tool.name));
  const waiting = tools.filter((tool) => deferred.has(tool.name) && !loaded.has(tool.name));
  return waiting.length === 0 ? sent : [...sent, loadToolsDefinition(waiting)];
}

/** Handle a `load_tools` call: which names it loads, and what the model is told. */
export function loadTools(input: Record<string, unknown>, tools: readonly ToolDefinition[], deferred: ReadonlySet<string>, loaded: Set<string>): { content: string; isError: boolean } {
  const asked = Array.isArray(input["names"]) ? input["names"].filter((name): name is string => typeof name === "string") : [];
  const known = asked.filter((name) => deferred.has(name) && tools.some((tool) => tool.name === name));
  const unknown = asked.filter((name) => !known.includes(name) && !tools.some((tool) => tool.name === name && !deferred.has(name)));
  for (const name of known) loaded.add(name);
  if (known.length === 0) {
    return { content: unknown.length > 0 ? `No loadable tool named ${unknown.join(", ")}. Choose names from load_tools' list.` : "Name the tools to load.", isError: true };
  }
  return { content: `Loaded ${known.join(", ")}. Call them now.${unknown.length > 0 ? ` Not found: ${unknown.join(", ")}.` : ""}`, isError: false };
}

/** The deferred tools a restored conversation had already loaded or used. */
export function loadedFromHistory(messages: readonly Message[], deferred: ReadonlySet<string>): Set<string> {
  const loaded = new Set<string>();
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type !== "tool-call") continue;
      if (deferred.has(block.name)) loaded.add(block.name);
      if (block.name === LOAD_TOOLS_NAME && Array.isArray(block.input["names"])) {
        for (const name of block.input["names"]) if (typeof name === "string" && deferred.has(name)) loaded.add(name);
      }
    }
  }
  return loaded;
}

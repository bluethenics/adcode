/**
 * The Tools page as data. Pure - no DOM, no IPC.
 *
 * "Agents are who, tools are what": this is where the page works out which agents may use a
 * tool, and turns a server's raw error into a sentence that says what to do next.
 */
import { filterToolsByAccess } from "@adcode/ai/toolAccess";
import type { AssistantServerView } from "../../shared/assistantControls.ts";
import type { AgentProfile } from "../ai/agentProfiles.ts";
import { AGENT_PICKABLE_TOOLS } from "./builtInTools.ts";

const PICKABLE = new Set(AGENT_PICKABLE_TOOLS.map((tool) => tool.name));

/**
 * Who may use a built-in tool: the chat always does; a saved agent does when its tool access
 * allows it. Memory tools only ever run in the chat - board runs are built without them.
 */
export function toolUsers(toolName: string, agents: readonly AgentProfile[]): string[] {
  if (!PICKABLE.has(toolName)) return ["Chat"];
  return ["Chat", ...agents.filter((agent) => filterToolsByAccess([{ name: toolName }], agent.toolAccess ?? "all").tools.length > 0).map((agent) => agent.name)];
}

/** A server's last error as one sentence that says what to do, or null when it has none. */
export function explainMcpError(error: string | null): string | null {
  if (error === null || error.trim() === "") return null;
  const missing = /spawn (\S+) ENOENT/i.exec(error);
  if (missing !== null) {
    const program = missing[1]!.replace(/\.(cmd|exe)$/i, "");
    return program === "npx" || program === "node"
      ? `Couldn't start: ${program} wasn't found. Install Node.js from nodejs.org, then press Retry.`
      : `Couldn't start: ${program} wasn't found. Install it, then press Retry.`;
  }
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden/i.test(error)) {
    return "The server refused the sign-in. Sign in with its own app or CLI as its instructions say, then press Retry.";
  }
  if (/ECONNREFUSED|connection refused/i.test(error)) {
    return "Nothing is answering at that address. Start the server (or its desktop app), then press Retry.";
  }
  if (/timed? ?out|ETIMEDOUT/i.test(error)) {
    return "The server took too long to answer. Check it is running, then press Retry.";
  }
  return (error.split(/\r?\n/)[0] ?? error).trim().slice(0, 200);
}

export function serverSummary(tools: AssistantServerView["tools"]): string {
  if (tools.length === 0) return "No tools yet";
  const uses = tools.reduce((sum, tool) => sum + tool.calls, 0);
  return `${tools.length} tool${tools.length === 1 ? "" : "s"} · ${uses} use${uses === 1 ? "" : "s"}`;
}

export function matchesQuery(query: string, fields: readonly string[]): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || fields.some((field) => field.toLowerCase().includes(needle));
}

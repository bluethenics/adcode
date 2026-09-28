/**
 * Which tools an agent may use.
 *
 * A saved agent's access travels with its role into a run, and the main process filters the
 * tools the agent is built with before it can call any of them. The filter only removes: an
 * access value can never give an agent a tool it does not name. Pure; no I/O.
 */

/** Every tool, only the tools that look without touching, or exactly these tools. */
export type ToolAccess = "all" | "read-only" | readonly string[];

/** Tools that read the project and change nothing - no edits, commands, fetches or memory writes. */
export const READ_ONLY_TOOL_NAMES: readonly string[] = [
  "read_file",
  "list_files",
  "search",
  "glob_files",
  "get_outline",
  "project_context",
];

const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_NAMED_TOOLS = 64;

/** A tool access from settings or IPC, or null when it is not one of the three shapes. */
export function parseToolAccess(value: unknown): ToolAccess | null {
  if (value === "all" || value === "read-only") return value;
  if (!Array.isArray(value) || value.length > MAX_NAMED_TOOLS) return null;
  if (!value.every((name) => typeof name === "string" && TOOL_NAME.test(name))) return null;
  return [...new Set(value as string[])];
}

/** Keep the tools an access allows, in their original order; name the ones it asked for that do not exist. */
export function filterToolsByAccess<T extends { readonly name: string }>(
  tools: readonly T[],
  access: ToolAccess,
): { tools: T[]; unknown: string[] } {
  if (access === "all") return { tools: [...tools], unknown: [] };
  const allowed = new Set(access === "read-only" ? READ_ONLY_TOOL_NAMES : access);
  const known = new Set(tools.map((tool) => tool.name));
  return {
    tools: tools.filter((tool) => allowed.has(tool.name)),
    unknown: access === "read-only" ? [] : access.filter((name) => !known.has(name)),
  };
}

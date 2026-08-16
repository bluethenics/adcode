/**
 * The IDE's side of the shared memory.
 *
 * The built-in chat will read and write this store in-process; external agents reach the
 * same directory through the standalone `adcode-mcp` binary. Both are looking at the
 * same markdown files, which is exactly why §5.1 made markdown the source of truth.
 *
 * §5.2 puts the MCP server in the main process. It is not here, and the reason is in
 * `bin/adcode-mcp.ts`: stdio transport spawns a command and cannot attach to a running
 * process, so an in-process server would be unreachable by the agents it exists to
 * serve - and would die whenever the user closed the window.
 */
import { join } from "node:path";
import { app } from "electron";
import { MEMORY_DIRECTORY, openNodeMemory, type NodeMemory } from "@adcode/memory";
import type { McpConnectionInfo } from "../shared/api.ts";
import { currentWorkspace } from "./workspace.ts";

let opened: { root: string; memory: NodeMemory } | null = null;

/** The memory for the currently open workspace, or null when no folder is open. */
export function memoryForWorkspace(): NodeMemory | null {
  const workspace = currentWorkspace();
  if (workspace === null) return null;

  if (opened !== null && opened.root === workspace.root) return opened.memory;

  opened?.memory.close();
  opened = { root: workspace.root, memory: openNodeMemory(workspace.root) };
  return opened.memory;
}

export function closeMemory(): void {
  opened?.memory.close();
  opened = null;
}

/**
 * Locate the standalone MCP binary.
 *
 * In development it is the TypeScript source, which Node 24 runs directly. Packaging has
 * to place it somewhere equivalent under resources; until the packaging slice exists,
 * the development path is the honest answer rather than a guess at a layout that has not
 * been built yet.
 */
function binaryPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, "mcp", "adcode-mcp.js");
  }
  return join(app.getAppPath(), "..", "..", "packages", "memory", "bin", "adcode-mcp.ts");
}

export function mcpConnection(): McpConnectionInfo {
  const workspace = currentWorkspace();

  if (workspace === null) {
    return {
      command: "Open a folder first - project memory is per-workspace.",
      storePath: null,
      available: false,
    };
  }

  // The `--` matters: without it, Claude Code parses the following arguments as its own.
  const command = `claude mcp add adcode -- node "${binaryPath()}" "${workspace.root}"`;

  return {
    command,
    storePath: join(workspace.root, MEMORY_DIRECTORY),
    available: true,
  };
}

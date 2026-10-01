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
import { homedir } from "node:os";
import { join } from "node:path";
import { app } from "electron";
import { MEMORY_DIRECTORY, openNodeMemory, type NodeMemory } from "@adcode/memory";
import type { McpConnectionInfo, MemoryItemView, MemoryWriteInputView } from "../shared/api.ts";
import { recordDebug } from "./debugLog.ts";
import { mcpScriptPath, refreshMcpBundle, SHIPPED_MCP, stableMcpDirectory } from "./mcpInstall.ts";
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

/** Where packaging ships the bundled server. Only meaningful when `app.isPackaged`. */
const shippedMcp = (): string => join(process.resourcesPath, SHIPPED_MCP.resourceDir);

/**
 * Locate the standalone MCP binary.
 *
 * In development it is the TypeScript source, which Node 24 runs directly. An installed
 * build has no `packages/`, so `scripts/build-mcp.mjs` bundles that source into one file
 * and `extraResources` in electron-builder.yml ships it beside the asar - outside it,
 * because the process that runs this path is the user's `node`, not Electron.
 *
 * The command does not name that shipped file, though: the portable build, an AppImage and
 * the Store package all lose `process.resourcesPath` once the app closes or updates, while
 * the agent goes on running whatever `claude mcp add` recorded. It names a copy in the
 * user's home instead - see `mcpInstall.ts`.
 */
async function binaryPath(): Promise<string> {
  if (app.isPackaged) {
    return mcpScriptPath(shippedMcp(), stableMcpDirectory(homedir()), (error) =>
      recordDebug("warn", "mcp", `Could not copy the MCP server out of the app: ${String(error)}`),
    );
  }
  return join(app.getAppPath(), "..", "..", "packages", "memory", "bin", "adcode-mcp.ts");
}

/**
 * At startup, bring a copy handed out by an earlier version up to date. Creates nothing for
 * somebody who never asked for the command, and never throws: it is not on any path a
 * window waits for.
 */
export async function refreshMcpServer(): Promise<void> {
  if (!app.isPackaged) return;
  try {
    const refreshed = await refreshMcpBundle(shippedMcp(), stableMcpDirectory(homedir()));
    if (refreshed !== null && refreshed.copied.length > 0) {
      recordDebug("info", "mcp", `Updated the MCP server copy: ${refreshed.copied.join(", ")}`);
    }
  } catch (error) {
    recordDebug("warn", "mcp", `Could not update the MCP server copy: ${String(error)}`);
  }
}

export async function mcpConnection(): Promise<McpConnectionInfo> {
  const workspace = currentWorkspace();

  if (workspace === null) {
    return {
      command: "Open a folder first - project memory is per-workspace.",
      storePath: null,
      available: false,
    };
  }

  // The `--` matters: without it, Claude Code parses the following arguments as its own.
  const command = `claude mcp add adcode -- node "${await binaryPath()}" "${workspace.root}"`;

  return {
    command,
    storePath: join(workspace.root, MEMORY_DIRECTORY),
    available: true,
  };
}

/** Every memory for the open project, newest first, for the Tools page. */
export async function memoryList(): Promise<MemoryItemView[]> {
  const memory = memoryForWorkspace();
  if (memory === null) return [];
  const records = await memory.store.all();
  return records
    .map((record) => ({ ...record, agents: [...record.agents] }))
    .sort((a, b) => b.created.localeCompare(a.created) || a.name.localeCompare(b.name));
}

/** Create or replace a memory by hand. The input is already validated (memoryIpcValidation.ts). */
export async function memoryWrite(input: MemoryWriteInputView): Promise<MemoryItemView | null> {
  const memory = memoryForWorkspace();
  if (memory === null) return null;
  const written = await memory.store.write({ ...input, agent: "you" });
  if (written === null) return null;
  // Search reads the index, so an edit made here must be findable by the assistant at once.
  await memory.reindex();
  return { ...written, agents: [...written.agents] };
}

export async function memoryRemove(name: string): Promise<boolean> {
  const memory = memoryForWorkspace();
  if (memory === null) return false;
  const removed = await memory.store.delete(name);
  if (removed) await memory.reindex();
  return removed;
}

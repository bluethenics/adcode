#!/usr/bin/env node
/**
 * The standalone MCP server binary.
 *
 * This exists because of a real gap in brief §5.2. It puts the MCP server in the
 * Electron main process and expects Claude Code to connect to it - but stdio transport
 * *spawns* a command; it cannot attach to a process that is already running. An IDE that
 * had to be open for an agent to reach the memory would also fail the moment the user
 * closed it.
 *
 * A separate binary works only because §5.1 made markdown the source of truth and SQLite
 * a rebuildable cache. Nothing here shares process state with the IDE: both sides read
 * and write the same directory, and the index is rebuilt from the files.
 *
 * Usage, from a workspace:
 *   claude mcp add adcode -- node <repo>/packages/memory/bin/adcode-mcp.ts <workspace>
 *
 * Node 24 runs this TypeScript directly, so there is no build step to keep in sync.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMemoryMcpServer } from "../src/mcp.ts";
import { openNodeMemory } from "../src/nodeStore.ts";

const workspaceRoot = process.argv[2] ?? process.cwd();

const memory = openNodeMemory(workspaceRoot);

// Index from the markdown before serving a single request. It is a cache, so this is
// always safe and always correct, however the files got there - hand-edited, merged by
// git, or written by another agent while this process was not running.
await memory.reindex();

const server = createMemoryMcpServer({
  store: memory.store,
  index: memory.index,
  reindex: () => memory.reindex(),
});

// stdout carries the protocol. Anything written there that is not a JSON-RPC frame
// corrupts the stream, so diagnostics go to stderr - including Node's own experimental
// warning for `node:sqlite`, which is already sent there.
await server.connect(new StdioServerTransport());

const shutdown = (): void => {
  memory.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

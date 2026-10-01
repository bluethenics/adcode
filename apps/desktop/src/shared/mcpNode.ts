/**
 * The Node.js an external agent needs to start ADCode's MCP server.
 *
 * "Connect an external agent" hands out `node "<path>/adcode-mcp.js" "<workspace>"`, and
 * the `node` in it is the user's own, found on their agent's PATH. It cannot be ADCode:
 * `electronFuses.runAsNode` is off in electron-builder.yml, so the packaged executable will
 * not act as a Node runtime and there is no bundled one to fall back to.
 *
 * The floor is set by `node:sqlite`, which the server's index uses. Older than that and
 * `claude mcp add` still succeeds - it only records a command - and the server then dies on
 * start inside the agent, which reports little more than "failed". So every place that
 * shows the command states the requirement, and on Windows ADCode looks for a `node` that
 * is missing or too old (`main/memory.ts`).
 *
 * Shared because main runs `node --version` and the renderer says what it found. The help
 * entry and the web guide state the same version as literal text, and
 * `apps/desktop/test/mcpNode.test.ts` holds them to `MCP_NODE_MINIMUM`.
 */

/** As people write it. 23.4 is also a floor, but 23 is out of support and nobody asks for it. */
export const MCP_NODE_MINIMUM = "22.13";

/** The standing requirement, for every place the command is shown. */
export const MCP_NODE_REQUIREMENT = `Your agent starts the server with the Node.js installed on your computer, not with ADCode, so you need Node.js ${MCP_NODE_MINIMUM} or newer. Run node --version in a terminal to check.`;

/**
 * What ADCode found out about the `node` an agent will use.
 *
 * `unknown` covers both "did not look" and "looked and could not tell"; either way there is
 * nothing to say beyond the standing requirement.
 */
export type McpNodeCheck =
  | { readonly status: "ok" | "old"; readonly version: string }
  | { readonly status: "missing" | "unknown" };

/**
 * Whether a `node --version` string can run the server, or null when it is not a version.
 *
 * Not one comparison: `node:sqlite` needs no flag from 22.13 and from 23.4, so 23.0-23.3
 * are newer than 22.13 and still cannot load it.
 */
export function nodeRunsMcpServer(version: string): boolean | null {
  const match = /^v?(\d+)\.(\d+)\.\d+/.exec(version.trim());
  if (match === null) return null;

  const major = Number(match[1]);
  const minor = Number(match[2]);

  if (major >= 24) return true;
  if (major === 23) return minor >= 4;
  if (major === 22) return minor >= 13;
  return false;
}

/** From what `node --version` printed - or null when there was no `node` to run - to a check. */
export function classifyNode(output: string | null): McpNodeCheck {
  if (output === null) return { status: "missing" };

  const version = output.trim();
  const runs = nodeRunsMcpServer(version);
  if (runs === null) return { status: "unknown" };

  return { status: runs ? "ok" : "old", version };
}

/** What to tell the user about this check, or null when there is nothing to add. */
export function mcpNodeNote(check: McpNodeCheck): string | null {
  switch (check.status) {
    case "missing":
      // ADCode's PATH is fixed when it starts, so an install made since only shows up after
      // a restart. Saying so stops the note reading as wrong to someone who just fixed it.
      return `ADCode couldn't find Node.js, which your agent needs to start the server. Install Node.js ${MCP_NODE_MINIMUM} or newer from nodejs.org, then run the command in a new terminal. ADCode notices after a restart.`;
    case "old":
      return `The Node.js on this computer is ${check.version}, too old to start the server. Install Node.js ${MCP_NODE_MINIMUM} or newer from nodejs.org, then run the command in a new terminal.`;
    case "ok":
    case "unknown":
      return null;
  }
}

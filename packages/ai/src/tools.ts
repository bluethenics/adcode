/**
 * The tool surface the built-in agent is given.
 *
 * Definitions only - pure data. The implementations live in the main process, because
 * they touch the filesystem and the memory store, and because §5.3 requires every
 * mutating result to pass through the inline diff widget rather than reaching disk
 * directly: "Nothing is ever written to disk unseen."
 *
 * The set is deliberately small. Brief §5.2 says of the MCP tools "expose exactly these
 * tools, and resist adding more", and the same reasoning applies here - every extra tool
 * is another thing the model has to choose between, and choosing badly is the common
 * failure mode.
 */
import type { ToolDefinition } from "./types.ts";

const path = (description: string) => ({
  type: "string",
  description,
});

export const READ_FILE: ToolDefinition = {
  name: "read_file",
  description:
    "Read a file from the open workspace. Prefer reading the code over asking the user about it. Returns the file's text with line numbers.",
  inputSchema: {
    type: "object",
    properties: { path: path("Workspace-relative path, e.g. src/main.ts") },
    required: ["path"],
  },
  mutating: false,
};

export const LIST_FILES: ToolDefinition = {
  name: "list_files",
  description:
    "List the files and directories under a workspace path. Use this to orient yourself before reading.",
  inputSchema: {
    type: "object",
    properties: { path: path("Workspace-relative directory, or omit for the root") },
  },
  mutating: false,
};

export const SEARCH: ToolDefinition = {
  name: "search",
  description:
    "Search the workspace for a regular expression and return matching lines with their paths. Faster than reading files one by one when you do not yet know where something lives.",
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "A regular expression" },
      path: path("Optional workspace-relative directory to search within"),
    },
    required: ["pattern"],
  },
  mutating: false,
};

export const PROPOSE_EDIT: ToolDefinition = {
  name: "propose_edit",
  description:
    "Propose a change to a file. The change is shown to the user as a reviewable diff and is NOT written to disk until they accept it, hunk by hunk. Send the file's complete new contents, not a patch.",
  inputSchema: {
    type: "object",
    properties: {
      path: path("Workspace-relative path of the file to change"),
      contents: { type: "string", description: "The file's complete proposed contents" },
      summary: { type: "string", description: "One line describing what this change does" },
    },
    required: ["path", "contents", "summary"],
  },
  mutating: true,
};

/* ── Memory (§5.1) ──────────────────────────────────────────────────────── */

export const MEMORY_SEARCH: ToolDefinition = {
  name: "memory_search",
  description:
    "Search this project's shared memory - decisions, conventions, preferences, and what other agents did. Check here before re-deriving something the project already knows.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Free text to search for" },
      kind: { type: "string", enum: ["decision", "convention", "preference", "session"] },
    },
    required: ["query"],
  },
  mutating: false,
};

export const MEMORY_WRITE: ToolDefinition = {
  name: "memory_write",
  description:
    "Record one fact worth keeping: an architecture decision, a convention, a preference, or a gotcha. One fact per memory. Do not record what the code or git history already says.",
  inputSchema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Short kebab-case identifier, e.g. chose-electron" },
      description: { type: "string", description: "One line summarising the fact" },
      type: { type: "string", enum: ["decision", "convention", "preference"] },
      body: { type: "string", description: "The fact itself, in markdown" },
    },
    required: ["name", "description", "type", "body"],
  },
  mutating: false,
};

export const PROJECT_CONTEXT: ToolDefinition = {
  name: "project_context",
  description:
    "The digest of what this project already knows. Worth reading first on an unfamiliar task.",
  inputSchema: { type: "object", properties: {} },
  mutating: false,
};

export const BUILT_IN_TOOLS: readonly ToolDefinition[] = [
  READ_FILE,
  LIST_FILES,
  SEARCH,
  PROPOSE_EDIT,
  PROJECT_CONTEXT,
  MEMORY_SEARCH,
  MEMORY_WRITE,
];

/** The tools available when memory capture is switched off (§4). */
export const TOOLS_WITHOUT_MEMORY: readonly ToolDefinition[] = [
  READ_FILE,
  LIST_FILES,
  SEARCH,
  PROPOSE_EDIT,
];

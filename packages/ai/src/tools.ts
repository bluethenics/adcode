/**
 * The tool surface the built-in agent is given.
 *
 * Definitions only - pure data. The implementations live in the main process, because
 * they touch the filesystem and the memory store, and because §5.3 requires every
 * mutating result to pass through an isolated task workspace and the inline diff widget
 * rather than reaching the human project directly.
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

const optionalPath = (description: string) => ({
  type: "string",
  description,
});

const ROOT_ALIASES = "Omit path, or pass an empty string, '.', or '/', for the workspace root.";

export const READ_FILE: ToolDefinition = {
  name: "read_file",
  description:
    "Read a file from the open workspace. Prefer reading the code over asking the user about it. Returns the file's text with line numbers. Use offset and limit to page through large files.",
  inputSchema: {
    type: "object",
    properties: {
      path: path("Workspace-relative path, e.g. src/main.ts"),
      offset: { type: "integer", minimum: 1, description: "First line to return (1-based). Omit to start at the top." },
      limit: { type: "integer", minimum: 1, maximum: 2000, description: "Most lines to return. Omit for the whole file." },
    },
    required: ["path"],
  },
  mutating: false,
  concurrent: true,
};

export const LIST_FILES: ToolDefinition = {
  name: "list_files",
  description:
    `List the files and directories under a workspace path. Use this to orient yourself before reading. ${ROOT_ALIASES} Pass recursive true to list everything below it (for example, to find all images).`,
  inputSchema: {
    type: "object",
    properties: {
      path: optionalPath(`Workspace-relative directory. ${ROOT_ALIASES}`),
      recursive: { type: "boolean", description: "List files in subdirectories too. Omit for one level." },
    },
  },
  mutating: false,
  concurrent: true,
};

export const SEARCH: ToolDefinition = {
  name: "search",
  description:
    `Search the workspace for a regular expression and return matching lines with their paths. Faster than reading files one by one when you do not yet know where something lives. ${ROOT_ALIASES}`,
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "A regular expression" },
      path: optionalPath(`Optional workspace-relative directory to search within. ${ROOT_ALIASES}`),
      include: { type: "string", description: "Optional glob to narrow files, e.g. **/*.{ts,tsx} or **/*.png" },
    },
    required: ["pattern"],
  },
  mutating: false,
  concurrent: true,
};

export const PROPOSE_EDIT: ToolDefinition = {
  name: "propose_edit",
  description:
    "Write a proposed complete file into the isolated task workspace. The human project is unchanged until the user reviews and accepts hunks. Send the file's complete new contents, not a patch. Parent directories are created as needed. Use this to create new files or rewrite small ones; to change part of an existing file, use edit_file instead.",
  inputSchema: {
    type: "object",
    properties: {
      path: path("Workspace-relative path of the file to change"),
      contents: { type: "string", description: "The file's complete proposed contents" },
      summary: { type: "string", description: "One line describing what this change does" },
    },
    required: ["path", "contents"],
  },
  mutating: true,
};

const replacement = {
  old_string: { type: "string", description: "Exact text to find, copied from read_file output without the line-number gutter. Include enough surrounding lines to make it unique." },
  new_string: { type: "string", description: "Text to put in its place. Must differ from old_string." },
  replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring exactly one. Omit for a single, unique match." },
};

export const EDIT_FILE: ToolDefinition = {
  name: "edit_file",
  description:
    "Change part of an existing file by exact text replacement, staged in the isolated task workspace for the user's review exactly like propose_edit. Prefer this over propose_edit for any change to an existing file: it sends only what changes, so it is faster, cheaper, and cannot drop the rest of the file. old_string must match the file exactly, including indentation, and be unique unless replace_all is true. Pass several replacements for one file at once with edits; they apply in order and all must succeed. An empty old_string creates the file when it does not exist yet.",
  inputSchema: {
    type: "object",
    properties: {
      path: path("Workspace-relative path of the file to change"),
      ...replacement,
      edits: {
        type: "array",
        description: "Several replacements for this file, applied in order. Use instead of old_string/new_string.",
        items: { type: "object", properties: replacement, required: ["old_string", "new_string"] },
      },
      summary: { type: "string", description: "One line describing what this change does" },
    },
    required: ["path"],
  },
  mutating: true,
};

/* ── Unfair-advantage tools (still sandboxed, still review-first) ────────── */

export const GLOB_FILES: ToolDefinition = {
  name: "glob_files",
  description:
    `Find files by glob pattern, e.g. **/*.png to list every image, or src/**/*.{ts,tsx}. ${ROOT_ALIASES} Prefer this over list_files when you know the shape of what you want.`,
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "Glob with * (any run), ** (any depth), ? (one char), and {a,b} groups" },
      path: optionalPath(`Optional workspace-relative directory to search under. ${ROOT_ALIASES}`),
    },
    required: ["pattern"],
  },
  mutating: false,
  concurrent: true,
};

export const GET_OUTLINE: ToolDefinition = {
  name: "get_outline",
  description:
    "List the symbols in one file - functions, classes, interfaces, types, enums, arrow-function values, Python defs, Markdown headings - with line numbers. Skim this before reading a long file.",
  inputSchema: {
    type: "object",
    properties: { path: path("Workspace-relative file to outline") },
    required: ["path"],
  },
  mutating: false,
  concurrent: true,
};

export const RUN_COMMAND: ToolDefinition = {
  name: "run_command",
  description:
    "Run a non-interactive command inside the isolated task workspace (tests, typecheck, lint, build) and return its output. File effects land in the sandbox, never the human project, and proposals still need review. Prefer this over describing what the user should run.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Shell line to run, e.g. npm test -- --runInBand" },
      cwd: optionalPath(`Optional workspace-relative directory to run in. ${ROOT_ALIASES}`),
    },
    required: ["command"],
  },
  mutating: true,
};

export const FETCH_URL: ToolDefinition = {
  name: "fetch_url",
  description:
    "Fetch an https URL (or a local loopback http URL) and return its text, truncated past 24,000 characters. Use for docs and API references. Never fetch credentials or private hosts.",
  inputSchema: {
    type: "object",
    properties: { url: { type: "string", description: "The https URL to fetch" } },
    required: ["url"],
  },
  mutating: false,
  concurrent: true,
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
  concurrent: true,
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
  concurrent: true,
};

export const BUILT_IN_TOOLS: readonly ToolDefinition[] = [
  READ_FILE,
  LIST_FILES,
  SEARCH,
  GLOB_FILES,
  GET_OUTLINE,
  EDIT_FILE,
  PROPOSE_EDIT,
  RUN_COMMAND,
  FETCH_URL,
  PROJECT_CONTEXT,
  MEMORY_SEARCH,
  MEMORY_WRITE,
];

/** The tools available when memory capture is switched off (§4). */
export const TOOLS_WITHOUT_MEMORY: readonly ToolDefinition[] = [
  READ_FILE,
  LIST_FILES,
  SEARCH,
  GLOB_FILES,
  GET_OUTLINE,
  EDIT_FILE,
  PROPOSE_EDIT,
  RUN_COMMAND,
  FETCH_URL,
];

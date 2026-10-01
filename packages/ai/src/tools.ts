/**
 * The tool surface the built-in agent is given.
 *
 * Definitions only - pure data. The implementations live in the main process, because
 * they touch the filesystem, the memory store and the browser.
 *
 * The descriptions say what a tool does, never where its writes land: the assistant edits
 * the live project while a Team role edits an isolated copy, and one shared definition
 * that claimed either would be wrong for the other. Each agent's own instructions state
 * which it is. (They used to say "isolated, awaits review" while the assistant's host
 * context said "applies directly" - a contradiction weaker models visibly stumbled on.)
 *
 * Every tool earns its place by closing a gap a model otherwise fills with a guess or a
 * workaround: without `view_page` it claims a page works without having seen it, without
 * `delete_file` it shells out to `rm` (which no Undo can reverse), without background
 * commands it cannot start a dev server and look at it. Each extra tool is still another
 * thing the model has to choose between, so the descriptions say when to reach for it.
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
    "Read a file from the open workspace. Prefer reading the code over asking the user about it. Returns the file's text with line numbers; use offset and limit to page through large files. An image file (png, jpg, gif, webp) comes back as the picture itself, so you can look at a mockup or a screenshot in the project.",
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
    `Search the workspace's files and return matching lines with their paths and line numbers. Faster than reading files one by one when you do not yet know where something lives. The pattern is a regular expression unless literal is true; matching ignores case unless case_sensitive is true. ${ROOT_ALIASES}`,
  inputSchema: {
    type: "object",
    properties: {
      pattern: { type: "string", description: "A regular expression, or plain text with literal: true" },
      path: optionalPath(`Optional workspace-relative directory to search within. ${ROOT_ALIASES}`),
      include: { type: "string", description: "Optional glob to narrow files, e.g. **/*.{ts,tsx} or **/*.css" },
      literal: { type: "boolean", description: "Match the pattern as plain text - no need to escape ( . [ and friends." },
      case_sensitive: { type: "boolean", description: "Match upper and lower case exactly. Omit to ignore case." },
      context: { type: "integer", minimum: 0, maximum: 5, description: "Lines to show before and after each match. Omit for none." },
      files_only: { type: "boolean", description: "Return only the paths of files that match, one per line." },
      max_results: { type: "integer", minimum: 1, maximum: 300, description: "Most matches to return (default 80)." },
    },
    required: ["pattern"],
  },
  mutating: false,
  concurrent: true,
};

export const PROPOSE_EDIT: ToolDefinition = {
  name: "propose_edit",
  description:
    "Write a complete file: create a new one or rewrite a short one. Send the whole new contents, not a patch; parent directories are created as needed. To change part of an existing file, use edit_file instead.",
  inputSchema: {
    type: "object",
    properties: {
      path: path("Workspace-relative path of the file to change"),
      contents: { type: "string", description: "The file's complete new contents" },
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
    "Change part of an existing file by exact text replacement - prefer this to propose_edit for any existing file: it sends only what changes, so it is faster and cannot drop the rest of the file. old_string must match the file, and be unique unless replace_all is true; when it differs only in indentation or trailing spaces, the one block that matches line by line is used and the result says so. For several changes to one file, pass edits; they apply in order and all must succeed.",
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

export const MOVE_FILE: ToolDefinition = {
  name: "move_file",
  description:
    "Move or rename one file inside the workspace. Folders on the way to the destination are created. Refuses to replace an existing file unless overwrite is true. Prefer this to a shell mv or ren: a text file's move is part of the turn's Undo.",
  inputSchema: {
    type: "object",
    properties: {
      from: path("Workspace-relative path of the file to move"),
      to: path("Workspace-relative destination path, including the file name"),
      overwrite: { type: "boolean", description: "Replace a file already at the destination." },
      summary: { type: "string", description: "One line describing why" },
    },
    required: ["from", "to"],
  },
  mutating: true,
};

export const DELETE_FILE: ToolDefinition = {
  name: "delete_file",
  description:
    "Delete one file, or an empty folder, from the workspace. Prefer this to a shell rm or del: deleting a text file is part of the turn's Undo, so the user can put it back.",
  inputSchema: {
    type: "object",
    properties: {
      path: path("Workspace-relative path of the file to delete"),
      summary: { type: "string", description: "One line describing why" },
    },
    required: ["path"],
  },
  mutating: true,
};

/* ── Unfair-advantage tools ────────────────────────────────────────────── */

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

const commandProperties = {
  command: { type: "string", description: "Shell line to run, e.g. npm test -- --runInBand" },
  cwd: optionalPath(`Optional workspace-relative directory to run in. ${ROOT_ALIASES}`),
  timeout_seconds: { type: "integer", minimum: 1, maximum: 600, description: "Stop the command after this long (default 120, at most 600)." },
};

export const RUN_COMMAND: ToolDefinition = {
  name: "run_command",
  description:
    "Run a non-interactive command in the workspace (tests, typecheck, lint, build, installs) and return its exit code and output. Prefer this over telling the user what to run. For something that keeps running - a dev server, a watcher - pass background: true; it returns at once with an id, then command_output reads what it prints and stop_command ends it. A command that is plainly a server (npm run dev, vite, python -m http.server) starts in the background even without it.",
  inputSchema: {
    type: "object",
    properties: {
      ...commandProperties,
      background: { type: "boolean", description: "Start it and return immediately, for servers and watchers that never exit." },
    },
    required: ["command"],
  },
  mutating: true,
};

/** The same command tool without background processes, for agents that work in an isolated copy. */
export const RUN_COMMAND_FOREGROUND: ToolDefinition = {
  ...RUN_COMMAND,
  description:
    "Run a non-interactive command in the workspace (tests, typecheck, lint, build, installs) and return its exit code and output. Prefer this over telling the user what to run. Do not start servers or watchers that never exit.",
  inputSchema: {
    type: "object",
    properties: commandProperties,
    required: ["command"],
  },
};

export const COMMAND_OUTPUT: ToolDefinition = {
  name: "command_output",
  description:
    "Read what a background command started with run_command has printed since you last looked, whether it is still running, and its exit code once it stops. Pass wait_seconds to wait for new output or for it to exit first - useful while a server starts. Omit id to list every background command.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "The id run_command returned, e.g. cmd-1" },
      wait_seconds: { type: "integer", minimum: 0, maximum: 60, description: "Wait up to this long for new output or exit (default 0)." },
    },
  },
  mutating: false,
};

export const STOP_COMMAND: ToolDefinition = {
  name: "stop_command",
  description: "Stop a background command started with run_command, and everything it started.",
  inputSchema: {
    type: "object",
    properties: { id: { type: "string", description: "The id run_command returned, e.g. cmd-1" } },
    required: ["id"],
  },
  mutating: true,
};

export const FETCH_URL: ToolDefinition = {
  name: "fetch_url",
  description:
    "Fetch an https URL (or a local loopback http URL) and return its text, truncated past 24,000 characters. HTML pages come back as readable text with their links; pass raw: true for the exact body. Use for docs and API references. Never fetch credentials or private hosts.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", description: "The https URL to fetch" },
      raw: { type: "boolean", description: "Return the response body exactly as sent, HTML included." },
    },
    required: ["url"],
  },
  mutating: false,
  concurrent: true,
};

/* ── Seeing the running app ─────────────────────────────────────────────── */

export const OPEN_PREVIEW: ToolDefinition = {
  name: "open_preview",
  description:
    "Show the project's live preview - the local server running this web app - in a box in the conversation, so the user sees it. Pass path to open a particular page: about.html, /pricing, /blog/post?id=2#comments. Starts the right server (the framework's dev server, or a static server over the folder) and waits for its address, then returns the page's URL. To look at the page yourself, use view_page. Desktop GUI programs cannot run here.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Page to open, relative to the site root, e.g. about.html or /docs/#install. Omit for the home page." },
    },
    additionalProperties: false,
  },
  mutating: false,
};

const pageAction = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["click", "type", "press", "select", "hover", "scroll", "wait", "eval"], description: "What to do" },
    selector: { type: "string", description: "CSS selector of the element, e.g. #email or button.primary" },
    text: { type: "string", description: "Or: the element's visible text, e.g. Sign up (for click, hover, type)" },
    value: { type: "string", description: "type: the text to enter. select: the option's value or label." },
    submit: { type: "boolean", description: "type: press Enter afterwards" },
    key: { type: "string", description: "press: a key such as Enter, Tab, Escape, ArrowDown" },
    to: { type: "string", enum: ["top", "bottom"], description: "scroll: to the top or bottom of the page (or use selector or y)" },
    y: { type: "integer", description: "scroll: pixels down from the top" },
    ms: { type: "integer", minimum: 0, maximum: 10000, description: "wait: milliseconds, or with selector, the longest to wait for it to appear" },
    expression: { type: "string", description: "eval: a JavaScript expression evaluated in the page; its JSON value is reported" },
  },
  required: ["type"],
};

export const VIEW_PAGE: ToolDefinition = {
  name: "view_page",
  description:
    "Look at a page of the running web app in a real browser and report what a user would see: title, status, the visible text, headings, links, buttons and form fields, broken images, layout overflow, console errors and failed requests - plus a screenshot when you can see images. Use it after changing a page to check it really works before saying so. path opens a page of the live preview (starting it if needed); url opens any local address instead, such as a dev server you started with run_command. width and height set the screen size (390 x 844 for a phone). actions run in order before the report, to click through a flow or fill a form. The browser keeps its page between calls: omit path and url to carry on from where the last call left off.",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Page of the live preview, e.g. index.html, /about or /#pricing" },
      url: { type: "string", description: "Or: a full local address, e.g. http://localhost:5173/settings" },
      width: { type: "integer", minimum: 240, maximum: 3840, description: "Viewport width in CSS pixels (default 1280)" },
      height: { type: "integer", minimum: 240, maximum: 2400, description: "Viewport height in CSS pixels (default 800)" },
      actions: { type: "array", maxItems: 20, description: "Steps to take before the report, in order", items: pageAction },
      screenshot: { type: "boolean", description: "Include a screenshot (default true). Pass false for text only." },
      full_page: { type: "boolean", description: "Screenshot the whole scrolling page rather than the visible part." },
    },
  },
  mutating: false,
};

/* ── Planning ──────────────────────────────────────────────────────────── */

export const UPDATE_PLAN: ToolDefinition = {
  name: "update_plan",
  description:
    "Show the user a short checklist for a task with several steps, and keep it current as you go. Call it once near the start with every step, then again whenever a step starts or finishes, sending the whole list each time. At most one step is in_progress. Skip it for a quick one-step request.",
  inputSchema: {
    type: "object",
    properties: {
      steps: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        description: "The whole plan, in order",
        items: {
          type: "object",
          properties: {
            step: { type: "string", description: "A few words, e.g. Add the pricing section" },
            status: { type: "string", enum: ["pending", "in_progress", "done"] },
          },
          required: ["step", "status"],
        },
      },
    },
    required: ["steps"],
  },
  mutating: false,
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

/** Every tool the chat assistant has. */
export const BUILT_IN_TOOLS: readonly ToolDefinition[] = [
  READ_FILE,
  LIST_FILES,
  SEARCH,
  GLOB_FILES,
  GET_OUTLINE,
  EDIT_FILE,
  PROPOSE_EDIT,
  MOVE_FILE,
  DELETE_FILE,
  RUN_COMMAND,
  COMMAND_OUTPUT,
  STOP_COMMAND,
  OPEN_PREVIEW,
  VIEW_PAGE,
  FETCH_URL,
  UPDATE_PLAN,
  PROJECT_CONTEXT,
  MEMORY_SEARCH,
  MEMORY_WRITE,
];

const MEMORY_TOOL_NAMES: ReadonlySet<string> = new Set([PROJECT_CONTEXT.name, MEMORY_SEARCH.name, MEMORY_WRITE.name]);

/** The chat's tools when memory capture is switched off (§4). */
export const TOOLS_WITHOUT_MEMORY: readonly ToolDefinition[] = BUILT_IN_TOOLS.filter((tool) => !MEMORY_TOOL_NAMES.has(tool.name));

/**
 * What a saved agent or Team role runs with.
 *
 * It works in an isolated copy of the project that is merged when it finishes, so the tools
 * that reach past that copy are left out: the live preview serves the user's real folder, a
 * background process would outlive the run, a deletion or move has no place in the merge,
 * and the plan checklist is drawn in the chat it is not part of.
 */
export const AGENT_RUN_TOOLS: readonly ToolDefinition[] = [
  READ_FILE,
  LIST_FILES,
  SEARCH,
  GLOB_FILES,
  GET_OUTLINE,
  EDIT_FILE,
  PROPOSE_EDIT,
  RUN_COMMAND_FOREGROUND,
  FETCH_URL,
];

/**
 * ADCode's own tools, in plain words: what the agent editor's "Pick tools" list and the Tools
 * page show. Names match `packages/ai/src/tools.ts`; `toolsModel.test.ts` keeps them in step.
 */
export type BuiltInToolGroup = "Read" | "Write" | "Run" | "Preview" | "Plan" | "Web" | "Memory";

export interface BuiltInToolInfo {
  readonly name: string;
  readonly label: string;
  readonly group: BuiltInToolGroup;
  readonly description: string;
  /**
   * Only the chat has it. Saved agents work in an isolated copy that is merged when they
   * finish, so tools reaching past that copy - the live preview, background processes,
   * deletes and moves, the plan card - are not theirs to pick.
   */
  readonly chatOnly?: true;
}

export const BUILT_IN_TOOLS_INFO: readonly BuiltInToolInfo[] = [
  { name: "read_file", label: "Read files", group: "Read", description: "Open a file in the project and read it - or look at an image in it." },
  { name: "list_files", label: "List folders", group: "Read", description: "See what is inside a folder." },
  { name: "search", label: "Search code", group: "Read", description: "Find text anywhere in the project, with the lines around each match." },
  { name: "glob_files", label: "Find files", group: "Read", description: "Find files by a name pattern, such as **/*.css." },
  { name: "get_outline", label: "Outline a file", group: "Read", description: "List a file's functions and classes without reading all of it." },
  { name: "project_context", label: "Project overview", group: "Read", description: "Read the project's summary: languages, layout and conventions." },
  { name: "edit_file", label: "Edit files", group: "Write", description: "Change part of a file in the project." },
  { name: "propose_edit", label: "Write files", group: "Write", description: "Create a file, or rewrite a short one whole." },
  { name: "move_file", label: "Move and rename", group: "Write", description: "Move or rename a file or folder. Undo moves it back.", chatOnly: true },
  { name: "delete_file", label: "Delete files", group: "Write", description: "Delete a file. Undo brings it back.", chatOnly: true },
  { name: "run_command", label: "Run commands", group: "Run", description: "Run terminal commands, such as npm test, in the project folder - or start a dev server in the background." },
  { name: "command_output", label: "Read command output", group: "Run", description: "Read what a background command, such as a dev server, has printed.", chatOnly: true },
  { name: "stop_command", label: "Stop commands", group: "Run", description: "Stop a background command and everything it started.", chatOnly: true },
  { name: "open_preview", label: "Open the preview", group: "Preview", description: "Show your running app - any page of it - in the conversation.", chatOnly: true },
  { name: "view_page", label: "Look at pages", group: "Preview", description: "Load a page in a real browser, click and type through it, and report what shows: text, errors, failed requests and a screenshot.", chatOnly: true },
  { name: "update_plan", label: "Show a plan", group: "Plan", description: "Keep a checklist of the steps of a bigger task in the chat, ticked off as they finish.", chatOnly: true },
  { name: "fetch_url", label: "Fetch web pages", group: "Web", description: "Read a web page or API response, such as documentation, as plain text." },
  { name: "memory_search", label: "Search memory", group: "Memory", description: "Look up decisions and conventions saved for this project." },
  { name: "memory_write", label: "Save to memory", group: "Memory", description: "Record a decision or convention so nobody has to say it twice." },
];

/**
 * The tools a board run is built with (`AGENT_RUN_TOOLS`): no memory tools, no project
 * overview and nothing chat-only - those only run in the main chat. Offering them in the
 * agent editor would promise something the runner never hands over.
 */
export const AGENT_PICKABLE_TOOLS: readonly BuiltInToolInfo[] = BUILT_IN_TOOLS_INFO.filter(
  (tool) => tool.group !== "Memory" && tool.name !== "project_context" && tool.chatOnly !== true,
);

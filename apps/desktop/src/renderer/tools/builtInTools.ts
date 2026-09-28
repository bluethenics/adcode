/**
 * ADCode's own tools, in plain words: what the agent editor's "Pick tools" list and the Tools
 * page show. Names match `packages/ai/src/tools.ts`; `toolsModel.test.ts` keeps them in step.
 */
export type BuiltInToolGroup = "Read" | "Write" | "Run" | "Web" | "Memory";

export interface BuiltInToolInfo {
  readonly name: string;
  readonly label: string;
  readonly group: BuiltInToolGroup;
  readonly description: string;
}

export const BUILT_IN_TOOLS_INFO: readonly BuiltInToolInfo[] = [
  { name: "read_file", label: "Read files", group: "Read", description: "Open a file in the project and read it." },
  { name: "list_files", label: "List folders", group: "Read", description: "See what is inside a folder." },
  { name: "search", label: "Search code", group: "Read", description: "Find text anywhere in the project." },
  { name: "glob_files", label: "Find files", group: "Read", description: "Find files by a name pattern, such as **/*.css." },
  { name: "get_outline", label: "Outline a file", group: "Read", description: "List a file's functions and classes without reading all of it." },
  { name: "project_context", label: "Project overview", group: "Read", description: "Read the project's summary: languages, layout and conventions." },
  { name: "edit_file", label: "Edit files", group: "Write", description: "Change, create or delete files in the project." },
  { name: "propose_edit", label: "Propose edits", group: "Write", description: "Suggest a change for you to review before it lands." },
  { name: "run_command", label: "Run commands", group: "Run", description: "Run terminal commands, such as npm test, in the project folder." },
  { name: "fetch_url", label: "Fetch web pages", group: "Web", description: "Read a web page or API response, such as documentation." },
  { name: "memory_search", label: "Search memory", group: "Memory", description: "Look up decisions and conventions saved for this project." },
  { name: "memory_write", label: "Save to memory", group: "Memory", description: "Record a decision or convention so nobody has to say it twice." },
];

/**
 * The tools a board run is built with (`TOOLS_WITHOUT_MEMORY`): no memory tools and no project
 * overview - those two only run in the main chat. Offering them in the agent editor would
 * promise something the runner never hands over.
 */
export const AGENT_PICKABLE_TOOLS: readonly BuiltInToolInfo[] = BUILT_IN_TOOLS_INFO.filter((tool) => tool.group !== "Memory" && tool.name !== "project_context");

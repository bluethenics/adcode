/**
 * One-click MCP servers for the Tools page.
 *
 * Every entry is checked, not wished for: each package was current (not deprecated) on npm
 * when added, and each works without a credential. That second rule is not a preference -
 * ADCode starts stdio servers with the MCP SDK's default environment, which deliberately
 * passes only a safe subset of variables, so a server that reads a token from the environment
 * would start and then fail. Servers that sign in through their own CLI or desktop app are
 * fine; the note says what to do first. Credentials are never typed into ADCode.
 *
 * Entries go through the same validator as a hand-typed server (`toolsModel.test.ts`).
 */
export interface McpCatalogueEntry {
  readonly id: string;
  readonly name: string;
  /** What it lets the assistant do, in one plain sentence. */
  readonly purpose: string;
  readonly transport: "stdio" | "http";
  readonly endpoint: string;
  readonly args: readonly string[];
  /** Anything to do before it works, or null when adding it is enough. */
  readonly before: string | null;
  readonly homepage: string;
  /**
   * A different command on macOS, for a server that ships inside an app rather than on npm.
   * `endpoint` and `args` above are then the Windows command.
   */
  readonly mac?: { readonly endpoint: string; readonly args: readonly string[] };
  /** The platforms it exists on, when not every one. */
  readonly platforms?: readonly ("win32" | "darwin" | "linux")[];
}

/** The entries for one platform, each with the command that platform runs. */
export function mcpCatalogueFor(platform: string): readonly McpCatalogueEntry[] {
  return MCP_CATALOGUE
    .filter((entry) => entry.platforms === undefined || (entry.platforms as readonly string[]).includes(platform))
    .map((entry) => (platform === "darwin" && entry.mac !== undefined ? { ...entry, endpoint: entry.mac.endpoint, args: entry.mac.args } : entry));
}

export const MCP_CATALOGUE: readonly McpCatalogueEntry[] = [
  {
    // The same connector Plugins > Apps adds; the id is `COMPOSIO_CONNECTOR_ID`.
    id: "composio",
    name: "Composio",
    purpose: "Reach Gmail, Supabase, Cloudflare, GitHub, Slack, Notion and hundreds of other services through one connector, each linked on your own account.",
    transport: "http",
    endpoint: "https://connect.composio.dev/mcp",
    args: [],
    before: "Press Sign in on its card: your browser opens Composio to approve. Each app is then linked the first time you use it.",
    homepage: "https://composio.dev",
  },
  {
    id: "playwright",
    name: "Playwright browser",
    purpose: "Open pages in a real browser, click, type and read what is on screen - so the assistant can check a UI change actually works.",
    transport: "stdio",
    endpoint: "npx",
    args: ["-y", "@playwright/mcp@latest"],
    before: "Needs Node.js. The first start downloads the browser, which takes a minute.",
    homepage: "https://github.com/microsoft/playwright-mcp",
  },
  {
    id: "chrome-devtools",
    name: "Chrome DevTools",
    purpose: "Inspect a running page with Chrome's own DevTools: console errors, network requests and performance traces.",
    transport: "stdio",
    endpoint: "npx",
    args: ["-y", "chrome-devtools-mcp@latest"],
    before: "Needs Node.js and Google Chrome.",
    homepage: "https://github.com/ChromeDevTools/chrome-devtools-mcp",
  },
  {
    id: "context7",
    name: "Context7 docs",
    purpose: "Pull current, version-specific documentation for libraries into the conversation, so answers match the versions you use.",
    transport: "stdio",
    endpoint: "npx",
    args: ["-y", "@upstash/context7-mcp@latest"],
    before: "Needs Node.js.",
    homepage: "https://github.com/upstash/context7",
  },
  {
    id: "sequential-thinking",
    name: "Sequential thinking",
    purpose: "Give the assistant a scratchpad for breaking a hard problem into steps and revising them as it goes.",
    transport: "stdio",
    endpoint: "npx",
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
    before: "Needs Node.js.",
    homepage: "https://github.com/modelcontextprotocol/servers",
  },
  {
    id: "netlify",
    name: "Netlify",
    purpose: "Create, deploy and manage Netlify sites and their settings from the conversation.",
    transport: "stdio",
    endpoint: "npx",
    args: ["-y", "@netlify/mcp"],
    before: "Needs Node.js. Sign in once with the Netlify CLI (npx netlify login) - it uses that sign-in.",
    homepage: "https://docs.netlify.com/welcome/build-with-ai/netlify-mcp-server/",
  },
  {
    id: "figma-dev-mode",
    name: "Figma Dev Mode",
    purpose: "Read the frame you have selected in Figma - layout, styles and variables - so designs turn into code that matches.",
    transport: "http",
    endpoint: "http://127.0.0.1:3845/mcp",
    args: [],
    before: "Open the Figma desktop app and turn on the Dev Mode MCP server in its preferences.",
    homepage: "https://help.figma.com/hc/en-us/articles/32132100833559",
  },
  {
    // The commands are the ones Roblox's own setup page gives every client.
    id: "roblox-studio",
    name: "Roblox Studio",
    purpose: "Read and edit Luau scripts, explore the place's instance tree, run code and playtest in the Roblox Studio you have open.",
    transport: "stdio",
    endpoint: "cmd.exe",
    args: ["/c", "%LOCALAPPDATA%\\Roblox\\mcp.bat"],
    before: "Open Roblox Studio, then Assistant > ... > Manage MCP Servers, and turn on Enable Studio as MCP server.",
    homepage: "https://create.roblox.com/docs/studio/mcp",
    mac: { endpoint: "/Applications/RobloxStudio.app/Contents/MacOS/StudioMCP", args: [] },
    platforms: ["win32", "darwin"],
  },
];

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
}

export const MCP_CATALOGUE: readonly McpCatalogueEntry[] = [
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
];

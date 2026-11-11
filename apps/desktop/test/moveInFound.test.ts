/**
 * What a scan reports and what one Connect press does: the parts of Move in that decide
 * what the person is shown and what happens when they press a button.
 */
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AiProviderInfo, ChatImportEntry } from "../src/shared/api.ts";
import { projectsOf } from "../src/main/chatImport.ts";
import { cliConnectPlan, connectCli } from "../src/renderer/ai/cliConnect.ts";

const entry = (over: Partial<ChatImportEntry>): ChatImportEntry => ({ key: "k", source: "claude-code", sourceName: "Claude Code", title: "t", folder: null, updatedAt: 1, messages: 2, ...over });

describe("the projects a scan found", () => {
  it("lists each folder once, with the tools that worked there, newest first, and whether it still exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "adcode-found-"));
    const shop = join(root, "shop");
    await mkdir(shop);
    const gone = join(root, "deleted-project");
    const projects = await projectsOf([
      entry({ folder: shop, updatedAt: 10 }),
      entry({ folder: shop, source: "codex", sourceName: "Codex", updatedAt: 30 }),
      entry({ folder: shop, updatedAt: 20 }),
      entry({ folder: gone, updatedAt: 99 }),
      entry({ folder: null, updatedAt: 50 }),
    ]);
    expect(projects).toEqual([
      { folder: shop, name: "shop", exists: true, sources: [{ name: "Claude Code", conversations: 2 }, { name: "Codex", conversations: 1 }], conversations: 3, lastUsed: 30 },
      { folder: gone, name: "deleted-project", exists: false, sources: [{ name: "Claude Code", conversations: 1 }], conversations: 1, lastUsed: 99 },
    ]);
  });
});

const cli = (installed: boolean, headless = true): AiProviderInfo => ({
  id: "cli-claude", displayName: "Claude Code (CLI)", hasKey: installed, needsKey: false, transport: "native", doc: null,
  models: [{ id: "default", name: "default", toolCall: true, reasoning: false, recommended: true }],
  cli: { id: "claude", name: "Claude Code", command: "claude", installed, version: null, headless, signIn: "claude", install: "npm install -g @anthropic-ai/claude-code", docs: "" },
} as AiProviderInfo);

describe("one button to connect a coding CLI", () => {
  it("makes an installed CLI the model at once", async () => {
    const plan = cliConnectPlan(cli(true), "tagflow");
    expect(plan).toEqual({ kind: "use", provider: "cli-claude", model: "default", label: "Connect" });
    const written: [string, string][] = [];
    const said = await connectCli(plan, "Claude Code", { write: async (id, value) => { written.push([id, value]); }, runInTerminal: () => { throw new Error("no terminal"); } });
    expect(written).toEqual([["adcode.ai.provider", "cli-claude"], ["adcode.ai.model", "default"]]);
    expect(said).toContain("connected");
  });

  it("says Connected for the one already in use", () => {
    expect(cliConnectPlan(cli(true), "cli-claude").label).toBe("Connected");
  });

  it("installs and then signs in with one terminal command when it is missing", async () => {
    const plan = cliConnectPlan(cli(false), null);
    expect(plan).toEqual({ kind: "terminal", command: "npm install -g @anthropic-ai/claude-code && claude", label: "Connect", then: "install" });
    let ran = "";
    await connectCli(plan, "Claude Code", { write: async () => undefined, runInTerminal: (command) => { ran = command; } });
    expect(ran).toBe("npm install -g @anthropic-ai/claude-code && claude");
  });

  it("opens a terminal-only tool rather than pretending it can be the chat model", () => {
    expect(cliConnectPlan(cli(true, false), null)).toEqual({ kind: "terminal", command: "claude", label: "Open", then: "open" });
  });
});

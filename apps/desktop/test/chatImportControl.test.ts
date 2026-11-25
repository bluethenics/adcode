/**
 * Control over what Move in scans and imports (2.7.0): the scan's choices held to their
 * limits, a chosen folder read for Claude Code and Codex sessions, a preview that shows only
 * the opening, ones already imported marked and left alone on request, and how much of each
 * conversation is kept.
 */
import { mkdtemp, mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ChatImportEntry } from "../src/shared/api.ts";

const paths = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({ app: { getPath: () => paths.userData } }));

import { importChats, previewChatImport, scanChatFolder, scanLimits } from "../src/main/chatImport.ts";
import { batches, DEFAULT_VIEW, filterImports, initialSelection, readPrefs, sourceCounts, writePrefs, DEFAULT_PREFS } from "../src/renderer/onboarding/importFilter.ts";

const NOW = Date.UTC(2026, 10, 26);

function claudeSession(id: string, cwd: string, turns: number): string {
  const lines: string[] = [];
  for (let index = 0; index < turns; index++) {
    lines.push(JSON.stringify({ type: "user", sessionId: id, cwd, timestamp: new Date(NOW - (turns - index) * 60_000).toISOString(), message: { content: `question ${index}` } }));
    lines.push(JSON.stringify({ type: "assistant", sessionId: id, cwd, timestamp: new Date(NOW - (turns - index) * 60_000 + 1_000).toISOString(), message: { content: [{ type: "text", text: `answer ${index}` }] } }));
  }
  return lines.join("\n");
}

function codexSession(id: string, cwd: string): string {
  return [
    JSON.stringify({ type: "session_meta", timestamp: new Date(NOW).toISOString(), payload: { id, cwd } }),
    JSON.stringify({ type: "response_item", timestamp: new Date(NOW).toISOString(), payload: { type: "message", role: "user", content: [{ type: "input_text", text: "fix the build" }] } }),
    JSON.stringify({ type: "response_item", timestamp: new Date(NOW).toISOString(), payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] } }),
  ].join("\n");
}

describe("what a scan reads", () => {
  it("keeps only the tools chosen and holds counts and days to their limits", () => {
    expect(scanLimits({ tools: ["codex"], perTool: 5, sinceDays: 7 }, NOW)).toEqual({ tools: ["codex"], perTool: 10, since: NOW - 7 * 86_400_000, onlyCurrentProject: false });
    expect(scanLimits({ perTool: 99_999 }, NOW).perTool).toBe(1_000);
    expect(scanLimits(undefined, NOW)).toEqual({ tools: ["claude-code", "codex", "opencode"], perTool: 150, since: 0, onlyCurrentProject: false });
    // Unknown tool names from a hostile window are dropped, not trusted.
    expect(scanLimits({ tools: ["codex", "../../etc" as never] }, NOW).tools).toEqual(["codex"]);
  });
});

describe("a folder somebody sent", () => {
  let folder = "";
  let project = "";
  let entries: readonly ChatImportEntry[] = [];
  beforeAll(async () => {
    paths.userData = await mkdtemp(join(tmpdir(), "adcode-import-data-"));
    folder = await mkdtemp(join(tmpdir(), "adcode-import-folder-"));
    project = await mkdtemp(join(tmpdir(), "adcode-import-project-"));
    await mkdir(join(folder, "claude", "proj"), { recursive: true });
    await mkdir(join(folder, "codex", "2026", "11", "25"), { recursive: true });
    await writeFile(join(folder, "claude", "proj", "a.jsonl"), claudeSession("claude-a", project, 40));
    await writeFile(join(folder, "codex", "2026", "11", "25", "rollout-b.jsonl"), codexSession("codex-b", project));
    await writeFile(join(folder, "notes.jsonl"), "not a session\n{\"hello\":1}");
    entries = (await scanChatFolder(folder, project)).entries;
  });

  it("finds Claude Code and Codex sessions anywhere inside it, and skips what is neither", () => {
    expect(entries.map((entry) => entry.sourceName).sort()).toEqual(["Claude Code", "Codex"]);
    expect(entries.every((entry) => entry.imported !== true)).toBe(true);
  });

  it("previews only the opening of a conversation", async () => {
    const claude = entries.find((entry) => entry.source === "claude-code")!;
    const preview = await previewChatImport(claude.key);
    expect(preview?.total).toBe(80);
    expect(preview?.messages).toHaveLength(6);
    expect(preview?.messages[0]).toEqual({ role: "user", text: "question 0" });
  });

  it("keeps the latest messages chosen, marks it imported, and leaves it alone when asked", async () => {
    const claude = entries.find((entry) => entry.source === "claude-code")!;
    const first = await importChats([claude.key], "own-folder", null, { lastMessages: 50 });
    expect(first).toMatchObject({ imported: 1, failed: 0, skipped: 0 });
    const saved = await savedSessions();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.messages).toHaveLength(50);
    expect(saved[0]!.messages.at(-1)?.text).toBe("answer 39");

    const rescanned = (await scanChatFolder(folder, project)).entries.find((entry) => entry.source === "claude-code")!;
    expect(rescanned.imported).toBe(true);
    const again = await importChats([rescanned.key], "own-folder", null, { skipImported: true });
    expect(again).toMatchObject({ imported: 0, skipped: 1 });
    const updated = await importChats([rescanned.key], "own-folder", null, {});
    expect(updated).toMatchObject({ imported: 1, skipped: 0 });
    expect((await savedSessions())[0]!.messages).toHaveLength(80);
  });

  async function savedSessions(): Promise<{ messages: { text: string }[] }[]> {
    const root = join(paths.userData, "ai-sessions");
    const out: { messages: { text: string }[] }[] = [];
    for (const dir of await readdir(root)) for (const name of await readdir(join(root, dir))) if (name.endsWith(".json")) out.push(JSON.parse(await readFile(join(root, dir, name), "utf8")));
    return out;
  }
});

const entry = (over: Partial<ChatImportEntry>): ChatImportEntry => ({ key: "k", source: "claude-code", sourceName: "Claude Code", title: "t", folder: null, updatedAt: 1, messages: 2, ...over });

describe("the import list's controls", () => {
  const list = [
    entry({ key: "a", title: "Fix login bug", folder: "C:/code/shop", updatedAt: 30, messages: 4 }),
    entry({ key: "b", title: "Write tests", source: "codex", sourceName: "Codex", updatedAt: 10, messages: 40, imported: true }),
    entry({ key: "c", title: "Plan the launch", folder: "C:/code/site", updatedAt: 20, messages: 12 }),
  ];

  it("searches titles and folders by every word, any case", () => {
    expect(filterImports(list, { ...DEFAULT_VIEW, query: "SHOP fix" }).map((one) => one.key)).toEqual(["a"]);
    expect(filterImports(list, { ...DEFAULT_VIEW, query: "site" }).map((one) => one.key)).toEqual(["c"]);
  });

  it("narrows by source, hides ones already imported, and sorts every way offered", () => {
    expect(filterImports(list, { ...DEFAULT_VIEW, sources: ["Codex"] }).map((one) => one.key)).toEqual(["b"]);
    expect(filterImports(list, { ...DEFAULT_VIEW, hideImported: true }).map((one) => one.key)).toEqual(["a", "c"]);
    expect(filterImports(list, { ...DEFAULT_VIEW, sort: "oldest" }).map((one) => one.key)).toEqual(["b", "c", "a"]);
    expect(filterImports(list, { ...DEFAULT_VIEW, sort: "messages" }).map((one) => one.key)).toEqual(["b", "c", "a"]);
    expect(filterImports(list, { ...DEFAULT_VIEW, sort: "title" }).map((one) => one.key)).toEqual(["a", "c", "b"]);
  });

  it("ticks everything not imported yet, and counts each source", () => {
    expect([...initialSelection(list)].sort()).toEqual(["a", "c"]);
    expect(sourceCounts(list)).toEqual([{ name: "Claude Code", count: 2 }, { name: "Codex", count: 1 }]);
  });

  it("remembers choices, and falls back to the defaults for anything it cannot read", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); } };
    writePrefs(storage, { scan: { tools: ["codex"], perTool: 500, sinceDays: 30, onlyCurrentProject: true }, import: { skipImported: true, lastMessages: 50, here: true } });
    expect(readPrefs(storage)).toEqual({ scan: { tools: ["codex"], perTool: 500, sinceDays: 30, onlyCurrentProject: true }, import: { skipImported: true, lastMessages: 50, here: true } });
    store.set("adcode.moveIn.prefs", JSON.stringify({ scan: { tools: [], perTool: 7, sinceDays: 3 }, import: { lastMessages: 9 } }));
    expect(readPrefs(storage)).toEqual(DEFAULT_PREFS);
    store.set("adcode.moveIn.prefs", "{broken");
    expect(readPrefs(storage)).toEqual(DEFAULT_PREFS);
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
  });

  it("imports in batches", () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

import { mkdtemp, mkdir, writeFile, rm, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAssistantControlsService, parseAssistantServer, type McpSession, type RemoteTool } from "../src/main/assistantControlsService.ts";
import { discoverSkills, installedSkillRoots, parseSkill } from "../src/main/assistantSkills.ts";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function temp() { const path = await mkdtemp(join(tmpdir(), "adcode-controls-")); directories.push(path); return path; }
const server = { id: "test-server", name: "Test server", transport: "stdio" as const, endpoint: "test-executable", args: ["--mcp"] };
const remoteTool: RemoteTool = { name: "find_issues", description: "Search project issues", inputSchema: { type: "object", properties: { query: { type: "string" } } } };
const skillText = "---\nname: review-code\ndescription: Review code for bugs\n---\nRead the changed files and check their callers.\n";
async function setup() {
  const directory = await temp();
  let root: string | null = directory;
  let closed = () => {};
  const session: McpSession = { list: vi.fn(async () => [remoteTool]), call: vi.fn(async () => ({ content: "Found 2 issues", isError: false })), close: vi.fn(async () => {}) };
  const connect = vi.fn(async (_server, onClose: () => void) => { closed = onClose; return session; });
  const confirm = vi.fn(async (_title: string, _detail: string, _signal?: AbortSignal) => true);
  const service = createAssistantControlsService({ directory, workspace: () => root, connect, confirm });
  const run = (name: string, input: Record<string, unknown>, signal = new AbortController().signal) => service.runner.run({ type: "tool-call", id: "call", name, input }, signal);
  const saveConnect = async () => {
    await service.action({ kind: "save-server", server });
    await service.action({ kind: "connect", id: server.id });
  };
  const enable = (enabled = true) => service.action({ kind: "set-tool", id: server.id, tool: remoteTool.name, enabled });
  return { directory, service, session, connect, confirm, run, saveConnect, enable, setRoot: (value: string | null) => { root = value; }, disconnectRemotely: () => closed() };
}

describe("assistant capability controls", () => {
  it("creates disabled workspace skills without overwriting existing files or accepting path traversal", async () => {
    const t = await setup();
    const action = { kind: "create-skill", name: "review-code", description: "Review changes", instructions: "Check the changed files." };
    const view = await t.service.action(action);
    expect(view.skills[0]).toMatchObject({ name: "review-code", enabled: false });
    const path = join(t.directory, ".adcode", "skills", "review-code", "SKILL.md");
    expect(await readFile(path, "utf8")).toContain("Check the changed files.");
    await expect(t.service.action(action)).rejects.toThrow();
    await expect(t.service.action({ ...action, name: "../escape" })).rejects.toThrow("hyphenated");
  });
  it("saves without starting a process, exposes no tools until enabled, and persists permissions without auto-connect", async () => {
    const t = await setup();
    await t.service.action({ kind: "save-server", server });
    expect(t.connect).not.toHaveBeenCalled();
    await t.service.action({ kind: "connect", id: server.id });
    expect(JSON.parse((await t.run("discover_capabilities", { query: "issues" })).content).matches).toEqual([]);
    expect((await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: {} })).isError).toBe(true);
    expect(t.session.call).not.toHaveBeenCalled();
    await t.enable();
    const discovery = JSON.parse((await t.run("discover_capabilities", { query: "issues" })).content);
    expect(discovery.matches[0]).toMatchObject({ kind: "mcp", server: server.id, inputSchema: remoteTool.inputSchema });
    const restarted = createAssistantControlsService({ directory: t.directory, workspace: () => t.directory, connect: t.connect, confirm: t.confirm });
    expect((await restarted.snapshot()).servers[0]?.status).toBe("disconnected");
    expect(t.connect).toHaveBeenCalledTimes(1);
    expect((await readFile(join(t.directory, "assistant-controls.json"), "utf8"))).toContain("find_issues");
  });

  it("confirms exact arguments and records actual call outcome and timing", async () => {
    const t = await setup(); await t.saveConnect(); await t.enable();
    const output = await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: { query: "bug" } });
    expect(output).toEqual({ content: "Found 2 issues", isError: false });
    expect(t.confirm.mock.calls.at(-1)?.[1]).toContain('{"query":"bug"}');
    const view = (await t.service.snapshot()).servers[0]?.tools[0];
    expect(view?.calls).toBe(1);
    expect(view?.lastDurationMs).toBeGreaterThanOrEqual(0);
    expect(view?.lastError).toBeNull();
  });

  it("rechecks permissions after approval and prevents disabled tools from running", async () => {
    const t = await setup(); await t.saveConnect(); await t.enable();
    t.confirm.mockImplementationOnce(async () => { await t.enable(false); return true; });
    const output = await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: {} });
    expect(output.isError).toBe(true);
    expect(t.session.call).not.toHaveBeenCalled();
  });

  it("cancels when the project changes during approval, or when the signal is aborted", async () => {
    const t = await setup(); await t.saveConnect(); await t.enable();
    t.confirm.mockImplementationOnce(async () => { t.setRoot(null); return true; });
    expect((await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: {} })).isError).toBe(true);
    const abort = new AbortController(); abort.abort();
    expect((await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: {} }, abort.signal)).isError).toBe(true);
    expect(t.session.call).not.toHaveBeenCalled();
  });

  it("declines calls and revokes tools when a server disconnects", async () => {
    const t = await setup(); await t.saveConnect(); await t.enable();
    t.confirm.mockResolvedValueOnce(false);
    expect((await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: {} })).isError).toBe(true);
    t.disconnectRemotely();
    expect((await t.service.snapshot()).servers[0]?.status).toBe("disconnected");
    expect(JSON.parse((await t.run("discover_capabilities", { query: "" })).content).matches).toEqual([]);
    expect(t.session.call).not.toHaveBeenCalled();
  });

  it("surfaces connection errors and invalidates permission after schema changes", async () => {
    const t = await setup(); await t.saveConnect(); await t.enable();
    vi.mocked(t.session.list).mockResolvedValueOnce([{ ...remoteTool, description: "Now also changes issues" }]);
    await t.service.action({ kind: "connect", id: server.id });
    expect((await t.service.snapshot()).servers[0]?.tools[0]?.enabled).toBe(false);
    t.connect.mockRejectedValueOnce(new Error("Server unreachable"));
    await t.service.action({ kind: "connect", id: server.id });
    expect((await t.service.snapshot()).servers[0]).toMatchObject({ status: "error", error: "Server unreachable", tools: [] });
  });

  it("bounds tool output and reports remote failures without claiming success", async () => {
    const t = await setup(); await t.saveConnect(); await t.enable();
    vi.mocked(t.session.call).mockResolvedValueOnce({ content: "x".repeat(80_000), isError: true });
    const output = await t.run("call_mcp", { server: server.id, tool: remoteTool.name, arguments: {} });
    expect(output.content.length).toBeLessThan(24_200);
    expect(output.content).toContain("Truncated");
    expect((await t.service.snapshot()).servers[0]?.tools[0]?.lastError).not.toBeNull();
  });

  it("discovers, previews and activates project skills; changes require activation again", async () => {
    const t = await setup();
    const folder = join(t.directory, ".agents", "skills", "review-code");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "SKILL.md"), skillText);
    const id = ".agents/skills/review-code/SKILL.md";
    expect((await t.service.snapshot()).skills[0]).toMatchObject({ enabled: false, name: "review-code", error: null });
    expect(await t.service.previewSkill(id)).toBe(skillText);
    expect((await t.run("load_skill", { id })).isError).toBe(true);
    await t.service.action({ kind: "set-skill", id, enabled: true });
    expect((await t.run("load_skill", { id })).content).toContain("check their callers");
    expect(JSON.parse((await t.run("discover_capabilities", { query: "review" })).content).matches[0].kind).toBe("skill");
    await writeFile(join(folder, "SKILL.md"), skillText + "Changed instructions.");
    expect((await t.service.snapshot()).skills[0]?.error).toContain("Changed since activation");
    expect((await t.run("load_skill", { id })).isError).toBe(true);
    await t.service.action({ kind: "set-skill", id, enabled: true });
    expect((await t.run("load_skill", { id })).content).toContain("Changed instructions.");
    t.setRoot(await temp());
    expect((await t.service.snapshot()).skills).toEqual([]);
    await expect(t.service.previewSkill(id)).rejects.toThrow("not found");
  });

  it("handles corrupt preferences visibly without overwriting them on read", async () => {
    const directory = await temp();
    const file = join(directory, "assistant-controls.json");
    await writeFile(file, "{bad");
    const service = createAssistantControlsService({ directory, workspace: () => null, connect: vi.fn(), confirm: vi.fn() });
    expect((await service.snapshot()).notice).toContain("could not be read");
    expect(await readFile(file, "utf8")).toBe("{bad");
  });

  it("rejects invalid renderer input and non-local plaintext remote URLs", async () => {
    expect(() => parseAssistantServer({ ...server, transport: "http", endpoint: "http://example.com/mcp" })).toThrow("HTTPS");
    expect(() => parseAssistantServer({ ...server, transport: "http", endpoint: "https://example.com/mcp?token=secret" })).toThrow("credentials");
    expect(() => parseAssistantServer({ ...server, args: [4] })).toThrow("Arguments");
    expect(parseAssistantServer({ ...server, transport: "http", endpoint: "http://127.0.0.1:4567/mcp" }).transport).toBe("http");
    const t = await setup();
    await expect(t.service.action({ kind: "save-server", server: { ...server, id: "../escape" } })).rejects.toThrow("hyphenated");
    await expect(t.service.action({ kind: "unknown", id: server.id })).rejects.toThrow();
  });
});

describe("skill format and containment", () => {
  it("finds user and bundled system skills without an open project", async () => {
    const home = await temp();
    const path = join(home, ".codex", "skills", ".system", "review-code");
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "SKILL.md"), skillText);
    const roots = installedSkillRoots(home);
    const skills = await discoverSkills(null, {}, roots);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ name: "review-code", scope: "system", source: "Codex system", enabled: false });
    expect(skills[0]?.id).toMatch(/^system:/);
    expect(installedSkillRoots(home, join(home, "custom"))).toContainEqual({ path: join(home, "custom", "skills"), source: "Codex" });
  });
  it("keeps duplicate skill names distinct across installations and the project", async () => {
    const home = await temp();
    const project = await temp();
    for (const folder of [join(home, ".claude", "skills", "review-code"), join(home, ".agents", "skills", "review-code"), join(project, ".agents", "skills", "review-code")]) {
      await mkdir(folder, { recursive: true }); await writeFile(join(folder, "SKILL.md"), skillText);
    }
    const found = await discoverSkills(project, {}, installedSkillRoots(home));
    expect(found).toHaveLength(3);
    expect(new Set(found.map(skill => skill.id)).size).toBe(3);
    expect(found[0]?.scope).toBe("workspace");
  });
  it("persists system activation across projects and confines supporting-file reads", async () => {
    const home = await temp();
    const folder = join(home, ".adcode", "skills", "review-code");
    await mkdir(join(folder, "references"), { recursive: true });
    await writeFile(join(folder, "SKILL.md"), skillText);
    await writeFile(join(folder, "references", "checks.md"), "Check caller behavior.");
    let workspace: string | null = null;
    const directory = await temp();
    const service = createAssistantControlsService({ directory, workspace: () => workspace, installedSkills: installedSkillRoots(home), connect: vi.fn(), confirm: vi.fn() });
    const id = (await service.snapshot()).skills[0]!.id;
    await service.action({ kind: "set-skill", id, enabled: true });
    workspace = await temp();
    expect((await service.snapshot()).skills[0]?.enabled).toBe(true);
    const run = (resource: string) => service.runner.run({ type: "tool-call", id: "test", name: "load_skill", input: { id, resource } }, new AbortController().signal);
    expect((await run("references/checks.md")).content).toContain("Check caller behavior.");
    await expect(run("../secret.txt")).rejects.toThrow("outside");
    await service.action({ kind: "set-skill", id, enabled: false });
    expect((await run("references/checks.md")).isError).toBe(true);
    expect((await readFile(join(folder, "SKILL.md"), "utf8"))).toBe(skillText);
  });
  it("reads CRLF, quoted, and folded metadata and rejects missing fields", () => {
    expect(parseSkill(skillText.replaceAll("\n", "\r\n")).name).toBe("review-code");
    expect(parseSkill('---\nname: "review-code"\ndescription: >-\n  Review code\n  for bugs\n---\nBody').description).toBe("Review code for bugs");
    expect(() => parseSkill("No metadata")).toThrow("frontmatter");
    expect(() => parseSkill("---\nname: review-code\n---\nBody")).toThrow("description");
  });
  it("refuses skill folders redirected outside the workspace", async () => {
    const directory = await temp();
    const outside = await temp();
    await mkdir(join(directory, ".agents"));
    await mkdir(join(outside, "review-code"));
    await writeFile(join(outside, "review-code", "SKILL.md"), skillText);
    await symlink(outside, join(directory, ".agents", "skills"), process.platform === "win32" ? "junction" : "dir");
    expect(await discoverSkills(directory, {})).toEqual([]);
  });
});

import { execFile as execFileCallback } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAiSandbox, resolveSandboxPath } from "../src/main/aiSandbox.ts";

const execFile = promisify(execFileCallback);
let root: string;
let userData: string;
const cleanups: Array<() => Promise<void>> = [];

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "adcode-project-"));
  userData = await mkdtemp(join(tmpdir(), "adcode-user-data-"));
});

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  await rm(root, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
});

async function initialiseGit(): Promise<void> {
  await execFile("git", ["init", "--initial-branch=main"], { cwd: root });
  await execFile("git", ["config", "user.email", "tests@adcode.local"], { cwd: root });
  await execFile("git", ["config", "user.name", "ADCode Tests"], { cwd: root });
  await writeFile(join(root, "tracked.txt"), "original\n", "utf8");
  await execFile("git", ["add", "tracked.txt"], { cwd: root });
  await execFile("git", ["commit", "-m", "initial"], { cwd: root });
}

describe("AI sandbox creation", () => {
  it("uses a detached worktree for a clean Git workspace", async () => {
    await initialiseGit();
    const created = await createAiSandbox({
      userDataDirectory: userData,
      taskId: "task-clean",
      workspaceRoot: root,
      now: 100,
    });
    cleanups.push(created.cleanup);

    expect(created.record.kind).toBe("git-worktree");
    expect((await readFile(join(created.root, "tracked.txt"), "utf8")).replaceAll("\r\n", "\n")).toBe(
      "original\n",
    );
    await writeFile(join(created.root, "tracked.txt"), "sandbox\n", "utf8");
    expect((await readFile(join(root, "tracked.txt"), "utf8")).replaceAll("\r\n", "\n")).toBe(
      "original\n",
    );
  });

  it("uses a shadow copy when Git has human changes", async () => {
    await initialiseGit();
    await writeFile(join(root, "tracked.txt"), "human draft\n", "utf8");
    await writeFile(join(root, "untracked.txt"), "keep me\n", "utf8");

    const created = await createAiSandbox({
      userDataDirectory: userData,
      taskId: "task-dirty",
      workspaceRoot: root,
      now: 100,
    });
    cleanups.push(created.cleanup);

    expect(created.record.kind).toBe("shadow-copy");
    expect(await readFile(join(created.root, "tracked.txt"), "utf8")).toBe("human draft\n");
    expect(await readFile(join(created.root, "untracked.txt"), "utf8")).toBe("keep me\n");
  });

  it("uses a shadow copy for a non-Git project and omits transient heavy directories", async () => {
    await writeFile(join(root, "index.ts"), "export {};\n", "utf8");
    await mkdir(join(root, "node_modules", "huge"), { recursive: true });
    await writeFile(join(root, "node_modules", "huge", "package.js"), "large", "utf8");
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "bundle.js"), "built", "utf8");

    const created = await createAiSandbox({
      userDataDirectory: userData,
      taskId: "task-shadow",
      workspaceRoot: root,
      now: 100,
    });
    cleanups.push(created.cleanup);

    expect(created.record.kind).toBe("shadow-copy");
    expect(await readFile(join(created.root, "index.ts"), "utf8")).toBe("export {};\n");
    await expect(readFile(join(created.root, "dist", "bundle.js"), "utf8")).rejects.toThrow();
    await expect(
      readFile(join(created.root, "node_modules", "huge", "package.js"), "utf8"),
    ).rejects.toThrow();
  });

  it("removes only its registered sandbox", async () => {
    await writeFile(join(root, "index.ts"), "safe", "utf8");
    const unrelated = join(userData, "ai-workspaces", "sandboxes", "do-not-delete");
    await mkdir(unrelated, { recursive: true });
    await writeFile(join(unrelated, "keep.txt"), "keep", "utf8");

    const created = await createAiSandbox({
      userDataDirectory: userData,
      taskId: "task-remove",
      workspaceRoot: root,
      now: 100,
    });
    await created.cleanup();

    await expect(readFile(join(created.root, "index.ts"), "utf8")).rejects.toThrow();
    expect(await readFile(join(unrelated, "keep.txt"), "utf8")).toBe("keep");
  });
});

describe("sandbox path containment", () => {
  it("resolves portable relative paths within the sandbox", async () => {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "file.ts"), "ok", "utf8");
    expect(await resolveSandboxPath(root, "src/file.ts")).toBe(join(root, "src", "file.ts"));
  });

  it("refuses absolute, traversal, NUL, and symlink escapes", async () => {
    const outside = await mkdtemp(join(tmpdir(), "adcode-outside-"));
    try {
      await mkdir(join(root, "src"), { recursive: true });
      await symlink(outside, join(root, "src", "escape"), process.platform === "win32" ? "junction" : "dir");

      await expect(resolveSandboxPath(root, "../secret.txt")).rejects.toThrow(/sandbox/i);
      await expect(resolveSandboxPath(root, join(outside, "secret.txt"))).rejects.toThrow(/sandbox/i);
      await expect(resolveSandboxPath(root, "src/file.ts\u0000.txt")).rejects.toThrow(/sandbox/i);
      await expect(resolveSandboxPath(root, "src/escape/secret.txt")).rejects.toThrow(/sandbox/i);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

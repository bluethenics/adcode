/** Main-process creation and containment of isolated AI workspaces. */
import { execFile as execFileCallback } from "node:child_process";
import { cp, lstat, mkdir, readdir, realpath, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { AiSandboxRecord } from "@adcode/ai";

const execFile = promisify(execFileCallback);
const TASK_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const TEAM_ID = /^[a-z][a-z0-9-]{2,63}$/;
const GIT_REVISION = /^[a-f0-9]{40,64}$/i;
const SHADOW_EXCLUDES = new Set([
  ".git",
  ".worktrees",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

function comparePath(path: string): string {
  const absolute = resolve(path);
  return process.platform === "linux" ? absolute : absolute.toLowerCase();
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(comparePath(root), comparePath(candidate));
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve an agent-supplied portable relative path without permitting lexical or symlink
 * escape. The nearest existing ancestor is resolved so a junction inside the sandbox
 * cannot redirect a new file to an outside directory.
 */
export async function resolveSandboxPath(sandboxRoot: string, portablePath: string): Promise<string> {
  if (
    typeof portablePath !== "string" ||
    portablePath.length === 0 ||
    portablePath.includes("\u0000") ||
    isAbsolute(portablePath) ||
    /^[A-Za-z]:[\\/]/.test(portablePath)
  ) {
    throw new Error("Path is outside the task sandbox");
  }

  const parts = portablePath.replaceAll("\\", "/").split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("Path is outside the task sandbox");
  }

  const rootReal = await realpath(sandboxRoot);
  const target = resolve(rootReal, ...parts);
  if (!isWithin(rootReal, target)) throw new Error("Path is outside the task sandbox");

  let ancestor = target;
  while (!(await exists(ancestor))) {
    const parent = dirname(ancestor);
    if (parent === ancestor) throw new Error("Path is outside the task sandbox");
    ancestor = parent;
  }

  const ancestorReal = await realpath(ancestor);
  if (!isWithin(rootReal, ancestorReal)) throw new Error("Path is outside the task sandbox");
  return target;
}

async function gitOutput(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    const result = await execFile("git", [...args], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
    });
    return result.stdout.trim();
  } catch {
    return null;
  }
}

async function cleanGitRoot(workspaceRoot: string): Promise<boolean> {
  const top = await gitOutput(workspaceRoot, ["rev-parse", "--show-toplevel"]);
  if (top === null || comparePath(top) !== comparePath(workspaceRoot)) return false;
  const head = await gitOutput(workspaceRoot, ["rev-parse", "--verify", "HEAD"]);
  if (head === null) return false;
  const status = await gitOutput(workspaceRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  return status === "";
}

async function createShadowCopy(workspaceRoot: string, target: string): Promise<void> {
  await cp(workspaceRoot, target, {
    recursive: true,
    errorOnExist: true,
    force: false,
    filter(source): boolean {
      if (comparePath(source) === comparePath(workspaceRoot)) return true;
      const rel = relative(workspaceRoot, source);
      return !rel.split(sep).some((part) => SHADOW_EXCLUDES.has(part));
    },
  });
}

async function createShadowCopyOrClean(source: string, target: string): Promise<void> {
  try {
    await createShadowCopy(source, target);
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

export interface CreateAiSandboxInput {
  readonly userDataDirectory: string;
  readonly taskId: string;
  readonly workspaceRoot: string;
  readonly now: number;
  readonly source?: AiSandboxSource;
}

export type AiSandboxSource =
  | { readonly kind: "git-revision"; readonly revision: string }
  | { readonly kind: "shadow-base"; readonly root: string };

export type AiSandboxBaseRecord =
  | { readonly kind: "git-revision"; readonly revision: string; readonly sizeBytes: 0 }
  | { readonly kind: "shadow-base"; readonly sizeBytes: number };

export interface CapturedAiSandboxBase {
  readonly record: AiSandboxBaseRecord;
  readonly source: AiSandboxSource;
  cleanup(): Promise<void>;
}

export interface CaptureAiSandboxBaseInput {
  readonly userDataDirectory: string;
  readonly teamId: string;
  readonly workspaceRoot: string;
}

async function directorySize(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true });
  let bytes = 0;
  for (const entry of entries) {
    const target = join(path, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) bytes += await directorySize(target);
    else bytes += (await lstat(target)).size;
  }
  return bytes;
}

export async function captureAiSandboxBase(
  input: CaptureAiSandboxBaseInput,
): Promise<CapturedAiSandboxBase> {
  if (!TEAM_ID.test(input.teamId)) throw new Error("Invalid Team id");
  const workspace = await realpath(input.workspaceRoot);
  if (await cleanGitRoot(workspace)) {
    const revision = await gitOutput(workspace, ["rev-parse", "HEAD"]);
    if (revision !== null && GIT_REVISION.test(revision)) {
      return {
        record: { kind: "git-revision", revision, sizeBytes: 0 },
        source: { kind: "git-revision", revision },
        async cleanup(): Promise<void> {},
      };
    }
  }

  const teamsRoot = join(input.userDataDirectory, "ai-teams");
  const baseRoot = join(teamsRoot, input.teamId, "base");
  if (!isWithin(teamsRoot, baseRoot) || (await exists(baseRoot))) {
    throw new Error("Team shadow base already exists or is outside the Team registry");
  }
  await mkdir(dirname(baseRoot), { recursive: true });
  await createShadowCopyOrClean(workspace, baseRoot);
  let cleaned = false;
  return {
    record: { kind: "shadow-base", sizeBytes: await directorySize(baseRoot) },
    source: { kind: "shadow-base", root: baseRoot },
    async cleanup(): Promise<void> {
      if (cleaned) return;
      cleaned = true;
      if (!isWithin(teamsRoot, baseRoot)) throw new Error("Invalid Team shadow base path");
      await rm(baseRoot, { recursive: true, force: true });
    },
  };
}

export interface CreatedAiSandbox {
  readonly record: AiSandboxRecord;
  /** Main-process-only absolute path. */
  readonly root: string;
  readonly dependencyCacheReused: boolean;
  cleanup(): Promise<void>;
}

export interface RemoveAiSandboxInput {
  readonly userDataDirectory: string;
  readonly taskId: string;
  readonly workspaceRoot: string;
  readonly kind: AiSandboxRecord["kind"];
}

export async function removeAiSandbox(input: RemoveAiSandboxInput): Promise<void> {
  if (!TASK_ID.test(input.taskId)) throw new Error("Invalid task id");
  const sandboxesRoot = join(input.userDataDirectory, "ai-workspaces", "sandboxes");
  const root = join(sandboxesRoot, input.taskId);
  if (!isWithin(sandboxesRoot, root) || basename(root) !== input.taskId) {
    throw new Error("Invalid sandbox registry path");
  }
  if (input.kind === "git-worktree") {
    await gitOutput(input.workspaceRoot, ["worktree", "remove", "--force", root]);
  }
  await rm(root, { recursive: true, force: true });
}

export async function createAiSandbox(input: CreateAiSandboxInput): Promise<CreatedAiSandbox> {
  if (!TASK_ID.test(input.taskId)) throw new Error("Invalid task id");
  const workspace = await realpath(input.workspaceRoot);
  const sandboxesRoot = join(input.userDataDirectory, "ai-workspaces", "sandboxes");
  await mkdir(sandboxesRoot, { recursive: true });
  const root = join(sandboxesRoot, input.taskId);
  if (!isWithin(sandboxesRoot, root) || (await exists(root))) {
    throw new Error("Task sandbox already exists or is outside the sandbox registry");
  }

  let kind: AiSandboxRecord["kind"] = "shadow-copy";
  if (input.source?.kind === "git-revision") {
    if (!GIT_REVISION.test(input.source.revision)) throw new Error("Invalid captured Git revision");
    const added = await gitOutput(workspace, [
      "worktree",
      "add",
      "--detach",
      root,
      input.source.revision,
    ]);
    if (added === null) {
      await gitOutput(workspace, ["worktree", "remove", "--force", root]);
      await rm(root, { recursive: true, force: true });
      throw new Error("Could not create a worktree at the captured revision");
    }
    kind = "git-worktree";
  } else if (input.source?.kind === "shadow-base") {
    const teamsRoot = join(input.userDataDirectory, "ai-teams");
    const sourceRoot = await realpath(input.source.root);
    if (!isWithin(teamsRoot, sourceRoot)) throw new Error("Captured shadow base is outside Team storage");
    await createShadowCopyOrClean(sourceRoot, root);
  } else if (await cleanGitRoot(workspace)) {
    const added = await gitOutput(workspace, ["worktree", "add", "--detach", root, "HEAD"]);
    if (added !== null) kind = "git-worktree";
  }

  if (kind === "shadow-copy" && input.source?.kind !== "shadow-base") {
    // A failed worktree command can leave a partial directory even though it returned an
    // error. It is safe to remove only because `root` was derived from the validated task
    // id and proved inside this store's registry above.
    await rm(root, { recursive: true, force: true });
    await createShadowCopyOrClean(workspace, root);
  }

  let cleaned = false;
  return {
    record: { kind, id: input.taskId, createdAt: input.now },
    root,
    dependencyCacheReused: false,
    async cleanup(): Promise<void> {
      if (cleaned) return;
      cleaned = true;
      await removeAiSandbox({
        userDataDirectory: input.userDataDirectory,
        taskId: input.taskId,
        workspaceRoot: workspace,
        kind,
      });
    },
  };
}

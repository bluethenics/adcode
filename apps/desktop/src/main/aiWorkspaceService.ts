/**
 * Main-process authority for one built-in agent's isolated workspace.
 *
 * Model and renderer inputs stop here. This service owns the durable task record, sandbox
 * path, overlap check, pre-apply checkpoint, human-workspace write, discard, and rollback.
 */
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  addUsage,
  applyHunks,
  canReserveUsage,
  computeHunks,
  createAiWorkspaceTask,
  createFileChange,
  createOperationalTrace,
  transitionTask,
  type AiCheckpointSummary,
  type AiFileChange,
  type AiWorkspaceTask,
  type OperationalTrace,
  type AiUsage,
} from "@adcode/ai";
import { createAiSandbox, removeAiSandbox, resolveSandboxPath } from "./aiSandbox.ts";
import { createAiWorkspaceStore, type AiWorkspaceStore } from "./aiWorkspaceStore.ts";

export type ApplySelection =
  | { readonly path: string; readonly contents: string }
  | { readonly path: string; readonly acceptedHunkIds: readonly string[] };

export interface AiWorkspaceActionResult {
  readonly ok: boolean;
  readonly task: AiWorkspaceTask;
  readonly conflicts: readonly string[];
  readonly message: string;
}

export interface AiWorkspaceBudgetResult {
  readonly ok: boolean;
  readonly task: AiWorkspaceTask;
  readonly reason: "token-limit" | "cost-limit" | null;
}

interface CheckpointEntry {
  readonly path: string;
  readonly original: string | null;
  readonly applied: string;
  readonly appliedHash: string;
}

interface CheckpointManifest {
  readonly id: string;
  readonly taskId: string;
  readonly workspaceRoot: string;
  readonly createdAt: number;
  readonly entries: readonly CheckpointEntry[];
}

export interface AiWorkspaceServiceOptions {
  readonly userDataDirectory: string;
  readonly now?: () => number;
  readonly id?: (prefix: "task" | "trace" | "checkpoint") => string;
  readonly storagePolicy?: () => AiWorkspaceStoragePolicy;
}

export interface AiWorkspaceStoragePolicy {
  readonly quotaBytes: number;
  readonly sandboxRetentionMs: number;
  readonly checkpointRetentionMs: number;
}

export interface AiWorkspaceMaintenanceResult {
  readonly ok: boolean;
  readonly totalSandboxBytes: number;
  readonly removedTaskIds: readonly string[];
}

export interface StartAiWorkspaceInput {
  readonly workspaceRoot: string;
  readonly prompt: string;
  readonly tokenLimit?: number;
  readonly costMicrosLimit?: number;
}

export interface AiWorkspaceService {
  start(input: StartAiWorkspaceInput): Promise<AiWorkspaceTask>;
  read(taskId: string): Promise<AiWorkspaceTask | null>;
  list(workspaceRoot: string): Promise<AiWorkspaceTask[]>;
  write(taskId: string, path: string, contents: string): Promise<AiWorkspaceTask>;
  readSandboxFile(taskId: string, path: string): Promise<string>;
  pause(taskId: string): Promise<AiWorkspaceTask | null>;
  reserveUsage(taskId: string, usage: AiUsage): Promise<AiWorkspaceBudgetResult>;
  apply(taskId: string, selections: readonly ApplySelection[]): Promise<AiWorkspaceActionResult>;
  reject(taskId: string, path: string): Promise<AiWorkspaceTask>;
  discard(taskId: string): Promise<AiWorkspaceTask | null>;
  rollback(taskId: string): Promise<AiWorkspaceActionResult>;
  traces(taskId: string): Promise<OperationalTrace[]>;
  recoverActive(): Promise<AiWorkspaceTask[]>;
  maintainStorage(policy: AiWorkspaceStoragePolicy): Promise<AiWorkspaceMaintenanceResult>;
}

const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
const workspaceIdentity = (root: string): string => `ws-${hash(root).slice(0, 32)}`;
const CHECKPOINT_ID = /^[a-z0-9][a-z0-9-]{2,80}$/;

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function writeAtomic(path: string, contents: string): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  const temporary = `${path}.adcode-${randomUUID()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  try {
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function updateForReview(task: AiWorkspaceTask, changes: readonly AiFileChange[], now: number): AiWorkspaceTask {
  let next = task;
  if (next.state === "ready" || next.state === "paused") next = transitionTask(next, "running", now);
  if (next.state === "running") next = transitionTask(next, "review", now);
  else if (next.state === "conflict") next = transitionTask(next, "review", now);
  else if (next.state !== "review") throw new Error(`Task ${task.id} cannot accept edits in ${task.state}`);
  return { ...next, changes, updatedAt: now };
}

function sandboxRoot(userDataDirectory: string, taskId: string): string {
  return join(userDataDirectory, "ai-workspaces", "sandboxes", taskId);
}

export function createAiWorkspaceService(options: AiWorkspaceServiceOptions): AiWorkspaceService {
  const now = options.now ?? Date.now;
  const id = options.id ?? ((prefix): string => `${prefix}-${randomUUID()}`);
  const store: AiWorkspaceStore = createAiWorkspaceStore(options.userDataDirectory);
  const runtimeCleanups = new Map<string, () => Promise<void>>();

  async function trace(
    taskId: string,
    kind: OperationalTrace["kind"],
    summary: string,
    outcome: OperationalTrace["outcome"],
    detail = "",
  ): Promise<void> {
    try {
      await store.appendTrace(
        createOperationalTrace({ id: id("trace"), taskId, at: now(), kind, summary, detail, outcome }),
      );
    } catch {
      // A trace is observability, not authority. A full trace disk must not corrupt a
      // successful checkpoint or turn a safe refusal into a partial action.
    }
  }

  async function required(taskId: string): Promise<AiWorkspaceTask> {
    const task = await store.read(taskId);
    if (task === null) throw new Error("AI workspace task was not found");
    return task;
  }

  function checkpointPath(taskId: string, checkpointId: string): string {
    if (!CHECKPOINT_ID.test(checkpointId)) throw new Error("Invalid checkpoint id");
    return join(
      options.userDataDirectory,
      "ai-workspaces",
      "tasks",
      taskId,
      "checkpoints",
      checkpointId,
      "manifest.json",
    );
  }

  async function writeManifest(manifest: CheckpointManifest): Promise<void> {
    await writeAtomic(checkpointPath(manifest.taskId, manifest.id), JSON.stringify(manifest, null, 2));
  }

  async function readManifest(task: AiWorkspaceTask): Promise<CheckpointManifest> {
    const checkpoint = task.checkpoint;
    if (checkpoint === null) throw new Error("Task has no rollback checkpoint");
    const parsed: unknown = JSON.parse(await readFile(checkpointPath(task.id, checkpoint.id), "utf8"));
    if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as CheckpointManifest).entries)) {
      throw new Error("Rollback checkpoint is corrupt");
    }
    return parsed as CheckpointManifest;
  }

  async function removeTaskSandbox(task: AiWorkspaceTask): Promise<void> {
    if (task.sandbox === null) return;
    const cleanup = runtimeCleanups.get(task.id);
    runtimeCleanups.delete(task.id);
    if (cleanup !== undefined) {
      await cleanup();
      return;
    }
    await removeAiSandbox({
      userDataDirectory: options.userDataDirectory,
      taskId: task.id,
      workspaceRoot: task.workspaceRoot,
      kind: task.sandbox.kind,
    });
  }

  async function directorySize(path: string): Promise<number> {
    try {
      const entries = await readdir(path, { withFileTypes: true });
      let bytes = 0;
      for (const entry of entries) {
        const target = join(path, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) bytes += await directorySize(target);
        else bytes += (await lstat(target)).size;
      }
      return bytes;
    } catch {
      return 0;
    }
  }

  async function maintainStorage(policy: AiWorkspaceStoragePolicy): Promise<AiWorkspaceMaintenanceResult> {
    if (
      !Number.isSafeInteger(policy.quotaBytes) ||
      policy.quotaBytes <= 0 ||
      !Number.isSafeInteger(policy.sandboxRetentionMs) ||
      policy.sandboxRetentionMs < 0 ||
      !Number.isSafeInteger(policy.checkpointRetentionMs) ||
      policy.checkpointRetentionMs < 0
    ) {
      throw new Error("Invalid AI workspace storage policy");
    }

    const tasks = await store.listAll();
    const removedTaskIds: string[] = [];
    const terminal = new Set(["applied", "discarded", "failed", "rolled-back"]);

    // Age-based cleanup first. An applied task may lose its sandbox, but never its only
    // checkpoint; rollback reads the checkpoint and does not depend on the sandbox.
    for (const original of tasks) {
      let task = original;
      const age = Math.max(0, now() - task.updatedAt);
      if (task.sandbox !== null && terminal.has(task.state) && age >= policy.sandboxRetentionMs) {
        try {
          await removeTaskSandbox(task);
          task = { ...task, sandbox: null, updatedAt: now() };
          await store.save(task);
          removedTaskIds.push(task.id);
        } catch {
          // A registered worktree can be temporarily busy. Leave its record intact so a
          // later maintenance pass can retry safely.
        }
      }
      if (
        task.checkpoint !== null &&
        task.state !== "applied" &&
        task.state !== "conflict" &&
        age >= policy.checkpointRetentionMs
      ) {
        try {
          await rm(dirname(checkpointPath(task.id, task.checkpoint.id)), { recursive: true, force: true });
          task = { ...task, checkpoint: null, updatedAt: now() };
          await store.save(task);
        } catch {
          // Checkpoint cleanup is optional and never blocks task recovery.
        }
      }
    }

    const sandboxes = join(options.userDataDirectory, "ai-workspaces", "sandboxes");
    let totalSandboxBytes = await directorySize(sandboxes);
    if (totalSandboxBytes > policy.quotaBytes) {
      const refreshed = (await store.listAll())
        .filter((task) => task.sandbox !== null && terminal.has(task.state))
        .sort((a, b) => a.updatedAt - b.updatedAt);
      for (const task of refreshed) {
        if (totalSandboxBytes <= policy.quotaBytes) break;
        try {
          await removeTaskSandbox(task);
          await store.save({ ...task, sandbox: null, updatedAt: now() });
          if (!removedTaskIds.includes(task.id)) removedTaskIds.push(task.id);
          totalSandboxBytes = await directorySize(sandboxes);
        } catch {
          // Try the next eligible task; active work and checkpoints remain untouched.
        }
      }
    }

    return { ok: totalSandboxBytes <= policy.quotaBytes, totalSandboxBytes, removedTaskIds };
  }

  return {
    async start(input): Promise<AiWorkspaceTask> {
      const policy = options.storagePolicy?.();
      if (policy !== undefined && !(await maintainStorage(policy)).ok) {
        throw new Error("AI workspace storage quota is full. Increase it in Settings or discard a task.");
      }
      const root = await import("node:fs/promises").then(({ realpath }) => realpath(input.workspaceRoot));
      const createdAt = now();
      let task = createAiWorkspaceTask({
        id: id("task"),
        workspaceId: workspaceIdentity(root),
        workspaceRoot: root,
        prompt: input.prompt,
        now: createdAt,
        ...(input.tokenLimit === undefined ? {} : { tokenLimit: input.tokenLimit }),
        ...(input.costMicrosLimit === undefined ? {} : { costMicrosLimit: input.costMicrosLimit }),
      });
      await store.save(task);

      try {
        const sandbox = await createAiSandbox({
          userDataDirectory: options.userDataDirectory,
          taskId: task.id,
          workspaceRoot: root,
          now: createdAt,
        });
        runtimeCleanups.set(task.id, sandbox.cleanup);
        if (policy !== undefined) {
          const bytes = await directorySize(
            join(options.userDataDirectory, "ai-workspaces", "sandboxes"),
          );
          if (bytes > policy.quotaBytes) {
            await sandbox.cleanup();
            runtimeCleanups.delete(task.id);
            throw new Error("This project is larger than the AI workspace storage quota.");
          }
        }
        task = transitionTask({ ...task, sandbox: sandbox.record }, "ready", now());
        await store.save(task);
        await trace(task.id, "task", `Created ${sandbox.record.kind} task workspace`, "ok");
        return task;
      } catch (error) {
        task = transitionTask(task, "failed", now());
        await store.save(task);
        await trace(task.id, "error", "Could not create task workspace", "failed", String(error));
        throw error;
      }
    },

    read: (taskId) => store.read(taskId),

    async list(workspaceRoot): Promise<AiWorkspaceTask[]> {
      const root = await import("node:fs/promises").then(({ realpath }) => realpath(workspaceRoot));
      return store.list(workspaceIdentity(root));
    },

    async write(taskId, path, contents): Promise<AiWorkspaceTask> {
      if (typeof contents !== "string") throw new Error("Sandbox contents must be text");
      const task = await required(taskId);
      if (task.sandbox === null) throw new Error("Task sandbox is unavailable");
      const portable = createFileChange(path, null, contents).path;
      const humanPath = await resolveSandboxPath(task.workspaceRoot, portable);
      const isolatedPath = await resolveSandboxPath(sandboxRoot(options.userDataDirectory, task.id), portable);
      const previous = task.changes.find((change) => change.path === portable);
      const original = previous?.original ?? (await readMaybe(humanPath));
      const change = createFileChange(portable, original, contents);

      await writeAtomic(isolatedPath, contents);
      const changes = [...task.changes.filter((item) => item.path !== portable), change].sort((a, b) =>
        a.path.localeCompare(b.path),
      );
      const updated = updateForReview(task, changes, now());
      await store.save(updated);
      await trace(task.id, "file-change", `Proposed ${portable}`, "ok");
      return updated;
    },

    async readSandboxFile(taskId, path): Promise<string> {
      const task = await required(taskId);
      if (task.sandbox === null) throw new Error("Task sandbox is unavailable");
      const target = await resolveSandboxPath(sandboxRoot(options.userDataDirectory, task.id), path);
      return readFile(target, "utf8");
    },

    async pause(taskId): Promise<AiWorkspaceTask | null> {
      let task = await store.read(taskId);
      if (task === null) return null;
      if (task.state === "ready" || task.state === "running") {
        task = transitionTask(task, "paused", now());
        await store.save(task);
        await trace(task.id, "state", "Paused task workspace", "ok");
      }
      return task;
    },

    async reserveUsage(taskId, usage): Promise<AiWorkspaceBudgetResult> {
      let task = await required(taskId);
      const reservation = canReserveUsage(task.budget, usage);
      if (!reservation.ok) {
        if (task.state === "ready" || task.state === "running" || task.state === "review") {
          task = transitionTask(task, "paused", now());
          await store.save(task);
        }
        await trace(
          task.id,
          "budget",
          reservation.reason === "token-limit" ? "Token budget reached" : "Cost budget reached",
          "blocked",
        );
        return { ok: false, task, reason: reservation.reason };
      }

      task = { ...task, budget: addUsage(task.budget, usage), updatedAt: now() };
      await store.save(task);
      await trace(task.id, "budget", `Reserved ${String(usage.tokens)} tokens`, "ok");
      return { ok: true, task, reason: null };
    },

    async apply(taskId, selections): Promise<AiWorkspaceActionResult> {
      let task = await required(taskId);
      const refuse = (message: string, conflicts: readonly string[] = []): AiWorkspaceActionResult => ({
        ok: false,
        task,
        conflicts,
        message,
      });
      if (task.state !== "review") return refuse(`Task is ${task.state}, not ready for review apply.`);
      if (selections.length === 0) return refuse("Select at least one reviewed change.");

      const selected: Array<{ change: AiFileChange; contents: string; humanPath: string }> = [];
      const seen = new Set<string>();
      for (const selection of selections) {
        const portable = createFileChange(selection.path, null, "").path;
        if (seen.has(portable)) return refuse(`Duplicate selected path: ${portable}`);
        seen.add(portable);
        const change = task.changes.find((item) => item.path === portable);
        if (change === undefined) return refuse(`That change is no longer available: ${portable}`);

        let contents: string;
        if ("acceptedHunkIds" in selection) {
          const hunks = computeHunks(change.original ?? "", change.proposed);
          const allowed = new Set(hunks.map((hunk) => hunk.id));
          if (
            selection.acceptedHunkIds.length === 0 ||
            selection.acceptedHunkIds.some((hunkId) => !allowed.has(hunkId))
          ) {
            return refuse(`Invalid hunk selection for ${portable}`);
          }
          contents = applyHunks(change.original ?? "", hunks, selection.acceptedHunkIds);
        } else {
          if (selection.contents !== change.proposed) return refuse(`Unreviewed contents for ${portable}`);
          contents = selection.contents;
        }
        selected.push({ change, contents, humanPath: await resolveSandboxPath(task.workspaceRoot, portable) });
      }

      const conflicts: string[] = [];
      for (const item of selected) {
        if ((await readMaybe(item.humanPath)) !== item.change.original) conflicts.push(item.change.path);
      }
      if (conflicts.length > 0) {
        task = transitionTask(task, "conflict", now());
        await store.save(task);
        await trace(task.id, "apply", "Apply blocked by overlapping human changes", "blocked", conflicts.join(", "));
        return { ok: false, task, conflicts, message: "Human changes overlap this task. Nothing was applied." };
      }

      const existingManifest = task.checkpoint === null ? null : await readManifest(task);
      const checkpointId = task.checkpoint?.id ?? id("checkpoint");
      if (!CHECKPOINT_ID.test(checkpointId)) throw new Error("Invalid generated checkpoint id");
      const checkpointPaths = [
        ...new Set([...(task.checkpoint?.paths ?? []), ...selected.map((item) => item.change.path)]),
      ];
      const checkpoint: AiCheckpointSummary = {
        id: checkpointId,
        createdAt: task.checkpoint?.createdAt ?? now(),
        appliedAt: null,
        paths: checkpointPaths,
      };
      const selectedEntries = new Map(
        selected.map((item) => [
          item.change.path,
          {
            path: item.change.path,
            original: item.change.original,
            applied: item.contents,
            appliedHash: hash(item.contents),
          } satisfies CheckpointEntry,
        ]),
      );
      const priorEntries = (existingManifest?.entries ?? []).map((entry) => {
        const replacement = selectedEntries.get(entry.path);
        if (replacement === undefined) return entry;
        selectedEntries.delete(entry.path);
        // A later accepted edit to the same file updates the applied side while retaining
        // the pre-task original required for whole-task rollback.
        return { ...replacement, original: entry.original };
      });
      const manifest: CheckpointManifest = {
        id: checkpointId,
        taskId: task.id,
        workspaceRoot: task.workspaceRoot,
        createdAt: checkpoint.createdAt,
        entries: [...priorEntries, ...selectedEntries.values()],
      };

      task = transitionTask({ ...task, checkpoint }, "applying", now());
      await store.save(task);
      await writeManifest(manifest);
      await trace(task.id, "checkpoint", `Checkpointed ${selected.length} file(s)`, "ok");

      const written: typeof selected = [];
      try {
        for (const item of selected) {
          await writeAtomic(item.humanPath, item.contents);
          written.push(item);
        }
      } catch (error) {
        for (const item of written.reverse()) {
          if (item.change.original === null) await rm(item.humanPath, { force: true });
          else await writeAtomic(item.humanPath, item.change.original);
        }
        task = transitionTask(task, "failed", now());
        await store.save(task);
        await trace(task.id, "apply", "Apply failed and was restored", "failed", String(error));
        return { ok: false, task, conflicts: [], message: "Apply failed; files were restored from checkpoint." };
      }

      const appliedAt = now();
      const acceptedPaths = new Set(selected.map((item) => item.change.path));
      const remainingChanges = task.changes.filter((change) => !acceptedPaths.has(change.path));
      const nextState = remainingChanges.length === 0 ? "applied" : "review";
      task = transitionTask(
        {
          ...task,
          changes: remainingChanges,
          checkpoint: { ...checkpoint, appliedAt: nextState === "applied" ? appliedAt : null },
        },
        nextState,
        appliedAt,
      );
      await store.save(task);
      await trace(task.id, "apply", `Applied ${selected.length} reviewed file(s)`, "ok");
      return { ok: true, task, conflicts: [], message: "Reviewed changes applied." };
    },

    async reject(taskId, path): Promise<AiWorkspaceTask> {
      let task = await required(taskId);
      if (task.state !== "review") throw new Error(`Task is ${task.state}, not awaiting review`);
      const portable = createFileChange(path, null, "").path;
      const change = task.changes.find((item) => item.path === portable);
      if (change === undefined) throw new Error("That task change was not found");
      const isolatedPath = await resolveSandboxPath(sandboxRoot(options.userDataDirectory, task.id), portable);
      if (change.original === null) await rm(isolatedPath, { force: true });
      else await writeAtomic(isolatedPath, change.original);

      const changes = task.changes.filter((item) => item.path !== portable);
      let nextState: "review" | "paused" | "applied" = "review";
      if (changes.length === 0) nextState = task.checkpoint === null ? "paused" : "applied";
      task =
        nextState === "review"
          ? { ...task, changes, updatedAt: now() }
          : transitionTask(
              {
                ...task,
                changes,
                checkpoint:
                  nextState === "applied" && task.checkpoint !== null
                    ? { ...task.checkpoint, appliedAt: now() }
                    : task.checkpoint,
              },
              nextState,
              now(),
            );
      await store.save(task);
      await trace(task.id, "file-change", `Rejected ${portable}`, "ok");
      return task;
    },

    async discard(taskId): Promise<AiWorkspaceTask | null> {
      let task = await store.read(taskId);
      if (task === null) return null;
      if (task.state === "discarded") return task;
      task = transitionTask(task, "discarded", now());
      await store.save(task);
      await removeTaskSandbox(task);
      await trace(task.id, "state", "Discarded task workspace", "ok");
      return task;
    },

    async rollback(taskId): Promise<AiWorkspaceActionResult> {
      let task = await required(taskId);
      const refuse = (message: string, conflicts: readonly string[] = []): AiWorkspaceActionResult => ({
        ok: false,
        task,
        conflicts,
        message,
      });
      if (task.state !== "applied") return refuse(`Task is ${task.state}, not applied.`);

      const manifest = await readManifest(task);
      task = transitionTask(task, "rolling-back", now());
      await store.save(task);

      const resolved = await Promise.all(
        manifest.entries.map(async (entry) => ({
          entry,
          humanPath: await resolveSandboxPath(task.workspaceRoot, entry.path),
        })),
      );
      const conflicts: string[] = [];
      for (const item of resolved) {
        const current = await readMaybe(item.humanPath);
        if (current === null || hash(current) !== item.entry.appliedHash) conflicts.push(item.entry.path);
      }
      if (conflicts.length > 0) {
        task = transitionTask(task, "conflict", now());
        await store.save(task);
        await trace(task.id, "rollback", "Rollback blocked by later human changes", "blocked", conflicts.join(", "));
        return { ok: false, task, conflicts, message: "Later human changes were preserved. Nothing was rolled back." };
      }

      const restored: typeof resolved = [];
      try {
        for (const item of resolved) {
          if (item.entry.original === null) await rm(item.humanPath, { force: true });
          else await writeAtomic(item.humanPath, item.entry.original);
          restored.push(item);
        }
      } catch (error) {
        // Put already-restored files back into their applied state. The manifest was
        // durable before the original apply and contains both versions, so an interrupted
        // rollback does not have to leave a half-old, half-new project.
        for (const item of restored.reverse()) {
          try {
            await writeAtomic(item.humanPath, item.entry.applied);
          } catch {
            // Preserve the original error below. The checkpoint remains on disk for a
            // manual recovery even if the filesystem refuses both directions.
          }
        }
        task = transitionTask(task, "failed", now());
        await store.save(task);
        await trace(task.id, "rollback", "Rollback failed", "failed", String(error));
        return { ok: false, task, conflicts: [], message: "Rollback could not be completed." };
      }

      task = transitionTask(task, "rolled-back", now());
      await store.save(task);
      await trace(task.id, "rollback", `Rolled back ${resolved.length} file(s)`, "ok");
      return { ok: true, task, conflicts: [], message: "AI changes rolled back." };
    },

    traces: (taskId) => store.traces(taskId),
    recoverActive: () => store.recoverActive(now()),
    maintainStorage,
  };
}

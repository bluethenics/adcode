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
  type AiReviewPolicy,
  type AiWorkspaceTask,
  type OperationalTrace,
  type AiUsage,
} from "@adcode/ai";
import {
  createAiSandbox,
  removeAiSandbox,
  resolveSandboxPath,
  type AiSandboxSource,
} from "./aiSandbox.ts";
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

export type AiWorkspaceTraceInput = Pick<
  OperationalTrace,
  "kind" | "summary" | "detail" | "outcome"
>;

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
  /** Compatibility name: includes task sandboxes and retained immutable Team bases. */
  readonly totalSandboxBytes: number;
  readonly removedTaskIds: readonly string[];
}

export interface StartAiWorkspaceInput {
  readonly workspaceRoot: string;
  readonly prompt: string;
  /** Review is the safe default. Trusted remains isolated and checkpointed. */
  readonly reviewPolicy?: AiReviewPolicy;
  readonly tokenLimit?: number;
  readonly costMicrosLimit?: number;
  /** Main-process-only Team ownership. Role tasks set reviewable false; combined reviews true. */
  readonly parentTeamId?: string;
  readonly reviewable?: boolean;
  /** Main-process-only immutable Team base. Never accepted from renderer IPC. */
  readonly sandboxSource?: AiSandboxSource;
  /** Bytes held by the immutable Team base that count against the same sandbox quota. */
  readonly reservedStorageBytes?: number;
}

export interface AiWorkspaceService {
  start(input: StartAiWorkspaceInput): Promise<AiWorkspaceTask>;
  read(taskId: string): Promise<AiWorkspaceTask | null>;
  list(workspaceRoot: string): Promise<AiWorkspaceTask[]>;
  write(taskId: string, path: string, contents: string): Promise<AiWorkspaceTask>;
  /** Main-process Team merge path: retain the immutable sandbox base, not the later human file. */
  writeFromSandboxBase(taskId: string, path: string, contents: string): Promise<AiWorkspaceTask>;
  /** Import a pure Team merge only when its claimed base matches the combined sandbox. */
  importChange(taskId: string, change: AiFileChange): Promise<AiWorkspaceTask>;
  readSandboxFile(taskId: string, path: string): Promise<string>;
  pause(taskId: string): Promise<AiWorkspaceTask | null>;
  reserveUsage(taskId: string, usage: AiUsage): Promise<AiWorkspaceBudgetResult>;
  apply(taskId: string, selections: readonly ApplySelection[]): Promise<AiWorkspaceActionResult>;
  /** Apply every exact proposal only when this task was explicitly created as trusted. */
  applyTrusted(taskId: string): Promise<AiWorkspaceActionResult>;
  reject(taskId: string, path: string): Promise<AiWorkspaceTask>;
  discard(taskId: string): Promise<AiWorkspaceTask | null>;
  rollback(taskId: string): Promise<AiWorkspaceActionResult>;
  traces(taskId: string): Promise<OperationalTrace[]>;
  recordTrace(taskId: string, input: AiWorkspaceTraceInput): Promise<void>;
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

  async function recoveryConflict(task: AiWorkspaceTask, detail: string): Promise<AiWorkspaceTask> {
    const conflicted = transitionTask(task, "conflict", Math.max(now(), task.updatedAt));
    await store.save(conflicted);
    await trace(task.id, "checkpoint", "Interrupted file transaction needs review", "blocked", detail);
    return conflicted;
  }

  async function recoverTransaction(task: AiWorkspaceTask): Promise<AiWorkspaceTask> {
    let manifest: CheckpointManifest;
    try {
      manifest = await readManifest(task);
    } catch (error) {
      return recoveryConflict(
        task,
        error instanceof Error ? error.message : "rollback checkpoint is unavailable",
      );
    }
    if (manifest.taskId !== task.id || manifest.workspaceRoot !== task.workspaceRoot) {
      return recoveryConflict(task, "rollback checkpoint does not belong to this task");
    }

    const resolved = await Promise.all(
      manifest.entries.map(async (entry) => ({
        entry,
        humanPath: await resolveSandboxPath(task.workspaceRoot, entry.path),
        current: await readMaybe(await resolveSandboxPath(task.workspaceRoot, entry.path)),
      })),
    );
    const known = resolved.every(
      ({ entry, current }) => current === entry.original || current === entry.applied,
    );
    if (!known) {
      return recoveryConflict(task, "workspace contains changes newer than the interrupted transaction");
    }

    if (task.state === "applying") {
      const pendingPaths = new Set(task.changes.map((change) => change.path));
      const selected = resolved.filter(({ entry }) => pendingPaths.has(entry.path));
      const prior = resolved.filter(({ entry }) => !pendingPaths.has(entry.path));
      if (prior.some(({ entry, current }) => current !== entry.applied)) {
        return recoveryConflict(task, "an earlier accepted file no longer matches its checkpoint");
      }
      try {
        for (const { entry, humanPath } of selected) {
          if (entry.original === null) await rm(humanPath, { force: true });
          else await writeAtomic(humanPath, entry.original);
        }
      } catch (error) {
        return recoveryConflict(
          task,
          error instanceof Error ? error.message : "could not restore interrupted apply",
        );
      }

      const checkpoint =
        prior.length === 0
          ? null
          : {
              id: manifest.id,
              createdAt: manifest.createdAt,
              appliedAt: null,
              paths: prior.map(({ entry }) => entry.path),
            } satisfies AiCheckpointSummary;
      if (checkpoint === null) {
        await rm(dirname(checkpointPath(task.id, manifest.id)), { recursive: true, force: true });
      } else {
        await writeManifest({ ...manifest, entries: prior.map(({ entry }) => entry) });
      }
      const recovered = transitionTask(
        { ...task, checkpoint },
        "review",
        Math.max(now(), task.updatedAt),
      );
      await store.save(recovered);
      await trace(task.id, "checkpoint", "Restored interrupted apply for review", "ok");
      return recovered;
    }

    try {
      for (const { entry, humanPath } of resolved) {
        if (entry.original === null) await rm(humanPath, { force: true });
        else await writeAtomic(humanPath, entry.original);
      }
    } catch (error) {
      return recoveryConflict(
        task,
        error instanceof Error ? error.message : "could not finish interrupted rollback",
      );
    }
    const recovered = transitionTask(task, "rolled-back", Math.max(now(), task.updatedAt));
    await store.save(recovered);
    await trace(task.id, "checkpoint", "Finished interrupted rollback", "ok");
    return recovered;
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

  /** Team records and traces are history; only retained immutable `base` folders use quota. */
  async function teamBaseStorageBytes(): Promise<number> {
    const teamsRoot = join(options.userDataDirectory, "ai-teams");
    try {
      const teams = await readdir(teamsRoot, { withFileTypes: true });
      let bytes = 0;
      for (const team of teams) {
        if (!team.isDirectory() || team.isSymbolicLink()) continue;
        const base = join(teamsRoot, team.name, "base");
        try {
          const info = await lstat(base);
          if (!info.isDirectory() || info.isSymbolicLink()) continue;
          bytes += await directorySize(base);
        } catch {
          // Most completed Teams have no retained base.
        }
      }
      return bytes;
    } catch {
      return 0;
    }
  }

  async function maintainStorage(
    policy: AiWorkspaceStoragePolicy,
    minimumTeamBaseBytes = 0,
  ): Promise<AiWorkspaceMaintenanceResult> {
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
    const storageBytes = async (): Promise<number> => {
      const [sandboxBytes, retainedTeamBytes] = await Promise.all([
        directorySize(sandboxes),
        teamBaseStorageBytes(),
      ]);
      return sandboxBytes + Math.max(retainedTeamBytes, minimumTeamBaseBytes);
    };
    let totalSandboxBytes = await storageBytes();
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
          totalSandboxBytes = await storageBytes();
        } catch {
          // Try the next eligible task; active work and checkpoints remain untouched.
        }
      }
    }

    return { ok: totalSandboxBytes <= policy.quotaBytes, totalSandboxBytes, removedTaskIds };
  }

  async function writeProposal(
    taskId: string,
    path: string,
    contents: string,
    baseline: "human" | "sandbox",
  ): Promise<AiWorkspaceTask> {
    if (typeof contents !== "string") throw new Error("Sandbox contents must be text");
    const task = await required(taskId);
    if (task.sandbox === null) throw new Error("Task sandbox is unavailable");
    const portable = createFileChange(path, null, contents).path;
    const humanPath = await resolveSandboxPath(task.workspaceRoot, portable);
    const isolatedPath = await resolveSandboxPath(sandboxRoot(options.userDataDirectory, task.id), portable);
    const previous = task.changes.find((change) => change.path === portable);
    const original =
      previous === undefined
        ? await readMaybe(baseline === "human" ? humanPath : isolatedPath)
        : previous.original;
    const change = createFileChange(portable, original, contents);

    await writeAtomic(isolatedPath, contents);
    const changes = [...task.changes.filter((item) => item.path !== portable), change].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
    const updated = updateForReview(task, changes, now());
    await store.save(updated);
    await trace(task.id, "file-change", `Proposed ${portable}`, "ok");
    return updated;
  }

  const api: AiWorkspaceService = {
    async start(input): Promise<AiWorkspaceTask> {
      const policy = options.storagePolicy?.();
      const reservedStorageBytes = input.reservedStorageBytes ?? 0;
      if (!Number.isSafeInteger(reservedStorageBytes) || reservedStorageBytes < 0) {
        throw new Error("Invalid reserved AI workspace storage");
      }
      if (policy !== undefined && reservedStorageBytes >= policy.quotaBytes) {
        throw new Error("The Team base uses the entire AI workspace storage quota.");
      }
      if (policy !== undefined && !(await maintainStorage(policy, reservedStorageBytes)).ok) {
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
        ...(input.parentTeamId === undefined ? {} : { parentTeamId: input.parentTeamId }),
        ...(input.reviewable === undefined ? {} : { reviewable: input.reviewable }),
        ...(input.reviewPolicy === undefined ? {} : { reviewPolicy: input.reviewPolicy }),
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
          ...(input.sandboxSource === undefined ? {} : { source: input.sandboxSource }),
        });
        runtimeCleanups.set(task.id, sandbox.cleanup);
        if (policy !== undefined) {
          const [sandboxBytes, retainedTeamBytes] = await Promise.all([
            directorySize(join(options.userDataDirectory, "ai-workspaces", "sandboxes")),
            teamBaseStorageBytes(),
          ]);
          if (
            sandboxBytes + Math.max(retainedTeamBytes, reservedStorageBytes) >
            policy.quotaBytes
          ) {
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
      return (await store.list(workspaceIdentity(root))).filter((task) => task.reviewable);
    },

    write: (taskId, path, contents) => writeProposal(taskId, path, contents, "human"),
    writeFromSandboxBase: (taskId, path, contents) =>
      writeProposal(taskId, path, contents, "sandbox"),
    async importChange(taskId, input): Promise<AiWorkspaceTask> {
      const change = createFileChange(input.path, input.original, input.proposed);
      const task = await required(taskId);
      if (task.sandbox === null) throw new Error("Task sandbox is unavailable");
      const isolatedPath = await resolveSandboxPath(
        sandboxRoot(options.userDataDirectory, task.id),
        change.path,
      );
      if ((await readMaybe(isolatedPath)) !== change.original) {
        throw new Error(`Team merge base changed for ${change.path}`);
      }
      return writeProposal(taskId, change.path, change.proposed, "sandbox");
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

    async applyTrusted(taskId): Promise<AiWorkspaceActionResult> {
      const task = await required(taskId);
      if (task.reviewPolicy !== "trusted") {
        return {
          ok: false,
          task,
          conflicts: [],
          message: "This task requires human review before apply.",
        };
      }
      if (task.state !== "review" || task.changes.length === 0) {
        return {
          ok: false,
          task,
          conflicts: [],
          message: `Trusted task is ${task.state}, not ready to apply.`,
        };
      }
      const result = await api.apply(
        taskId,
        task.changes.map((change) => ({ path: change.path, contents: change.proposed })),
      );
      if (result.ok) {
        await trace(task.id, "apply", `Trusted mode auto-applied ${String(task.changes.length)} file(s)`, "ok");
        return { ...result, message: "Trusted changes applied with a rollback checkpoint." };
      }
      return result;
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
      if (task.checkpoint !== null) {
        throw new Error("Task has a rollback checkpoint; roll it back before discarding.");
      }
      if (task.state !== "discarded") {
        task = transitionTask(task, "discarded", now());
        await store.save(task);
      }
      await removeTaskSandbox(task);
      task = { ...task, sandbox: null, updatedAt: Math.max(now(), task.updatedAt) };
      await store.save(task);
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
      if (
        task.state !== "applied" &&
        !(task.state === "review" && task.checkpoint !== null)
      ) {
        return refuse(`Task is ${task.state}, not applied.`);
      }

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

      task = transitionTask({ ...task, changes: [] }, "rolled-back", now());
      await store.save(task);
      await trace(task.id, "rollback", `Rolled back ${resolved.length} file(s)`, "ok");
      return { ok: true, task, conflicts: [], message: "AI changes rolled back." };
    },

    traces: (taskId) => store.traces(taskId),
    async recordTrace(taskId, input): Promise<void> {
      if ((await store.read(taskId)) === null) throw new Error("AI workspace task was not found");
      await trace(taskId, input.kind, input.summary, input.outcome, input.detail);
    },
    async recoverActive(): Promise<AiWorkspaceTask[]> {
      const recovered: AiWorkspaceTask[] = [];
      for (const task of await store.listAll()) {
        if (task.state !== "applying" && task.state !== "rolling-back") continue;
        recovered.push(await recoverTransaction(task));
      }
      recovered.push(...(await store.recoverActive(now())));
      return recovered;
    },
    maintainStorage,
  };
  return api;
}

/**
 * Durable local persistence for AI workspace tasks and operational traces.
 *
 * Electron is intentionally absent: supplying userData is the caller's responsibility,
 * which keeps crash and corruption behavior testable without launching a window.
 */
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createOperationalTrace,
  transitionTask,
  type AiTaskState,
  type AiWorkspaceTask,
  type OperationalTrace,
} from "@adcode/ai";

const TASK_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const ACTIVE_STATES = new Set<AiTaskState>([
  "preparing",
  "ready",
  "running",
  "applying",
  "rolling-back",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTask(value: unknown): value is AiWorkspaceTask {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    TASK_ID.test(value["id"]) &&
    typeof value["workspaceId"] === "string" &&
    typeof value["prompt"] === "string" &&
    typeof value["state"] === "string" &&
    typeof value["createdAt"] === "number" &&
    typeof value["updatedAt"] === "number" &&
    isRecord(value["permissions"]) &&
    isRecord(value["budget"]) &&
    Array.isArray(value["changes"])
  );
}

export interface AiWorkspaceStore {
  save(task: AiWorkspaceTask): Promise<void>;
  read(id: string): Promise<AiWorkspaceTask | null>;
  list(workspaceId: string): Promise<AiWorkspaceTask[]>;
  recoverActive(now: number): Promise<AiWorkspaceTask[]>;
  appendTrace(event: OperationalTrace): Promise<void>;
  traces(taskId: string): Promise<OperationalTrace[]>;
}

export function createAiWorkspaceStore(userDataDirectory: string): AiWorkspaceStore {
  const tasksRoot = join(userDataDirectory, "ai-workspaces", "tasks");
  const taskFolder = (id: string): string => join(tasksRoot, id);
  const taskFile = (id: string): string => join(taskFolder(id), "task.json");

  async function save(task: AiWorkspaceTask): Promise<void> {
    if (!TASK_ID.test(task.id)) throw new Error("Invalid task id");
    const folder = taskFolder(task.id);
    const target = taskFile(task.id);
    const temporary = `${target}.tmp`;
    await mkdir(folder, { recursive: true });
    await writeFile(temporary, JSON.stringify(task, null, 2), "utf8");
    await rename(temporary, target);
  }

  async function read(id: string): Promise<AiWorkspaceTask | null> {
    if (!TASK_ID.test(id)) return null;
    try {
      const parsed: unknown = JSON.parse(await readFile(taskFile(id), "utf8"));
      return isTask(parsed) && parsed.id === id ? parsed : null;
    } catch {
      return null;
    }
  }

  async function all(): Promise<AiWorkspaceTask[]> {
    try {
      const names = await readdir(tasksRoot);
      const found = await Promise.all(names.filter((name) => TASK_ID.test(name)).map(read));
      return found.filter((task): task is AiWorkspaceTask => task !== null);
    } catch {
      return [];
    }
  }

  return {
    save,
    read,

    async list(workspaceId): Promise<AiWorkspaceTask[]> {
      return (await all())
        .filter((task) => task.workspaceId === workspaceId)
        .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt);
    },

    async recoverActive(now): Promise<AiWorkspaceTask[]> {
      const recovered: AiWorkspaceTask[] = [];
      for (const task of await all()) {
        if (!ACTIVE_STATES.has(task.state)) continue;
        const paused = transitionTask(task, "paused", Math.max(now, task.updatedAt));
        await save(paused);
        recovered.push(paused);
      }
      return recovered;
    },

    async appendTrace(event): Promise<void> {
      if (!TASK_ID.test(event.taskId)) throw new Error("Invalid task id");
      const validated = createOperationalTrace(event);
      const folder = taskFolder(event.taskId);
      await mkdir(folder, { recursive: true });
      await appendFile(join(folder, "trace.jsonl"), `${JSON.stringify(validated)}\n`, "utf8");
    },

    async traces(taskId): Promise<OperationalTrace[]> {
      if (!TASK_ID.test(taskId)) return [];
      try {
        const lines = (await readFile(join(taskFolder(taskId), "trace.jsonl"), "utf8")).split("\n");
        const events: OperationalTrace[] = [];
        for (const line of lines) {
          if (line.trim().length === 0) continue;
          try {
            const parsed: unknown = JSON.parse(line);
            if (!isRecord(parsed)) continue;
            events.push(createOperationalTrace(parsed as unknown as OperationalTrace));
          } catch {
            // Append-only logs can end with one partial record after a crash. Earlier
            // complete events remain useful and authoritative.
          }
        }
        return events;
      } catch {
        return [];
      }
    },
  };
}

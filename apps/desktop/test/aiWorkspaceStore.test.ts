import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAiWorkspaceTask,
  transitionTask,
  type AiWorkspaceTask,
  type OperationalTrace,
} from "@adcode/ai";
import { createAiWorkspaceStore } from "../src/main/aiWorkspaceStore.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "adcode-ai-workspaces-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const makeTask = (id = "task-alpha", workspaceId = "workspace-one"): AiWorkspaceTask =>
  createAiWorkspaceTask({ id, workspaceId, workspaceRoot: "C:/project", prompt: "Fix the parser", now: 1_000 });

describe("AI workspace task persistence", () => {
  it("writes atomically and survives a new store instance", async () => {
    const first = createAiWorkspaceStore(directory);
    await first.save(makeTask());

    const second = createAiWorkspaceStore(directory);
    await expect(second.read("task-alpha")).resolves.toEqual(makeTask());

    const names = await readdir(join(directory, "ai-workspaces", "tasks", "task-alpha"));
    expect(names).toContain("task.json");
    expect(names).not.toContain("task.json.tmp");
  });

  it("migrates tasks saved before edit approval existed to safe review mode", async () => {
    const store = createAiWorkspaceStore(directory);
    await store.save(makeTask());
    const path = join(directory, "ai-workspaces", "tasks", "task-alpha", "task.json");
    const legacy = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    delete legacy["reviewPolicy"];
    await writeFile(path, JSON.stringify(legacy), "utf8");

    expect((await createAiWorkspaceStore(directory).read("task-alpha"))?.reviewPolicy).toBe("review");
  });

  it("lists only the requested workspace, newest first", async () => {
    const store = createAiWorkspaceStore(directory);
    await store.save(makeTask("task-old", "workspace-one"));
    await store.save(
      createAiWorkspaceTask({
        id: "task-new",
        workspaceId: "workspace-one",
        workspaceRoot: "C:/project",
        prompt: "Newer",
        now: 2_000,
      }),
    );
    await store.save(makeTask("task-other", "workspace-two"));

    expect((await store.list("workspace-one")).map((task) => task.id)).toEqual([
      "task-new",
      "task-old",
    ]);
  });

  it("isolates corrupt records instead of losing valid tasks", async () => {
    const store = createAiWorkspaceStore(directory);
    await store.save(makeTask());
    const corrupt = join(directory, "ai-workspaces", "tasks", "task-corrupt");
    await mkdir(corrupt, { recursive: true });
    await writeFile(join(corrupt, "task.json"), "{broken", "utf8");

    expect((await store.list("workspace-one")).map((task) => task.id)).toEqual(["task-alpha"]);
    await expect(store.read("task-corrupt")).resolves.toBeNull();
  });

  it("recovers in-flight work as paused and persists that decision", async () => {
    const store = createAiWorkspaceStore(directory);
    const running = transitionTask(transitionTask(makeTask(), "ready", 1_001), "running", 1_002);
    await store.save(running);

    const recovered = await store.recoverActive(2_000);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.state).toBe("paused");
    expect((await createAiWorkspaceStore(directory).read("task-alpha"))?.state).toBe("paused");
  });

  it("refuses unsafe task ids before joining paths", async () => {
    const store = createAiWorkspaceStore(directory);
    await expect(store.read("../settings")).resolves.toBeNull();
    await expect(store.traces("C:\\outside")).resolves.toEqual([]);
  });
});

describe("append-only operational traces", () => {
  const trace = (id: string, at: number): OperationalTrace => ({
    id,
    taskId: "task-alpha",
    at,
    kind: "state",
    summary: `State ${id}`,
    detail: "",
    outcome: "ok",
  });

  it("appends and reads traces in event order", async () => {
    const store = createAiWorkspaceStore(directory);
    await store.save(makeTask());
    await store.appendTrace(trace("one", 1));
    await store.appendTrace(trace("two", 2));

    expect((await store.traces("task-alpha")).map((event) => event.id)).toEqual(["one", "two"]);
  });

  it("keeps valid events when the final JSONL record was truncated by a crash", async () => {
    const store = createAiWorkspaceStore(directory);
    await store.save(makeTask());
    await store.appendTrace(trace("one", 1));

    const path = join(directory, "ai-workspaces", "tasks", "task-alpha", "trace.jsonl");
    await writeFile(path, `${await readFile(path, "utf8")}{\"id\":`, "utf8");

    expect((await store.traces("task-alpha")).map((event) => event.id)).toEqual(["one"]);
  });
});

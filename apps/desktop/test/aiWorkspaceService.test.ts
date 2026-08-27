import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeHunks } from "@adcode/ai";
import { createAiWorkspaceService } from "../src/main/aiWorkspaceService.ts";

let project: string;
let userData: string;
let sequence: number;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "adcode-service-project-"));
  userData = await mkdtemp(join(tmpdir(), "adcode-service-user-data-"));
  sequence = 0;
  await writeFile(join(project, "one.txt"), "one before\n", "utf8");
  await writeFile(join(project, "two.txt"), "two before\n", "utf8");
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
});

function service() {
  return createAiWorkspaceService({
    userDataDirectory: userData,
    now: () => 10_000 + sequence,
    id: (prefix) => `${prefix}-${String(++sequence).padStart(4, "0")}`,
  });
}

describe("safe AI workspace service", () => {
  it("starts a durable isolated task without changing the human project", async () => {
    const created = await service().start({ workspaceRoot: project, prompt: "Edit one" });

    expect(created.state).toBe("ready");
    expect(created.sandbox?.kind).toBe("shadow-copy");
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one before\n");
    expect((await service().read(created.id))?.id).toBe(created.id);
  });

  it("writes proposals only in the sandbox and lists them for review", async () => {
    const api = service();
    const task = await api.start({ workspaceRoot: project, prompt: "Edit one" });
    const changed = await api.write(task.id, "one.txt", "one proposed\n");

    expect(changed.state).toBe("review");
    expect(changed.changes).toEqual([
      { path: "one.txt", original: "one before\n", proposed: "one proposed\n" },
    ]);
    expect(await api.readSandboxFile(task.id, "one.txt")).toBe("one proposed\n");
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one before\n");
  });

  it("pauses without deleting the durable sandbox", async () => {
    const api = service();
    const task = await api.start({ workspaceRoot: project, prompt: "Pause me" });

    expect((await api.pause(task.id))?.state).toBe("paused");
    expect(await api.readSandboxFile(task.id, "one.txt")).toBe("one before\n");
  });

  it("creates a durable checkpoint before applying selected files", async () => {
    const api = service();
    const task = await api.start({ workspaceRoot: project, prompt: "Edit one" });
    await api.write(task.id, "one.txt", "one proposed\n");

    const result = await api.apply(task.id, [{ path: "one.txt", contents: "one proposed\n" }]);

    expect(result.ok).toBe(true);
    expect(result.task.state).toBe("applied");
    expect(result.task.checkpoint?.paths).toEqual(["one.txt"]);
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one proposed\n");
    const manifest = join(
      userData,
      "ai-workspaces",
      "tasks",
      task.id,
      "checkpoints",
      result.task.checkpoint!.id,
      "manifest.json",
    );
    await expect(access(manifest)).resolves.toBeUndefined();
  });

  it("applies only reviewed hunk ids and rejects invented ids", async () => {
    const api = service();
    await writeFile(join(project, "one.txt"), "alpha\nbeta\ngamma\n", "utf8");
    const task = await api.start({ workspaceRoot: project, prompt: "Edit two regions" });
    const proposed = "ALPHA\nbeta\nGAMMA\n";
    await api.write(task.id, "one.txt", proposed);
    const hunks = computeHunks("alpha\nbeta\ngamma\n", proposed);

    expect(hunks.length).toBeGreaterThan(0);
    expect(
      (await api.apply(task.id, [{ path: "one.txt", acceptedHunkIds: ["invented"] }])).ok,
    ).toBe(false);

    const result = await api.apply(task.id, [
      { path: "one.txt", acceptedHunkIds: [hunks[0]!.id] },
    ]);
    expect(result.ok).toBe(true);
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe(
      hunks.length === 1 ? proposed : "ALPHA\nbeta\ngamma\n",
    );
  });

  it("accepts files one at a time while keeping one whole-task rollback checkpoint", async () => {
    const api = service();
    const task = await api.start({ workspaceRoot: project, prompt: "Review separately" });
    await api.write(task.id, "one.txt", "one proposed\n");
    await api.write(task.id, "two.txt", "two proposed\n");

    const first = await api.apply(task.id, [{ path: "one.txt", contents: "one proposed\n" }]);
    expect(first.task.state).toBe("review");
    expect(first.task.changes.map((change) => change.path)).toEqual(["two.txt"]);
    const second = await api.apply(task.id, [{ path: "two.txt", contents: "two proposed\n" }]);
    expect(second.task.state).toBe("applied");
    expect(second.task.checkpoint?.paths).toEqual(["one.txt", "two.txt"]);

    expect((await api.rollback(task.id)).ok).toBe(true);
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one before\n");
    expect(await readFile(join(project, "two.txt"), "utf8")).toBe("two before\n");
  });

  it("rejects one sandbox proposal without discarding other reviewed work", async () => {
    const api = service();
    const task = await api.start({ workspaceRoot: project, prompt: "Review separately" });
    await api.write(task.id, "one.txt", "one proposed\n");
    await api.write(task.id, "two.txt", "two proposed\n");

    const rejected = await api.reject(task.id, "one.txt");
    expect(rejected.state).toBe("review");
    expect(rejected.changes.map((change) => change.path)).toEqual(["two.txt"]);
    expect(await api.readSandboxFile(task.id, "one.txt")).toBe("one before\n");
    expect(await api.readSandboxFile(task.id, "two.txt")).toBe("two proposed\n");
  });

  it("does not partially apply when any selected file overlaps human work", async () => {
    const api = service();
    const task = await api.start({ workspaceRoot: project, prompt: "Edit both" });
    await api.write(task.id, "one.txt", "one proposed\n");
    await api.write(task.id, "two.txt", "two proposed\n");
    await writeFile(join(project, "two.txt"), "human changed two\n", "utf8");

    const result = await api.apply(task.id, [
      { path: "one.txt", contents: "one proposed\n" },
      { path: "two.txt", contents: "two proposed\n" },
    ]);

    expect(result.ok).toBe(false);
    expect(result.conflicts).toEqual(["two.txt"]);
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one before\n");
    expect(await readFile(join(project, "two.txt"), "utf8")).toBe("human changed two\n");
  });

  it("rejects an empty or altered apply proposal", async () => {
    const api = service();
    const task = await api.start({ workspaceRoot: project, prompt: "Edit one" });
    await api.write(task.id, "one.txt", "one proposed\n");

    expect((await api.apply(task.id, [])).ok).toBe(false);
    expect(
      (await api.apply(task.id, [{ path: "one.txt", contents: "unreviewed surprise" }])).ok,
    ).toBe(false);
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one before\n");
  });

  it("discards sandbox work without touching the human project", async () => {
    const api = service();
    const task = await api.start({ workspaceRoot: project, prompt: "Edit one" });
    await api.write(task.id, "one.txt", "one proposed\n");

    const discarded = await api.discard(task.id);
    expect(discarded?.state).toBe("discarded");
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one before\n");
    await expect(api.readSandboxFile(task.id, "one.txt")).rejects.toThrow();
  });

  it("restores changed files and removes task-created files on rollback", async () => {
    const api = service();
    const task = await api.start({ workspaceRoot: project, prompt: "Edit and add" });
    await api.write(task.id, "one.txt", "one proposed\n");
    await api.write(task.id, "new.txt", "new file\n");
    await api.apply(task.id, [
      { path: "one.txt", contents: "one proposed\n" },
      { path: "new.txt", contents: "new file\n" },
    ]);

    const result = await api.rollback(task.id);
    expect(result.ok).toBe(true);
    expect(result.task.state).toBe("rolled-back");
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one before\n");
    await expect(readFile(join(project, "new.txt"), "utf8")).rejects.toThrow();
  });

  it("refuses rollback rather than losing later human edits", async () => {
    const api = service();
    const task = await api.start({ workspaceRoot: project, prompt: "Edit one" });
    await api.write(task.id, "one.txt", "one proposed\n");
    await api.apply(task.id, [{ path: "one.txt", contents: "one proposed\n" }]);
    await writeFile(join(project, "one.txt"), "human after apply\n", "utf8");

    const result = await api.rollback(task.id);
    expect(result.ok).toBe(false);
    expect(result.conflicts).toEqual(["one.txt"]);
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("human after apply\n");
  });

  it("reopens persisted tasks and traces from a new service instance", async () => {
    const first = service();
    const task = await first.start({ workspaceRoot: project, prompt: "Persist me" });
    await first.write(task.id, "one.txt", "persisted proposal\n");

    const second = service();
    expect((await second.list(project)).map((item) => item.id)).toContain(task.id);
    expect(await second.readSandboxFile(task.id, "one.txt")).toBe("persisted proposal\n");
    expect((await second.traces(task.id)).some((event) => event.kind === "file-change")).toBe(true);
  });
});

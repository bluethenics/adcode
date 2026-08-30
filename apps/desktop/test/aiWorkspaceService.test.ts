import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeHunks, transitionTask } from "@adcode/ai";
import { createAiWorkspaceService } from "../src/main/aiWorkspaceService.ts";
import { createAiWorkspaceStore } from "../src/main/aiWorkspaceStore.ts";

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

  it("reserves a provider request before it can cross the hard task budget", async () => {
    const api = service();
    const task = await api.start({
      workspaceRoot: project,
      prompt: "Stay bounded",
      tokenLimit: 100,
      costMicrosLimit: 1_000,
    });

    const first = await api.reserveUsage(task.id, { tokens: 60, costMicros: 400 });
    const blocked = await api.reserveUsage(task.id, { tokens: 41, costMicros: 1 });

    expect(first.ok).toBe(true);
    expect(first.task.budget.usedTokens).toBe(60);
    expect(blocked).toMatchObject({ ok: false, reason: "token-limit" });
    expect(blocked.task.budget.usedTokens).toBe(60);
    expect((await api.read(task.id))?.budget.usedTokens).toBe(60);
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

  it("auto-applies every exact proposal only for an explicitly trusted task", async () => {
    const api = service();
    const task = await api.start({
      workspaceRoot: project,
      prompt: "Trusted edit",
      reviewPolicy: "trusted",
    });
    await api.write(task.id, "one.txt", "one trusted\n");
    await api.write(task.id, "two.txt", "two trusted\n");

    const result = await api.applyTrusted(task.id);

    expect(result.ok).toBe(true);
    expect(result.task.state).toBe("applied");
    expect(result.task.reviewPolicy).toBe("trusted");
    expect(result.task.checkpoint?.paths).toEqual(["one.txt", "two.txt"]);
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one trusted\n");
    expect(await readFile(join(project, "two.txt"), "utf8")).toBe("two trusted\n");
    expect((await api.rollback(task.id)).ok).toBe(true);
  });

  it("refuses trusted apply for review tasks and preserves overlapping human work", async () => {
    const api = service();
    const review = await api.start({ workspaceRoot: project, prompt: "Review this" });
    await api.write(review.id, "one.txt", "review proposal\n");
    expect((await api.applyTrusted(review.id)).ok).toBe(false);
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one before\n");

    const trusted = await api.start({
      workspaceRoot: project,
      prompt: "Trusted but overlapping",
      reviewPolicy: "trusted",
    });
    await api.write(trusted.id, "two.txt", "trusted proposal\n");
    await writeFile(join(project, "two.txt"), "human changed two\n", "utf8");
    const blocked = await api.applyTrusted(trusted.id);

    expect(blocked.ok).toBe(false);
    expect(blocked.conflicts).toEqual(["two.txt"]);
    expect(await readFile(join(project, "two.txt"), "utf8")).toBe("human changed two\n");
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

  it("preserves and rolls back a checkpoint instead of discarding a partially applied task", async () => {
    const api = service();
    const task = await api.start({ workspaceRoot: project, prompt: "Apply one then cancel" });
    await api.write(task.id, "one.txt", "one proposed\n");
    await api.write(task.id, "two.txt", "two proposed\n");
    const partial = await api.apply(task.id, [
      { path: "one.txt", contents: "one proposed\n" },
    ]);

    expect(partial.task).toMatchObject({ state: "review" });
    expect(partial.task.checkpoint?.paths).toEqual(["one.txt"]);
    await expect(api.discard(task.id)).rejects.toThrow(/rollback checkpoint/i);
    expect((await api.rollback(task.id)).ok).toBe(true);
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one before\n");
    expect((await api.read(task.id))?.changes).toEqual([]);
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

  it("recovers an interrupted multi-file apply back to its reviewable pre-write state", async () => {
    const api = service();
    const created = await api.start({ workspaceRoot: project, prompt: "Crash during apply" });
    let review = await api.write(created.id, "one.txt", "one proposed\n");
    review = await api.write(created.id, "two.txt", "two proposed\n");
    const checkpoint = {
      id: "checkpoint-crash-apply",
      createdAt: 20_000,
      appliedAt: null,
      paths: ["one.txt", "two.txt"],
    } as const;
    await createAiWorkspaceStore(userData).save(
      transitionTask({ ...review, checkpoint }, "applying", 20_001),
    );
    const manifest = join(
      userData,
      "ai-workspaces",
      "tasks",
      created.id,
      "checkpoints",
      checkpoint.id,
      "manifest.json",
    );
    await mkdir(join(manifest, ".."), { recursive: true });
    await writeFile(
      manifest,
      JSON.stringify({
        id: checkpoint.id,
        taskId: created.id,
        workspaceRoot: project,
        createdAt: checkpoint.createdAt,
        entries: [
          {
            path: "one.txt",
            original: "one before\n",
            applied: "one proposed\n",
            appliedHash: createHash("sha256").update("one proposed\n").digest("hex"),
          },
          {
            path: "two.txt",
            original: "two before\n",
            applied: "two proposed\n",
            appliedHash: createHash("sha256").update("two proposed\n").digest("hex"),
          },
        ],
      }),
      "utf8",
    );
    await writeFile(join(project, "one.txt"), "one proposed\n", "utf8");

    const recovered = await service().recoverActive();
    const task = await service().read(created.id);

    expect(recovered.map((item) => item.id)).toContain(created.id);
    expect(task).toMatchObject({ state: "review", checkpoint: null });
    expect(task?.changes.map((change) => change.path)).toEqual(["one.txt", "two.txt"]);
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one before\n");
    expect(await readFile(join(project, "two.txt"), "utf8")).toBe("two before\n");
  });

  it("finishes an interrupted rollback without overwriting an unknown human change", async () => {
    const api = service();
    const created = await api.start({ workspaceRoot: project, prompt: "Crash during rollback" });
    await api.write(created.id, "one.txt", "one proposed\n");
    await api.write(created.id, "two.txt", "two proposed\n");
    const applied = (
      await api.apply(created.id, [
        { path: "one.txt", contents: "one proposed\n" },
        { path: "two.txt", contents: "two proposed\n" },
      ])
    ).task;
    await createAiWorkspaceStore(userData).save(transitionTask(applied, "rolling-back", 30_000));
    await writeFile(join(project, "one.txt"), "one before\n", "utf8");

    await service().recoverActive();
    expect((await service().read(created.id))?.state).toBe("rolled-back");
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one before\n");
    expect(await readFile(join(project, "two.txt"), "utf8")).toBe("two before\n");

    const second = await service().start({ workspaceRoot: project, prompt: "Unknown overlap" });
    await service().write(second.id, "one.txt", "agent again\n");
    const secondApplied = (
      await service().apply(second.id, [{ path: "one.txt", contents: "agent again\n" }])
    ).task;
    await createAiWorkspaceStore(userData).save(
      transitionTask(secondApplied, "rolling-back", 40_000),
    );
    await writeFile(join(project, "one.txt"), "human after crash\n", "utf8");

    await service().recoverActive();
    expect((await service().read(second.id))?.state).toBe("conflict");
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("human after crash\n");
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

  it("keeps internal Team role workspaces out of the user-review task list", async () => {
    const api = service();
    const standalone = await api.start({ workspaceRoot: project, prompt: "Standalone" });
    const role = await api.start({
      workspaceRoot: project,
      prompt: "Internal role",
      parentTeamId: "team-alpha",
      reviewable: false,
    });
    const combined = await api.start({
      workspaceRoot: project,
      prompt: "Combined review",
      parentTeamId: "team-alpha",
      reviewable: true,
    });

    expect(role).toMatchObject({ mode: "team", parentTeamId: "team-alpha", reviewable: false });
    expect(combined).toMatchObject({ mode: "team", parentTeamId: "team-alpha", reviewable: true });
    expect((await api.list(project)).map((task) => task.id)).toEqual([combined.id, standalone.id]);
  });

  it("removes terminal sandboxes but keeps an applied task's only rollback checkpoint", async () => {
    const api = service();
    const task = await api.start({ workspaceRoot: project, prompt: "Apply then clean" });
    await api.write(task.id, "one.txt", "one proposed\n");
    await api.apply(task.id, [{ path: "one.txt", contents: "one proposed\n" }]);

    const cleaned = await api.maintainStorage({
      quotaBytes: 10_000_000,
      sandboxRetentionMs: 0,
      checkpointRetentionMs: 0,
    });
    const applied = await api.read(task.id);
    expect(cleaned.removedTaskIds).toContain(task.id);
    expect(applied?.sandbox).toBeNull();
    expect(applied?.checkpoint).not.toBeNull();
    expect((await api.rollback(task.id)).ok).toBe(true);

    await api.maintainStorage({ quotaBytes: 10_000_000, sandboxRetentionMs: 0, checkpointRetentionMs: 0 });
    expect((await api.read(task.id))?.checkpoint).toBeNull();
  });

  it("refuses a new sandbox that cannot fit without deleting active work", async () => {
    const bounded = createAiWorkspaceService({
      userDataDirectory: userData,
      now: () => 20_000 + sequence,
      id: (prefix) => `${prefix}-${String(++sequence).padStart(4, "0")}`,
      storagePolicy: () => ({
        quotaBytes: 1,
        sandboxRetentionMs: 7 * 86_400_000,
        checkpointRetentionMs: 30 * 86_400_000,
      }),
    });

    await expect(bounded.start({ workspaceRoot: project, prompt: "Too large" })).rejects.toThrow(
      /storage quota/i,
    );
    expect(await readFile(join(project, "one.txt"), "utf8")).toBe("one before\n");
  });

  it("counts retained Team bases when a standalone task checks the shared quota", async () => {
    const retainedBase = join(userData, "ai-teams", "team-retained", "base");
    await mkdir(retainedBase, { recursive: true });
    await writeFile(join(retainedBase, "base.txt"), "x".repeat(40), "utf8");
    const bounded = createAiWorkspaceService({
      userDataDirectory: userData,
      now: () => 30_000 + sequence,
      id: (prefix) => `${prefix}-${String(++sequence).padStart(4, "0")}`,
      storagePolicy: () => ({
        quotaBytes: 50,
        sandboxRetentionMs: 7 * 86_400_000,
        checkpointRetentionMs: 30 * 86_400_000,
      }),
    });

    await expect(bounded.start({ workspaceRoot: project, prompt: "Respect Team storage" }))
      .rejects.toThrow(/storage quota|project is larger/i);
  });

  it("does not charge durable Team metadata and traces against sandbox storage", async () => {
    const teamDirectory = join(userData, "ai-teams", "team-history");
    await mkdir(join(teamDirectory, "base"), { recursive: true });
    await writeFile(join(teamDirectory, "base", "base.txt"), "x", "utf8");
    await writeFile(join(teamDirectory, "record.json"), "m".repeat(2_000), "utf8");
    await writeFile(join(teamDirectory, "traces.jsonl"), "t".repeat(2_000), "utf8");
    const bounded = createAiWorkspaceService({
      userDataDirectory: userData,
      now: () => 40_000 + sequence,
      id: (prefix) => `${prefix}-${String(++sequence).padStart(4, "0")}`,
      storagePolicy: () => ({
        quotaBytes: 50,
        sandboxRetentionMs: 7 * 86_400_000,
        checkpointRetentionMs: 30 * 86_400_000,
      }),
    });

    await expect(bounded.start({ workspaceRoot: project, prompt: "Ignore history bytes" }))
      .resolves.toMatchObject({ state: "ready" });
  });
});

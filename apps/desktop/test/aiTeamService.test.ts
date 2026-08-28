import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFileClaim,
  createTeamBudget,
  createTeamPlan,
  type TeamPlanInput,
} from "@adcode/ai";
import { createAiTeamService } from "../src/main/aiTeamService.ts";
import {
  createAiWorkspaceService,
  type AiWorkspaceService,
  type StartAiWorkspaceInput,
} from "../src/main/aiWorkspaceService.ts";

let project: string;
let userData: string;
let sequence: number;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "adcode-team-project-"));
  userData = await mkdtemp(join(tmpdir(), "adcode-team-user-data-"));
  sequence = 0;
  await writeFile(join(project, "shared.txt"), "captured\n", "utf8");
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
});

const planInput = (): TeamPlanInput => ({
  id: "team-alpha",
  prompt: "Update desktop and web",
  acceptanceCriteria: ["Both agents finish"],
  roles: [
    { id: "desktop", label: "Desktop", objective: "Update desktop" },
    { id: "web", label: "Web", objective: "Update web" },
  ],
  nodes: [
    {
      id: "desktop-change",
      title: "Desktop",
      objective: "Update desktop",
      roleId: "desktop",
      dependsOn: [],
      acceptanceCriteria: ["Desktop works"],
      fileHints: ["apps/desktop"],
    },
    {
      id: "web-change",
      title: "Web",
      objective: "Update web",
      roleId: "web",
      dependsOn: [],
      acceptanceCriteria: ["Web works"],
      fileHints: ["apps/web"],
    },
  ],
});

function workspaceService(): AiWorkspaceService {
  return createAiWorkspaceService({
    userDataDirectory: userData,
    now: () => 10_000 + sequence,
    id: (prefix) => `${prefix}-${String(++sequence).padStart(4, "0")}`,
  });
}

function configure(service: ReturnType<typeof createAiTeamService>) {
  return service.configure({
    id: "team-alpha",
    workspaceRoot: project,
    plan: createTeamPlan(planInput()),
    claims: [
      createFileClaim({ nodeId: "desktop-change", path: "apps/desktop", scope: "directory" }),
    ],
    budget: createTeamBudget({
      tokenLimit: 100_000,
      costMicrosLimit: 20_000_000,
      agentTokenLimits: { "desktop-change": 60_000, "web-change": 60_000 },
    }),
  });
}

describe("AI Team child workspace allocation", () => {
  it("does not allocate or start an agent while a Team is only configured", async () => {
    const real = workspaceService();
    let starts = 0;
    const allocator = {
      ...real,
      async start(input: StartAiWorkspaceInput) {
        starts += 1;
        return real.start(input);
      },
    };
    const service = createAiTeamService({ userDataDirectory: userData, workspaceService: allocator });

    const team = await configure(service);
    expect(team.state).toBe("configured");
    expect(team.confirmedAt).toBeNull();
    expect(starts).toBe(0);
  });

  it("allocates one role sandbox from the same immutable base after confirmation", async () => {
    const real = workspaceService();
    let starts = 0;
    const allocator = {
      ...real,
      async start(input: StartAiWorkspaceInput) {
        const task = await real.start(input);
        starts += 1;
        if (starts === 1) await writeFile(join(project, "shared.txt"), "later human edit\n", "utf8");
        return task;
      },
    };
    const service = createAiTeamService({ userDataDirectory: userData, workspaceService: allocator });
    await configure(service);

    const started = await service.startConfirmed("team-alpha");
    expect(started.state).toBe("running");
    expect(Object.keys(started.childTaskIds).sort()).toEqual(["desktop", "web"]);
    expect(started.base?.kind).toBe("shadow-base");
    for (const taskId of Object.values(started.childTaskIds)) {
      expect(await real.readSandboxFile(taskId, "shared.txt")).toBe("captured\n");
    }
    expect(await readFile(join(project, "shared.txt"), "utf8")).toBe("later human edit\n");
  });

  it("pauses with successful children registered when a later allocation fails", async () => {
    const real = workspaceService();
    let starts = 0;
    const allocator = {
      ...real,
      async start(input: StartAiWorkspaceInput) {
        starts += 1;
        if (starts === 2) throw new Error("storage quota full");
        return real.start(input);
      },
    };
    const service = createAiTeamService({ userDataDirectory: userData, workspaceService: allocator });
    await configure(service);

    const result = await service.startConfirmed("team-alpha");
    expect(result.state).toBe("paused");
    expect(Object.keys(result.childTaskIds)).toEqual(["desktop"]);
    expect((await service.traces("team-alpha")).at(-1)?.outcome).toBe("blocked");
  });

  it("counts an immutable shadow base against quota and removes it when no child can fit", async () => {
    const constrained = createAiWorkspaceService({
      userDataDirectory: userData,
      now: () => 10_000 + sequence,
      id: (prefix) => `${prefix}-${String(++sequence).padStart(4, "0")}`,
      storagePolicy: () => ({
        quotaBytes: 1,
        sandboxRetentionMs: 1_000,
        checkpointRetentionMs: 1_000,
      }),
    });
    const service = createAiTeamService({ userDataDirectory: userData, workspaceService: constrained });
    await configure(service);

    const result = await service.startConfirmed("team-alpha");
    expect(result.state).toBe("paused");
    expect(result.base).toBeNull();
    await expect(
      readFile(join(userData, "ai-teams", "team-alpha", "base", "shared.txt"), "utf8"),
    ).rejects.toThrow();
  });

  it("cannot confirm the same Team twice", async () => {
    const service = createAiTeamService({ userDataDirectory: userData, workspaceService: workspaceService() });
    await configure(service);
    await service.startConfirmed("team-alpha");
    await expect(service.startConfirmed("team-alpha")).rejects.toThrow(/cannot start|confirmed/i);
  });

  it("combines completed role proposals without touching or rebasing onto later human text", async () => {
    await writeFile(join(project, "shared.txt"), "one\ntwo\nthree\nfour\n", "utf8");
    const real = workspaceService();
    const service = createAiTeamService({ userDataDirectory: userData, workspaceService: real });
    let team = await configure(service);
    team = await service.startConfirmed(team.id);
    const desktopTask = team.childTaskIds["desktop"]!;
    const webTask = team.childTaskIds["web"]!;

    await service.startNode(team.id, "desktop-change");
    await real.writeFromSandboxBase(desktopTask, "shared.txt", "ONE\ntwo\nthree\nfour\n");
    await service.completeNode(team.id, {
      nodeId: "desktop-change",
      summary: "Desktop change complete",
      findings: [],
      decisions: [],
      changedPaths: ["shared.txt"],
      tests: [],
      blockers: [],
      deadEnds: [],
      completedAt: Date.now(),
    });
    await service.startNode(team.id, "web-change");
    await real.writeFromSandboxBase(webTask, "shared.txt", "one\ntwo\nthree\nFOUR\n");
    await service.completeNode(team.id, {
      nodeId: "web-change",
      summary: "Web change complete",
      findings: [],
      decisions: [],
      changedPaths: ["shared.txt"],
      tests: [],
      blockers: [],
      deadEnds: [],
      completedAt: Date.now(),
    });

    const review = await service.buildCombinedReview(team.id);
    expect(review.state).toBe("review");
    const combinedId = review.merge.combinedTaskId!;
    const combined = await real.read(combinedId);
    expect(combined?.changes).toEqual([
      {
        path: "shared.txt",
        original: "one\ntwo\nthree\nfour\n",
        proposed: "ONE\ntwo\nthree\nFOUR\n",
      },
    ]);
    expect(await readFile(join(project, "shared.txt"), "utf8")).toBe("one\ntwo\nthree\nfour\n");

    await writeFile(join(project, "shared.txt"), "later human text\n", "utf8");
    const apply = await real.apply(combinedId, [
      { path: "shared.txt", contents: "ONE\ntwo\nthree\nFOUR\n" },
    ]);
    expect(apply.ok).toBe(false);
    expect(apply.conflicts).toEqual(["shared.txt"]);
    expect(await readFile(join(project, "shared.txt"), "utf8")).toBe("later human text\n");
  });

  it("preserves every overlapping proposal for explicit conflict review", async () => {
    await writeFile(join(project, "shared.txt"), "one\ntwo\nthree\n", "utf8");
    const real = workspaceService();
    const service = createAiTeamService({ userDataDirectory: userData, workspaceService: real });
    let team = await configure(service);
    team = await service.startConfirmed(team.id);

    const proposals = [
      ["desktop-change", "desktop", "one\nTWO-DESKTOP\nthree\n"],
      ["web-change", "web", "one\nTWO-WEB\nthree\n"],
    ] as const;
    for (const [nodeId, roleId, proposed] of proposals) {
      await service.startNode(team.id, nodeId);
      await real.writeFromSandboxBase(team.childTaskIds[roleId]!, "shared.txt", proposed);
      await service.completeNode(team.id, {
        nodeId,
        summary: `${roleId} complete`,
        findings: [],
        decisions: [],
        changedPaths: ["shared.txt"],
        tests: [],
        blockers: [],
        deadEnds: [],
        completedAt: Date.now(),
      });
    }

    const result = await service.buildCombinedReview(team.id);
    expect(result.state).toBe("conflict");
    expect(result.merge.combinedTaskId).toBeNull();
    expect(result.merge.conflicts).toEqual([
      {
        path: "shared.txt",
        nodeIds: ["desktop-change", "web-change"],
        reason: "overlapping-hunks",
        original: "one\ntwo\nthree\n",
        proposals: ["one\nTWO-DESKTOP\nthree\n", "one\nTWO-WEB\nthree\n"],
      },
    ]);
    expect(await readFile(join(project, "shared.txt"), "utf8")).toBe("one\ntwo\nthree\n");
  });

  it("discards a partial combined task when any imported proposal fails", async () => {
    await writeFile(join(project, "desktop.txt"), "desktop\n", "utf8");
    await writeFile(join(project, "web.txt"), "web\n", "utf8");
    const real = workspaceService();
    let imports = 0;
    const allocator = {
      ...real,
      async importChange(taskId: string, change: Parameters<AiWorkspaceService["importChange"]>[1]) {
        imports += 1;
        if (imports === 2) throw new Error("simulated second import failure");
        return real.importChange(taskId, change);
      },
    };
    const service = createAiTeamService({ userDataDirectory: userData, workspaceService: allocator });
    let team = await configure(service);
    team = await service.startConfirmed(team.id);

    const work = [
      ["desktop-change", "desktop", "desktop.txt", "DESKTOP\n"],
      ["web-change", "web", "web.txt", "WEB\n"],
    ] as const;
    for (const [nodeId, roleId, path, proposed] of work) {
      await service.startNode(team.id, nodeId);
      await real.writeFromSandboxBase(team.childTaskIds[roleId]!, path, proposed);
      await service.completeNode(team.id, {
        nodeId,
        summary: `${roleId} complete`,
        findings: [],
        decisions: [],
        changedPaths: [path],
        tests: [],
        blockers: [],
        deadEnds: [],
        completedAt: Date.now(),
      });
    }

    const result = await service.buildCombinedReview(team.id);
    expect(result.state).toBe("paused");
    expect(result.merge).toEqual({ state: "idle", combinedTaskId: null, conflicts: [] });
    const tasks = await real.list(project);
    const combined = tasks.find((task) => task.prompt.startsWith("Combined review:"));
    expect(combined?.state).toBe("discarded");
    expect(await readFile(join(project, "desktop.txt"), "utf8")).toBe("desktop\n");
    expect(await readFile(join(project, "web.txt"), "utf8")).toBe("web\n");
  });
});

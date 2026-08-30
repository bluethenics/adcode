import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAiAutomationService } from "../src/main/aiAutomationService.ts";

let directory: string;
let clock: number;
let sequence: number;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "adcode-automation-"));
  clock = 1_000;
  sequence = 0;
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function service() {
  return createAiAutomationService({
    userDataDirectory: directory,
    now: () => clock,
    id: () => `automation-${String(++sequence).padStart(3, "0")}`,
  });
}

describe("AI automation service", () => {
  it("persists schedules per workspace and claims due items once", async () => {
    const first = service();
    const created = await first.create("C:/project-one", {
      message: "Continue",
      targetId: "builtin:chat",
      targetLabel: "Built-in assistant",
      dueAt: 2_000,
    });
    await first.create("C:/project-two", {
      message: "Other",
      targetId: "builtin:chat",
      targetLabel: "Built-in assistant",
      dueAt: 2_000,
    });

    expect((await service().list("C:/project-one")).map((item) => item.id)).toEqual([created.id]);
    expect(await first.claimDue("C:/project-one")).toBeNull();
    clock = 2_000;
    expect((await first.claimDue("C:/project-one"))?.state).toBe("delivering");
    expect(await first.claimDue("C:/project-one")).toBeNull();
    expect((await first.list("C:/project-two"))[0]?.state).toBe("missed");
  });

  it("marks due work missed while no project is active", async () => {
    const api = service();
    const item = await api.create("C:/project", {
      message: "Do not backlog",
      targetId: "builtin:chat",
      targetLabel: "Built-in assistant",
      dueAt: 2_000,
    });
    clock = 2_000;
    await api.missInactive(null);
    expect((await api.read(item.id))?.state).toBe("missed");
  });

  it("refuses to overwrite a corrupt schedule store", async () => {
    const folder = join(directory, "ai-automations");
    const path = join(folder, "items.json");
    await mkdir(folder, { recursive: true });
    await writeFile(path, "{broken", "utf8");

    await expect(
      service().create("C:/project", {
        message: "Must not overwrite",
        targetId: "builtin:chat",
        targetLabel: "Built-in assistant",
        dueAt: 2_000,
      }),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("{broken");
  });

  it("recovers an interrupted delivery without sending while ADCode was closed", async () => {
    const first = service();
    const item = await first.create("C:/project", {
      message: "Resume safely",
      targetId: "terminal:active",
      targetLabel: "Active terminal agent",
      dueAt: 1_000,
    });
    await first.claimDue("C:/project");
    clock = 5_000;

    await service().recover();
    const recovered = await service().read(item.id);
    expect(recovered).toMatchObject({
      state: "missed",
      lastError: "ADCode closed before delivery finished",
    });
    expect((await service().confirmMissed("C:/project", item.id)).state).toBe("pending");
  });

  it("completes, retries, and cancels only schedules in the owning workspace", async () => {
    const api = service();
    const item = await api.create("C:/project", {
      message: "Run later",
      targetId: "adapter:extension",
      targetLabel: "Connected extension",
      dueAt: 1_000,
    });
    await api.claimDue("C:/project");

    await expect(api.complete("C:/other", item.id)).rejects.toThrow(/workspace/i);
    const retried = await api.retry("C:/project", item.id, "Adapter offline", 3_000);
    expect(retried).toMatchObject({ state: "pending", dueAt: 3_000 });
    expect((await api.cancel("C:/project", item.id)).state).toBe("cancelled");
  });

  it("marks an unavailable claimed target missed until the user confirms Run now", async () => {
    const api = service();
    const item = await api.create("C:/project", {
      message: "Deliver once",
      targetId: "adapter:extension",
      targetLabel: "Connected extension",
      dueAt: 1_000,
    });
    await api.claimDue("C:/project");

    const missed = await api.miss("C:/project", item.id, "Target is not connected");
    expect(missed).toMatchObject({
      state: "missed",
      attempts: 1,
      lastError: "Target is not connected",
    });
    clock = 2_000;
    expect(await api.claimDue("C:/project")).toBeNull();
    expect((await api.confirmMissed("C:/project", item.id)).state).toBe("pending");
  });
});

import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createFileClaim,
  createTeamBudget,
  createTeamPlan,
  reserveTeamBudget,
  startTeamNode,
  type TeamPlanInput,
} from "@adcode/ai";
import {
  confirmAiTeamRecord,
  createAiTeamRecord,
  createAiTeamStore,
  transitionAiTeamRecord,
  type AiTeamRecord,
  type AiTeamTrace,
} from "../src/main/aiTeamStore.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "adcode-ai-team-store-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const planInput = (): TeamPlanInput => ({
  id: "team-alpha",
  prompt: "Update desktop and web",
  acceptanceCriteria: ["Both surfaces work"],
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
      acceptanceCriteria: ["Desktop passes"],
      fileHints: ["apps/desktop"],
    },
    {
      id: "web-change",
      title: "Web",
      objective: "Update web",
      roleId: "web",
      dependsOn: [],
      acceptanceCriteria: ["Web passes"],
      fileHints: ["apps/web"],
    },
  ],
});

const record = (root = "C:/private/project", id = "team-alpha"): AiTeamRecord =>
  createAiTeamRecord({
    id,
    workspaceRoot: root,
    plan: createTeamPlan({ ...planInput(), id }),
    claims: [
      createFileClaim({ nodeId: "desktop-change", path: "apps/desktop", scope: "directory" }),
    ],
    budget: createTeamBudget({
      tokenLimit: 100_000,
      costMicrosLimit: 20_000_000,
      agentTokenLimits: { "desktop-change": 60_000, "web-change": 60_000 },
    }),
    now: 1_000,
  });

describe("durable AI Team records", () => {
  it("writes atomically and survives a new store instance", async () => {
    const first = createAiTeamStore(directory);
    await first.save(record());
    await expect(createAiTeamStore(directory).read("team-alpha")).resolves.toEqual(record());

    const names = await readdir(join(directory, "ai-teams", "team-alpha"));
    expect(names).toContain("team.json");
    expect(names).not.toContain("team.json.tmp");
  });

  it("hashes workspace identity and lists only that workspace newest first", async () => {
    const store = createAiTeamStore(directory);
    const old = record("C:/private/project");
    const newer = { ...record("C:/private/project", "team-newer"), updatedAt: 2_000 };
    const other = record("D:/other/project", "team-other");
    await store.save(old);
    await store.save(newer);
    await store.save(other);

    expect(old.workspaceId).toMatch(/^ws-[a-f0-9]{32}$/);
    expect(old.workspaceId).not.toContain("private");
    expect((await store.list(old.workspaceId)).map((team) => team.id)).toEqual([
      "team-newer",
      "team-alpha",
    ]);
  });

  it("isolates syntactically valid but schema-corrupt records", async () => {
    const store = createAiTeamStore(directory);
    await store.save(record());
    const corrupt = join(directory, "ai-teams", "team-corrupt");
    await mkdir(corrupt, { recursive: true });
    await writeFile(
      join(corrupt, "team.json"),
      JSON.stringify({ ...record(), id: "team-corrupt", state: "invented", graph: { nodes: [{}] } }),
      "utf8",
    );

    expect((await store.list(record().workspaceId)).map((team) => team.id)).toEqual(["team-alpha"]);
    await expect(store.read("team-corrupt")).resolves.toBeNull();
  });

  it("recovers a confirmed running team and node as paused without activating configured work", async () => {
    const store = createAiTeamStore(directory);
    let active = confirmAiTeamRecord(record(), 1_001);
    active = transitionAiTeamRecord(active, "running", 1_002);
    active = { ...active, graph: startTeamNode(active.graph, "desktop-change", 1_003), updatedAt: 1_003 };
    const reserved = reserveTeamBudget(active.budget, {
      id: "request-recovery",
      agentId: "desktop-change",
      tokens: 400,
      costMicros: 25,
    });
    if (!reserved.ok) throw new Error("test reservation unexpectedly blocked");
    active = { ...active, budget: reserved.ledger };
    const configured = record("C:/private/project", "team-configured");
    await store.save(active);
    await store.save(configured);

    const recovered = await store.recoverActive(2_000);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]?.state).toBe("paused");
    expect(recovered[0]?.graph.nodes.find((node) => node.id === "desktop-change")?.state).toBe(
      "paused",
    );
    expect(recovered[0]?.budget.usedTokens).toBe(400);
    expect(recovered[0]?.budget.usedCostMicros).toBe(25);
    expect(recovered[0]?.budget.reservations).toEqual([]);
    expect((await store.read("team-configured"))?.state).toBe("configured");
    expect((await store.read("team-configured"))?.confirmedAt).toBeNull();
  });

  it("refuses unsafe identifiers before joining storage paths", async () => {
    const store = createAiTeamStore(directory);
    await expect(store.read("../settings")).resolves.toBeNull();
    await expect(store.traces("C:\\outside")).resolves.toEqual([]);
  });

  it("rejects unbounded or internally inconsistent persisted routes", async () => {
    const store = createAiTeamStore(directory);
    const invalid = {
      ...record(),
      routes: {
        "desktop-change": {
          providerId: "provider-a",
          modelId: "model-one",
          reason: "x".repeat(2_001),
          priceKnown: false,
          blendedCostMicrosPerMillion: 100,
        },
      },
    };
    await expect(store.save(invalid)).rejects.toThrow(/invalid/i);
  });
});

describe("append-only Team trace lanes", () => {
  const trace = (id: string, nodeId: string | null): AiTeamTrace => ({
    id,
    teamId: "team-alpha",
    nodeId,
    at: 1_000,
    kind: "state",
    summary: `Trace ${id}`,
    detail: "",
    outcome: "ok",
  });

  it("preserves lane events and valid records before a truncated tail", async () => {
    const store = createAiTeamStore(directory);
    await store.save(record());
    await store.appendTrace(trace("trace-one", "desktop-change"));
    await store.appendTrace(trace("trace-two", null));
    const path = join(directory, "ai-teams", "team-alpha", "trace.jsonl");
    await writeFile(path, `${await readFile(path, "utf8")}{"id":`, "utf8");

    expect((await store.traces("team-alpha")).map((event) => [event.id, event.nodeId])).toEqual([
      ["trace-one", "desktop-change"],
      ["trace-two", null],
    ]);
  });

  it("redacts common credential shapes before appending", async () => {
    const store = createAiTeamStore(directory);
    await store.save(record());
    await store.appendTrace({
      ...trace("trace-secret", null),
      detail: "Authorization: Bearer secret-token api_key=also-secret",
    });
    expect((await store.traces("team-alpha"))[0]?.detail).toBe(
      "Authorization: Bearer [redacted] api_key=[redacted]",
    );
  });
});

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTeamBudget,
  createTeamHandoff,
  createTeamPlan,
  type Provider,
  type ProviderRequest,
  type TeamPlanInput,
} from "@adcode/ai";
import {
  createBudgetedTeamProvider,
  createAiTeamCoordinator,
  roleHandoffChangedPaths,
  type AiTeamNodeRunInput,
  type AiTeamNodeRunner,
} from "../src/main/aiTeamCoordinator.ts";
import { createAiTeamService } from "../src/main/aiTeamService.ts";
import { createAiWorkspaceService } from "../src/main/aiWorkspaceService.ts";

let project: string;
let userData: string;
let sequence: number;

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "adcode-team-coordinator-project-"));
  userData = await mkdtemp(join(tmpdir(), "adcode-team-coordinator-data-"));
  sequence = 0;
  await writeFile(join(project, "base.txt"), "base\n", "utf8");
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true });
  await rm(userData, { recursive: true, force: true });
});

const planInput = (): TeamPlanInput => ({
  id: "team-coordinator",
  prompt: "Implement two subsystems and verify the first",
  acceptanceCriteria: ["Every independent role completes"],
  concurrency: 2,
  roles: [
    { id: "alpha", label: "Alpha", objective: "Implement alpha" },
    { id: "beta", label: "Beta", objective: "Implement beta" },
    { id: "reviewer", label: "Reviewer", objective: "Verify alpha" },
  ],
  nodes: [
    {
      id: "alpha-change",
      title: "Alpha",
      objective: "Implement alpha",
      roleId: "alpha",
      dependsOn: [],
      acceptanceCriteria: ["Alpha works"],
      fileHints: ["apps/alpha"],
    },
    {
      id: "beta-change",
      title: "Beta",
      objective: "Implement beta",
      roleId: "beta",
      dependsOn: [],
      acceptanceCriteria: ["Beta works"],
      fileHints: ["apps/beta"],
    },
    {
      id: "alpha-review",
      title: "Review alpha",
      objective: "Verify alpha",
      roleId: "reviewer",
      dependsOn: ["alpha-change"],
      acceptanceCriteria: ["Alpha is verified"],
      fileHints: ["apps/alpha"],
    },
  ],
});

describe("durable Team role handoff paths", () => {
  it("includes proposals that already existed when a crash-resumed node started", () => {
    expect(
      roleHandoffChangedPaths([
        { path: "before-crash.ts" },
        { path: "after-resume.ts" },
        { path: "before-crash.ts" },
      ]),
    ).toEqual(["after-resume.ts", "before-crash.ts"]);
  });
});

function services(tokenLimit = 20_000) {
  const workspaces = createAiWorkspaceService({
    userDataDirectory: userData,
    now: () => 10_000 + sequence,
    id: (prefix) => `${prefix}-${String(++sequence).padStart(4, "0")}`,
  });
  const teams = createAiTeamService({
    userDataDirectory: userData,
    workspaceService: workspaces,
    now: () => 20_000 + sequence++,
    traceId: () => `trace-${String(++sequence).padStart(4, "0")}`,
  });
  const configure = () =>
    teams.configure({
      id: "team-coordinator",
      workspaceRoot: project,
      plan: createTeamPlan(planInput()),
      claims: [],
      budget: createTeamBudget({
        tokenLimit,
        costMicrosLimit: 1_000_000,
        agentTokenLimits: {
          "alpha-change": tokenLimit,
          "beta-change": tokenLimit,
          "alpha-review": tokenLimit,
        },
      }),
    });
  return { workspaces, teams, configure };
}

const route = (nodeId: string) => ({
  providerId: nodeId === "beta-change" ? "provider-b" : "provider-a",
  modelId: "model-one",
  reason: "Deterministic test route",
  priceKnown: true,
  blendedCostMicrosPerMillion: 1_000,
});

function handoff(input: AiTeamNodeRunInput, summary = `${input.node.id} complete`) {
  return createTeamHandoff({
    nodeId: input.node.id,
    summary,
    findings: [],
    decisions: [],
    changedPaths: [],
    tests: [],
    blockers: [],
    deadEnds: [],
    completedAt: Date.now(),
  });
}

describe("confirmed AI Team coordination", () => {
  it("reserves conservatively before each provider stream and retains the estimate without usage", async () => {
    const order: string[] = [];
    let estimated: { tokens: number; costMicros: number } | null = null;
    const provider: Provider = {
      id: "provider-a",
      displayName: "Provider A",
      models: ["model-one"],
      async *stream() {
        order.push("provider");
        yield { kind: "text", text: "done" } as const;
      },
    };
    const budgeted = createBudgetedTeamProvider(provider, route("alpha-change"), async (estimate) => {
      order.push("reserve");
      estimated = estimate;
      return {
        id: "request-test",
        async settle(actual) {
          expect(actual).toBeNull();
          order.push("settle");
        },
      };
    });
    const request: ProviderRequest = {
      model: "model-one",
      system: "system",
      messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }],
      tools: [],
      maxTokens: 100,
    };
    const events = [];
    for await (const event of budgeted.stream(request, new AbortController().signal)) events.push(event);

    expect(order).toEqual(["reserve", "provider", "settle"]);
    expect((estimated as { tokens: number; costMicros: number } | null)?.tokens).toBeGreaterThan(100);
    expect((estimated as { tokens: number; costMicros: number } | null)?.costMicros).toBeGreaterThan(0);
    expect(events).toEqual([{ kind: "text", text: "done" }]);
  });

  it("does not start a runner for a configured, unconfirmed Team", async () => {
    const { teams, configure } = services();
    let starts = 0;
    const coordinator = createAiTeamCoordinator({
      teamService: teams,
      resolveRoute: async (_team, node) => route(node.id),
      runNode: async (input) => {
        starts += 1;
        return handoff(input);
      },
    });

    await configure();
    expect(starts).toBe(0);
    expect(await coordinator.wait("team-coordinator")).toMatchObject({ state: "configured" });
  });

  it("runs only ready nodes within Team and per-provider concurrency and passes compact handoffs", async () => {
    const { teams, configure } = services();
    const starts: string[] = [];
    const activeByProvider = new Map<string, number>();
    let active = 0;
    let maxActive = 0;
    let maxProviderActive = 0;
    const seen: AiTeamNodeRunInput[] = [];
    const runner: AiTeamNodeRunner = async (input) => {
      starts.push(input.node.id);
      seen.push(input);
      active += 1;
      maxActive = Math.max(maxActive, active);
      const providerActive = (activeByProvider.get(input.route.providerId) ?? 0) + 1;
      activeByProvider.set(input.route.providerId, providerActive);
      maxProviderActive = Math.max(maxProviderActive, providerActive);
      const reservation = await input.reserveRequest({ tokens: 100, costMicros: 10 });
      await new Promise((resolve) => setTimeout(resolve, input.node.id === "beta-change" ? 60 : 10));
      await reservation.settle(input.node.id === "beta-change" ? null : { tokens: 40, costMicros: 4 });
      active -= 1;
      activeByProvider.set(input.route.providerId, providerActive - 1);
      return handoff(input);
    };
    const coordinator = createAiTeamCoordinator({
      teamService: teams,
      resolveRoute: async (_team, node) => route(node.id),
      runNode: runner,
      providerConcurrency: () => 1,
    });
    await configure();

    const started = await coordinator.startConfirmed("team-coordinator");
    expect(started.state).toBe("running");
    const final = await coordinator.wait("team-coordinator");

    expect(starts.slice(0, 2).sort()).toEqual(["alpha-change", "beta-change"]);
    expect(starts.indexOf("alpha-review")).toBeGreaterThan(starts.indexOf("alpha-change"));
    expect(maxActive).toBe(2);
    expect(maxProviderActive).toBe(1);
    const reviewInput = seen.find((input) => input.node.id === "alpha-review")!;
    expect(reviewInput.context.dependencies.map((dependency) => dependency.nodeId)).toEqual([
      "alpha-change",
    ]);
    expect(JSON.stringify(reviewInput.context)).not.toContain("transcript");
    expect(final.state).toBe("paused");
    expect(final.budget.usedTokens).toBe(180);
    expect(final.budget.reservations).toEqual([]);
  });

  it("isolates a provider failure to its node while independent work finishes", async () => {
    const { teams, configure } = services();
    const finished: string[] = [];
    const coordinator = createAiTeamCoordinator({
      teamService: teams,
      resolveRoute: async (_team, node) => route(node.id),
      runNode: async (input) => {
        if (input.node.id === "alpha-change") throw new Error("provider alpha unavailable");
        finished.push(input.node.id);
        return handoff(input);
      },
    });
    await configure();
    await coordinator.startConfirmed("team-coordinator");

    const final = await coordinator.wait("team-coordinator");
    expect(final.state).toBe("failed");
    expect(final.graph.nodes.find((node) => node.id === "alpha-change")?.state).toBe("failed");
    expect(final.graph.nodes.find((node) => node.id === "alpha-review")?.state).toBe("blocked");
    expect(final.graph.nodes.find((node) => node.id === "beta-change")?.state).toBe("completed");
    expect(finished).toEqual(["beta-change"]);
  });

  it("pauses the whole Team and aborts sibling work when a hard request budget is reached", async () => {
    const { teams, configure } = services(100);
    let siblingAborted = false;
    const coordinator = createAiTeamCoordinator({
      teamService: teams,
      resolveRoute: async (_team, node) => route(node.id),
      runNode: async (input) => {
        if (input.node.id === "alpha-change") {
          await input.reserveRequest({ tokens: 101, costMicros: 0 });
          return handoff(input);
        }
        await new Promise<void>((resolve) => {
          input.signal.addEventListener("abort", () => {
            siblingAborted = true;
            resolve();
          });
        });
        throw new DOMException("aborted", "AbortError");
      },
    });
    await configure();
    await coordinator.startConfirmed("team-coordinator");

    const final = await coordinator.wait("team-coordinator");
    expect(final.state).toBe("paused");
    expect(siblingAborted).toBe(true);
    expect(final.budget.usedTokens).toBe(0);
  });

  it("cancels every active role without converting cancellation into node failure", async () => {
    const { teams, configure } = services();
    let active = 0;
    let announceStarted!: () => void;
    const allStarted = new Promise<void>((resolve) => {
      announceStarted = resolve;
    });
    const runner: AiTeamNodeRunner = async (input) => {
      active += 1;
      if (active === 2) announceStarted();
      await new Promise<void>((done) => input.signal.addEventListener("abort", () => done()));
      throw new DOMException("aborted", "AbortError");
    };
    const coordinator = createAiTeamCoordinator({
      teamService: teams,
      resolveRoute: async (_team, node) => route(node.id),
      runNode: runner,
    });
    await configure();
    await coordinator.startConfirmed("team-coordinator");
    await allStarted;
    await coordinator.cancel("team-coordinator");

    const final = await coordinator.wait("team-coordinator");
    expect(final.state).toBe("cancelled");
    expect(final.graph.nodes.filter((node) => node.state === "failed")).toEqual([]);
  });

  it("resumes a recovered paused Team without allocating a second set of role workspaces", async () => {
    const { teams, configure } = services();
    await configure();
    const allocated = await teams.startConfirmed("team-coordinator");
    await teams.startNode("team-coordinator", "alpha-change");
    await teams.pause("team-coordinator", "simulated restart");
    const starts: string[] = [];
    const coordinator = createAiTeamCoordinator({
      teamService: teams,
      resolveRoute: async (_team, node) => route(node.id),
      runNode: async (input) => {
        starts.push(input.node.id);
        return handoff(input);
      },
    });

    const resumed = await coordinator.resume("team-coordinator");
    expect(resumed.childTaskIds).toEqual(allocated.childTaskIds);
    const final = await coordinator.wait("team-coordinator");
    expect(starts).toContain("alpha-change");
    expect(final.state).toBe("paused");
  });
});

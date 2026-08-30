/** Explicit-confirmation scheduler for isolated Team role agents. */
import {
  estimateRequestTokens,
  readyTeamNodes,
  teamGraphState,
  teamNodeContext,
  type Provider,
  type TeamHandoff,
  type TeamNodeContext,
  type TeamPlanNode,
} from "@adcode/ai";
import type { AiTeamService } from "./aiTeamService.ts";
import type { AiTeamRecord, AiTeamRouteRecord } from "./aiTeamStore.ts";

export interface AiTeamRequestUsage {
  readonly tokens: number;
  readonly costMicros: number;
}

export interface AiTeamRequestReservation {
  readonly id: string;
  /** Null retains the conservative reservation when a provider reports no usage. */
  settle(actual: AiTeamRequestUsage | null): Promise<void>;
}

export interface AiTeamNodeRunInput {
  readonly teamId: string;
  readonly node: TeamPlanNode;
  readonly context: TeamNodeContext;
  readonly childTaskId: string;
  readonly route: AiTeamRouteRecord;
  readonly signal: AbortSignal;
  reserveRequest(estimate: AiTeamRequestUsage): Promise<AiTeamRequestReservation>;
}

export type AiTeamNodeRunner = (input: AiTeamNodeRunInput) => Promise<TeamHandoff>;

/** Include every durable role proposal so a crash before handoff cannot hide prior edits. */
export function roleHandoffChangedPaths(
  changes: readonly { readonly path: string }[],
): string[] {
  return [...new Set(changes.map((change) => change.path))].sort();
}

/** Wrap one provider lane so every network round-trip is durably budgeted first. */
export function createBudgetedTeamProvider(
  provider: Provider,
  route: AiTeamRouteRecord,
  reserveRequest: AiTeamNodeRunInput["reserveRequest"],
): Provider {
  return {
    ...provider,
    async *stream(request, signal) {
      const tokens = estimateRequestTokens(request);
      const costMicros =
        route.priceKnown && route.blendedCostMicrosPerMillion !== null
          ? Math.ceil((tokens * route.blendedCostMicrosPerMillion) / 1_000_000)
          : 0;
      const reservation = await reserveRequest({ tokens, costMicros });
      try {
        for await (const event of provider.stream(request, signal)) yield event;
      } finally {
        // Current provider adapters do not expose trustworthy usage. Retaining the full
        // estimate is conservative and prevents a missing usage field weakening limits.
        await reservation.settle(null);
      }
    },
  };
}

export interface AiTeamCoordinatorOptions {
  readonly teamService: AiTeamService;
  readonly resolveRoute: (
    team: AiTeamRecord,
    node: TeamPlanNode,
  ) => AiTeamRouteRecord | Promise<AiTeamRouteRecord>;
  readonly runNode: AiTeamNodeRunner;
  readonly providerConcurrency?: (providerId: string) => number;
  readonly reservationId?: () => string;
}

export interface AiTeamCoordinator {
  /** Confirms, allocates, and only then schedules role agents in the background. */
  startConfirmed(id: string): Promise<AiTeamRecord>;
  /** Revalidates and schedules a safely paused or crash-recovered Team. */
  resume(id: string): Promise<AiTeamRecord>;
  /** Wait until the current confirmed run reaches review, pause, failure, or cancellation. */
  wait(id: string): Promise<AiTeamRecord>;
  cancel(id: string): Promise<AiTeamRecord>;
}

class TeamBudgetBlockedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Team role failed";
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function createAiTeamCoordinator(options: AiTeamCoordinatorOptions): AiTeamCoordinator {
  const runs = new Map<string, Promise<AiTeamRecord>>();
  const controllers = new Map<string, Map<string, AbortController>>();
  const tails = new Map<string, Promise<void>>();
  let reservationSequence = 0;
  const reservationId =
    options.reservationId ?? (() => `request-${String(++reservationSequence).padStart(6, "0")}`);

  async function locked<T>(teamId: string, operation: () => Promise<T>): Promise<T> {
    const previous = tails.get(teamId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    tails.set(teamId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (tails.get(teamId) === tail) tails.delete(teamId);
    }
  }

  function activeControllers(teamId: string): Map<string, AbortController> {
    const existing = controllers.get(teamId);
    if (existing !== undefined) return existing;
    const created = new Map<string, AbortController>();
    controllers.set(teamId, created);
    return created;
  }

  function abortTeam(teamId: string): void {
    for (const controller of activeControllers(teamId).values()) controller.abort();
  }

  async function settleOutstanding(teamId: string, nodeId: string): Promise<void> {
    await locked(teamId, async () => {
      let team = await options.teamService.read(teamId);
      if (team === null) return;
      const reservations = team.budget.reservations.filter((item) => item.agentId === nodeId);
      for (const reservation of reservations) {
        team = await options.teamService.settleRequest(teamId, reservation.id, null);
      }
    });
  }

  async function runOne(
    team: AiTeamRecord,
    node: TeamPlanNode,
    route: AiTeamRouteRecord,
    controller: AbortController,
  ): Promise<void> {
    const childTaskId = team.childTaskIds[node.roleId];
    if (childTaskId === undefined) throw new Error(`AI Team role ${node.roleId} has no child workspace`);
    const context = teamNodeContext(team.plan, node.id, team.handoffs, team.claims);

    const reserveRequest = async (estimate: AiTeamRequestUsage): Promise<AiTeamRequestReservation> => {
      const id = reservationId();
      const reserved = await locked(team.id, () =>
        options.teamService.reserveRequest(team.id, {
          id,
          agentId: node.id,
          tokens: estimate.tokens,
          costMicros: estimate.costMicros,
        }),
      );
      if (!reserved.ok) throw new TeamBudgetBlockedError(reserved.reason);
      let settled = false;
      return {
        id,
        async settle(actual): Promise<void> {
          if (settled) return;
          settled = true;
          await locked(team.id, () => options.teamService.settleRequest(team.id, id, actual));
        },
      };
    };

    try {
      const handoff = await options.runNode({
        teamId: team.id,
        node,
        context,
        childTaskId,
        route,
        signal: controller.signal,
        reserveRequest,
      });
      await settleOutstanding(team.id, node.id);
      await locked(team.id, async () => {
        const current = await options.teamService.read(team.id);
        if (
          current?.state === "running" &&
          current.graph.nodes.find((candidate) => candidate.id === node.id)?.state === "running"
        ) {
          await options.teamService.completeNode(team.id, handoff);
        }
      });
    } catch (error) {
      await settleOutstanding(team.id, node.id);
      if (error instanceof TeamBudgetBlockedError) {
        await locked(team.id, async () => {
          const current = await options.teamService.read(team.id);
          if (current?.state === "running") await options.teamService.pause(team.id, error.reason);
        });
        abortTeam(team.id);
        return;
      }
      await locked(team.id, async () => {
        const current = await options.teamService.read(team.id);
        if (current === null || current.state !== "running" || isAbort(error)) return;
        if (current.graph.nodes.find((candidate) => candidate.id === node.id)?.state === "running") {
          await options.teamService.failNode(team.id, node.id, errorText(error));
        }
      });
    }
  }

  async function orchestrate(teamId: string): Promise<AiTeamRecord> {
    const active = new Map<
      string,
      {
        readonly roleId: string;
        readonly providerId: string;
        readonly promise: Promise<void>;
      }
    >();

    while (true) {
      let team = await options.teamService.read(teamId);
      if (team === null) throw new Error("AI Team was not found");
      if (team.state !== "running") return team;

      const graphState = teamGraphState(team.graph);
      if (active.size === 0 && graphState === "completed") {
        return options.teamService.buildCombinedReview(teamId);
      }
      if (active.size === 0 && graphState === "failed") {
        return options.teamService.fail(teamId, "One or more Team roles did not complete");
      }

      const activeRoles = new Set([...active.values()].map((item) => item.roleId));
      const activeProviders = new Map<string, number>();
      for (const item of active.values()) {
        activeProviders.set(item.providerId, (activeProviders.get(item.providerId) ?? 0) + 1);
      }
      let available = team.plan.concurrency - active.size;
      const ready = readyTeamNodes(team.graph);

      for (const node of ready) {
        if (available <= 0 || activeRoles.has(node.roleId)) continue;
        let route: AiTeamRouteRecord;
        try {
          route = await options.resolveRoute(team, node);
        } catch (error) {
          await locked(teamId, async () => {
            const current = await options.teamService.read(teamId);
            if (current?.state !== "running") return;
            await options.teamService.startNode(teamId, node.id);
            await options.teamService.failNode(teamId, node.id, errorText(error));
          });
          team = (await options.teamService.read(teamId)) ?? team;
          continue;
        }
        const providerLimit = options.providerConcurrency?.(route.providerId) ?? team.plan.concurrency;
        if (!Number.isSafeInteger(providerLimit) || providerLimit < 1 || providerLimit > 16) {
          throw new Error("AI Team provider concurrency is invalid");
        }
        if ((activeProviders.get(route.providerId) ?? 0) >= providerLimit) continue;

        const started = await locked(teamId, async () => {
          const current = await options.teamService.read(teamId);
          if (current?.state !== "running") return null;
          if (!readyTeamNodes(current.graph).some((candidate) => candidate.id === node.id)) return null;
          await options.teamService.recordRoute(teamId, node.id, route);
          return options.teamService.startNode(teamId, node.id);
        });
        if (started === null) continue;

        const controller = new AbortController();
        activeControllers(teamId).set(node.id, controller);
        const promise = runOne(started, node, route, controller).finally(() => {
          active.delete(node.id);
          activeControllers(teamId).delete(node.id);
        });
        active.set(node.id, { roleId: node.roleId, providerId: route.providerId, promise });
        activeRoles.add(node.roleId);
        activeProviders.set(route.providerId, (activeProviders.get(route.providerId) ?? 0) + 1);
        available -= 1;
      }

      if (active.size === 0) {
        if (ready.length === 0) {
          return options.teamService.pause(teamId, "No Team role is runnable; review paused dependencies");
        }
        continue;
      }
      await Promise.race([...active.values()].map((item) => item.promise));
    }
  }

  async function runSafely(teamId: string): Promise<AiTeamRecord> {
    try {
      return await orchestrate(teamId);
    } catch (error) {
      abortTeam(teamId);
      return locked(teamId, async () => {
        const team = await options.teamService.read(teamId);
        if (team === null) throw error;
        if (team.state === "running") return options.teamService.pause(teamId, errorText(error));
        return team;
      });
    } finally {
      controllers.delete(teamId);
    }
  }

  return {
    async startConfirmed(id): Promise<AiTeamRecord> {
      if (runs.has(id)) throw new Error("AI Team is already scheduled");
      const team = await locked(id, () => options.teamService.startConfirmed(id));
      if (team.state === "running") runs.set(id, runSafely(id));
      return team;
    },

    async resume(id): Promise<AiTeamRecord> {
      const previous = runs.get(id);
      if (previous !== undefined) {
        await previous;
        runs.delete(id);
      }
      const team = await locked(id, () => options.teamService.resume(id));
      if (team.state === "running") runs.set(id, runSafely(id));
      return team;
    },

    async wait(id): Promise<AiTeamRecord> {
      const running = runs.get(id);
      if (running !== undefined) return running;
      const team = await options.teamService.read(id);
      if (team === null) throw new Error("AI Team was not found");
      return team;
    },

    async cancel(id): Promise<AiTeamRecord> {
      abortTeam(id);
      const cancelled = await locked(id, () => options.teamService.cancel(id));
      const running = runs.get(id);
      if (running !== undefined) await running;
      return (await options.teamService.read(id)) ?? cancelled;
    },
  };
}

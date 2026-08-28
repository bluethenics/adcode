/** Main-process allocation of confirmed Team roles onto immutable child workspaces. */
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  completeTeamNode,
  createTeamHandoff,
  planTeamMerge,
  startTeamNode,
  teamGraphState,
  type FileClaim,
  type TeamBudgetLedger,
  type TeamHandoff,
  type TeamPlan,
} from "@adcode/ai";
import { captureAiSandboxBase, type CapturedAiSandboxBase } from "./aiSandbox.ts";
import {
  confirmAiTeamRecord,
  createAiTeamRecord,
  createAiTeamStore,
  transitionAiTeamRecord,
  type AiTeamRecord,
  type AiTeamStore,
} from "./aiTeamStore.ts";
import type { AiWorkspaceService, StartAiWorkspaceInput } from "./aiWorkspaceService.ts";

export interface ConfigureAiTeamInput {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly plan: TeamPlan;
  readonly claims: readonly FileClaim[];
  readonly budget: TeamBudgetLedger;
}

export interface AiWorkspaceAllocator {
  start(input: StartAiWorkspaceInput): ReturnType<AiWorkspaceService["start"]>;
  read(taskId: string): ReturnType<AiWorkspaceService["read"]>;
  writeFromSandboxBase(
    taskId: string,
    path: string,
    contents: string,
  ): ReturnType<AiWorkspaceService["writeFromSandboxBase"]>;
  importChange(
    taskId: string,
    change: Parameters<AiWorkspaceService["importChange"]>[1],
  ): ReturnType<AiWorkspaceService["importChange"]>;
  discard(taskId: string): ReturnType<AiWorkspaceService["discard"]>;
}

export interface AiTeamServiceOptions {
  readonly userDataDirectory: string;
  readonly workspaceService: AiWorkspaceAllocator;
  readonly now?: () => number;
  readonly traceId?: () => string;
}

export interface AiTeamService {
  configure(input: ConfigureAiTeamInput): Promise<AiTeamRecord>;
  read(id: string): Promise<AiTeamRecord | null>;
  startConfirmed(id: string): Promise<AiTeamRecord>;
  startNode(id: string, nodeId: string): Promise<AiTeamRecord>;
  completeNode(id: string, handoff: TeamHandoff): Promise<AiTeamRecord>;
  buildCombinedReview(id: string): Promise<AiTeamRecord>;
  traces(id: string): ReturnType<AiTeamStore["traces"]>;
  recoverActive(): ReturnType<AiTeamStore["recoverActive"]>;
}

export function createAiTeamService(options: AiTeamServiceOptions): AiTeamService {
  const now = options.now ?? Date.now;
  const traceId = options.traceId ?? (() => `trace-${randomUUID()}`);
  const store = createAiTeamStore(options.userDataDirectory);

  async function trace(
    team: AiTeamRecord,
    summary: string,
    outcome: "ok" | "blocked" | "failed",
    detail = "",
    nodeId: string | null = null,
  ): Promise<void> {
    try {
      await store.appendTrace({
        id: traceId(),
        teamId: team.id,
        nodeId,
        at: now(),
        kind: outcome === "failed" ? "error" : "state",
        summary,
        detail,
        outcome,
      });
    } catch {
      // Traces are observability, not authority. Team state remains the durable truth.
    }
  }

  return {
    async configure(input): Promise<AiTeamRecord> {
      if ((await store.read(input.id)) !== null) throw new Error("AI Team id already exists");
      const root = await realpath(input.workspaceRoot);
      const team = createAiTeamRecord({
        id: input.id,
        workspaceRoot: root,
        plan: input.plan,
        claims: input.claims,
        budget: input.budget,
        now: now(),
      });
      await store.save(team);
      await trace(team, "Configured Team; waiting for confirmation", "ok");
      return team;
    },

    read: (id) => store.read(id),

    async startConfirmed(id): Promise<AiTeamRecord> {
      const existing = await store.read(id);
      if (existing === null) throw new Error("AI Team was not found");
      let team = confirmAiTeamRecord(existing, now());
      await store.save(team);
      await trace(team, "Team start confirmed", "ok");

      let capturedBase: CapturedAiSandboxBase | null = null;
      try {
        const captured = await captureAiSandboxBase({
          userDataDirectory: options.userDataDirectory,
          teamId: team.id,
          workspaceRoot: team.workspaceRoot,
        });
        capturedBase = captured;
        team = { ...team, base: captured.record, updatedAt: now() };
        await store.save(team);

        const perRoleTokens = Math.max(1, Math.floor(team.budget.tokenLimit / team.plan.roles.length));
        for (const role of team.plan.roles) {
          const child = await options.workspaceService.start({
            workspaceRoot: team.workspaceRoot,
            prompt: `${team.plan.prompt}\n\nRole: ${role.label}\n${role.objective}`,
            tokenLimit: perRoleTokens,
            costMicrosLimit: team.budget.costMicrosLimit,
            sandboxSource: captured.source,
            reservedStorageBytes: captured.record.sizeBytes,
          });
          team = {
            ...team,
            childTaskIds: { ...team.childTaskIds, [role.id]: child.id },
            updatedAt: now(),
          };
          await store.save(team);
        }

        team = transitionAiTeamRecord(team, "running", now());
        await store.save(team);
        await trace(team, `Allocated ${String(team.plan.roles.length)} isolated role workspaces`, "ok");
        return team;
      } catch (error) {
        if (
          capturedBase?.record.kind === "shadow-base" &&
          Object.keys(team.childTaskIds).length === 0
        ) {
          await capturedBase.cleanup().catch(() => undefined);
          team = { ...team, base: null, updatedAt: now() };
        }
        team = transitionAiTeamRecord(team, "paused", now());
        await store.save(team);
        await trace(
          team,
          "Team paused during isolated workspace allocation",
          "blocked",
          error instanceof Error ? error.message : "workspace allocation failed",
        );
        return team;
      }
    },

    async startNode(id, nodeId): Promise<AiTeamRecord> {
      let team = await store.read(id);
      if (team === null || team.state !== "running") throw new Error("AI Team cannot start a node");
      team = { ...team, graph: startTeamNode(team.graph, nodeId, now()), updatedAt: now() };
      await store.save(team);
      await trace(team, `Started ${nodeId}`, "ok", "", nodeId);
      return team;
    },

    async completeNode(id, handoffInput): Promise<AiTeamRecord> {
      let team = await store.read(id);
      if (team === null || team.state !== "running") throw new Error("AI Team cannot complete a node");
      const handoff = createTeamHandoff(handoffInput);
      if (!team.plan.nodes.some((node) => node.id === handoff.nodeId)) {
        throw new Error("AI Team handoff node was not found");
      }
      team = {
        ...team,
        graph: completeTeamNode(team.graph, handoff.nodeId, now()),
        handoffs: [...team.handoffs.filter((existing) => existing.nodeId !== handoff.nodeId), handoff],
        updatedAt: now(),
      };
      await store.save(team);
      await trace(team, handoff.summary, "ok", handoff.changedPaths.join(", "), handoff.nodeId);
      return team;
    },

    async buildCombinedReview(id): Promise<AiTeamRecord> {
      let team = await store.read(id);
      if (team === null || team.state !== "running" || teamGraphState(team.graph) !== "completed") {
        throw new Error("AI Team is not ready to merge");
      }
      if (team.base === null) throw new Error("AI Team immutable base is unavailable");
      const immutableBase = team.base;

      const contributions = [];
      for (const node of team.plan.nodes) {
        const handoff = team.handoffs.find((candidate) => candidate.nodeId === node.id);
        if (handoff === undefined) throw new Error(`AI Team node ${node.id} has no handoff`);
        const childId = team.childTaskIds[node.roleId];
        if (childId === undefined) throw new Error(`AI Team role ${node.roleId} has no child workspace`);
        const child = await options.workspaceService.read(childId);
        if (child === null) throw new Error("AI Team child workspace was not found");
        const paths = new Set(handoff.changedPaths);
        const changes = child.changes.filter((change) => paths.has(change.path));
        if (changes.length !== paths.size) throw new Error(`AI Team handoff for ${node.id} names an unknown change`);
        contributions.push({ nodeId: node.id, changes });
      }

      const mergePlan = planTeamMerge(team.plan, contributions);
      team = {
        ...transitionAiTeamRecord(team, "merging", now()),
        merge: { state: "merging", combinedTaskId: null, conflicts: [] },
      };
      await store.save(team);
      if (mergePlan.conflicts.length > 0) {
        team = {
          ...transitionAiTeamRecord(team, "conflict", now()),
          merge: {
            state: "conflict",
            combinedTaskId: null,
            conflicts: mergePlan.conflicts,
          },
        };
        await store.save(team);
        await trace(
          team,
          "Team merge needs conflict review",
          "blocked",
          team.merge.conflicts.map((conflict) => conflict.path).join(", "),
        );
        return team;
      }
      if (mergePlan.changes.length === 0) {
        team = transitionAiTeamRecord(team, "paused", now());
        await store.save(team);
        await trace(team, "Team completed without reviewable file changes", "blocked");
        return team;
      }

      const source =
        immutableBase.kind === "git-revision"
          ? { kind: "git-revision" as const, revision: immutableBase.revision }
          : {
              kind: "shadow-base" as const,
              root: join(options.userDataDirectory, "ai-teams", team.id, "base"),
            };
      let combinedTaskId: string | null = null;
      try {
        const combined = await options.workspaceService.start({
          workspaceRoot: team.workspaceRoot,
          prompt: `Combined review: ${team.plan.prompt}`,
          tokenLimit: team.budget.tokenLimit,
          costMicrosLimit: team.budget.costMicrosLimit,
          sandboxSource: source,
          reservedStorageBytes: immutableBase.sizeBytes,
        });
        combinedTaskId = combined.id;
        team = {
          ...team,
          merge: { state: "merging", combinedTaskId: combined.id, conflicts: [] },
          updatedAt: now(),
        };
        await store.save(team);
        for (const change of mergePlan.changes) {
          await options.workspaceService.importChange(combined.id, change);
        }
        team = {
          ...transitionAiTeamRecord(team, "review", now()),
          merge: { state: "review", combinedTaskId: combined.id, conflicts: [] },
        };
        await store.save(team);
        await trace(team, `Combined ${String(mergePlan.changes.length)} changed file(s) for review`, "ok");
        return team;
      } catch (error) {
        if (combinedTaskId !== null) {
          try {
            await options.workspaceService.discard(combinedTaskId);
          } catch {
            // The durable parent is still paused below. A retained discarded candidate
            // is never exposed as a reviewable merge or applied to the human workspace.
          }
        }
        team = transitionAiTeamRecord(team, "paused", now());
        team = { ...team, merge: { state: "idle", combinedTaskId: null, conflicts: [] } };
        await store.save(team);
        await trace(
          team,
          "Team paused while building combined review",
          "failed",
          error instanceof Error ? error.message : "combined review failed",
        );
        return team;
      }
    },

    traces: (id) => store.traces(id),
    recoverActive: () => store.recoverActive(now()),
  };
}

/** Main-process allocation of confirmed Team roles onto immutable child workspaces. */
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import type { FileClaim, TeamBudgetLedger, TeamPlan } from "@adcode/ai";
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
  ): Promise<void> {
    try {
      await store.appendTrace({
        id: traceId(),
        teamId: team.id,
        nodeId: null,
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

    traces: (id) => store.traces(id),
    recoverActive: () => store.recoverActive(now()),
  };
}

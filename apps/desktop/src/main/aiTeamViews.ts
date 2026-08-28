/** Pure conversion from privileged Team records to renderer-safe summaries. */
import { computeHunks } from "@adcode/ai";
import type {
  AiTeamConflictView,
  AiTeamTraceView,
  AiTeamView,
  DiffHunkView,
} from "../shared/api.ts";
import type { AiTeamRecord, AiTeamTrace } from "./aiTeamStore.ts";

function redact(value: string, privateRoots: readonly string[]): string {
  let result = value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]");
  for (const root of privateRoots) {
    for (const variant of new Set([root, root.replaceAll("\\", "/")])) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(escaped, "gi"), "[workspace]");
    }
  }
  return result;
}

function hunks(original: string, proposed: string): DiffHunkView[] {
  return computeHunks(original, proposed).map((hunk) => ({
    id: hunk.id,
    startLine: hunk.startLine,
    original: hunk.original,
    replacement: hunk.replacement,
  }));
}

function conflictView(conflict: AiTeamRecord["merge"]["conflicts"][number]): AiTeamConflictView {
  const original = conflict.original ?? "";
  return {
    path: conflict.path,
    reason: conflict.reason,
    proposals: conflict.proposals.map((proposal, index) => ({
      nodeId: conflict.nodeIds[index]!,
      hunks: hunks(original, proposal),
    })),
  };
}

export function toAiTeamView(team: AiTeamRecord): AiTeamView {
  const roots = [team.workspaceRoot];
  const reservedTokens = team.budget.reservations.reduce((sum, item) => sum + item.tokens, 0);
  const reservedCostMicros = team.budget.reservations.reduce((sum, item) => sum + item.costMicros, 0);
  return {
    id: team.id,
    state: team.state,
    prompt: redact(team.plan.prompt, roots),
    acceptanceCriteria: team.plan.acceptanceCriteria.map((item) => redact(item, roots)),
    concurrency: team.plan.concurrency,
    roles: team.plan.roles.map((role) => ({
      ...role,
      label: redact(role.label, roots),
      objective: redact(role.objective, roots),
    })),
    nodes: team.graph.nodes.map((node) => ({
      id: node.id,
      title: redact(node.title, roots),
      objective: redact(node.objective, roots),
      roleId: node.roleId,
      dependsOn: node.dependsOn,
      acceptanceCriteria: node.acceptanceCriteria.map((item) => redact(item, roots)),
      fileHints: node.fileHints,
      state: node.state,
      failure: node.failure === null ? null : redact(node.failure, roots),
    })),
    handoffs: team.handoffs.map((handoff) => ({
      nodeId: handoff.nodeId,
      summary: redact(handoff.summary, roots),
      changedPaths: handoff.changedPaths,
      completedAt: handoff.completedAt,
    })),
    routes: Object.fromEntries(
      Object.entries(team.routes).map(([nodeId, route]) => [
        nodeId,
        { ...route, reason: redact(route.reason, roots) },
      ]),
    ),
    budget: {
      usedTokens: team.budget.usedTokens,
      tokenLimit: team.budget.tokenLimit,
      reservedTokens,
      usedCostMicros: team.budget.usedCostMicros,
      costMicrosLimit: team.budget.costMicrosLimit,
      reservedCostMicros,
    },
    merge: {
      state: team.merge.state,
      combinedTaskId: team.merge.combinedTaskId,
      conflicts: team.merge.conflicts.map(conflictView),
    },
    baseKind: team.base?.kind ?? null,
    confirmedAt: team.confirmedAt,
    createdAt: team.createdAt,
    updatedAt: team.updatedAt,
  };
}

export function toAiTeamTraceView(
  trace: AiTeamTrace,
  privateRoots: readonly string[],
): AiTeamTraceView {
  return {
    id: trace.id,
    nodeId: trace.nodeId,
    at: trace.at,
    kind: trace.kind,
    summary: redact(trace.summary, privateRoots),
    detail: redact(trace.detail, privateRoots),
    outcome: trace.outcome,
  };
}

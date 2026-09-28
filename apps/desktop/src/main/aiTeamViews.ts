/** Pure conversion from privileged Team records to renderer-safe summaries. */
import { computeHunks, type OperationalTrace } from "@adcode/ai";
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

/** What a running node is doing, kept in memory by the runner; never persisted. */
export type AiTeamActivity = Readonly<Record<string, { readonly text: string; readonly at: number }>>;

/** Live facts about a run that the main process keeps in memory, next to the durable record. */
export interface AiTeamLive {
  readonly activity?: AiTeamActivity;
  readonly hold?: string | null;
  readonly touchedPaths?: readonly string[];
}

/** A relative path inside the project; anything else never crosses to the renderer. */
function projectPath(path: string): boolean {
  if (path.length === 0 || path.length > 4_096 || path.startsWith("/") || /^[A-Za-z]:[\/]/.test(path)) return false;
  return path.replaceAll("\\", "/").split("/").every((part) => part.length > 0 && part !== "..");
}

export function toAiTeamView(team: AiTeamRecord, live: AiTeamLive = {}): AiTeamView {
  const activity = live.activity ?? {};
  const roots = [team.workspaceRoot];
  const reservedTokens = team.budget.reservations.reduce((sum, item) => sum + item.tokens, 0);
  const reservedCostMicros = team.budget.reservations.reduce((sum, item) => sum + item.costMicros, 0);
  return {
    id: team.id,
    kind: team.plan.kind,
    group: team.plan.group ?? null,
    hold: live.hold ?? null,
    touchedPaths: (live.touchedPaths ?? []).filter(projectPath).slice(0, 200),
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
    activity: Object.fromEntries(
      Object.entries(activity).map(([nodeId, entry]) => [nodeId, { text: redact(entry.text, roots), at: entry.at }]),
    ),
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

/** Attribute a child workspace event to its named role without exposing private roots. */
export function toAiTeamActivityView(
  trace: OperationalTrace,
  roleId: string,
  privateRoots: readonly string[],
): AiTeamTraceView {
  return {
    id: trace.id,
    nodeId: null,
    roleId,
    at: trace.at,
    kind: trace.kind,
    summary: redact(trace.summary, privateRoots),
    detail: redact(trace.detail, privateRoots),
    outcome: trace.outcome,
  };
}

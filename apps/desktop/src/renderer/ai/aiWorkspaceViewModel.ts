import type { AiWorkspaceTaskStateView, AiWorkspaceTaskView } from "../../shared/api.ts";

const LABELS: Readonly<Record<AiWorkspaceTaskStateView, string>> = {
  preparing: "Preparing isolation",
  ready: "Isolated workspace ready",
  running: "Agent working",
  paused: "Paused safely",
  review: "Ready to review",
  applying: "Applying reviewed changes",
  applied: "Applied with checkpoint",
  conflict: "Human changes need review",
  discarded: "Discarded",
  failed: "Needs attention",
  "rolling-back": "Rolling back",
  "rolled-back": "Rolled back",
};

export function aiWorkspaceStateLabel(state: AiWorkspaceTaskStateView): string {
  return LABELS[state];
}

export function summarizeAiWorkspaceTask(task: AiWorkspaceTaskView): string {
  const state = aiWorkspaceStateLabel(task.state);
  const label = task.reviewPolicy === "trusted" ? `Trusted · ${state}` : state;
  const count = task.changedPaths.length;
  return count === 0 ? label : `${label} · ${String(count)} file${count === 1 ? "" : "s"}`;
}

export interface AiWorkspaceActions {
  readonly review: boolean;
  readonly discard: boolean;
  readonly rollback: boolean;
}

export function aiWorkspaceActions(task: AiWorkspaceTaskView): AiWorkspaceActions {
  const hasCheckpoint = task.checkpointPaths.length > 0;
  return {
    review: (task.state === "review" || task.state === "conflict") && task.changedPaths.length > 0,
    discard:
      !hasCheckpoint && ["ready", "paused", "review", "conflict", "failed"].includes(task.state),
    rollback: hasCheckpoint && (task.state === "review" || task.state === "applied"),
  };
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value < 10_000_000 ? 1 : 0)}m`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return String(value);
}

export function formatAiWorkspaceUsage(task: AiWorkspaceTaskView): string {
  const tokens =
    task.tokenLimit === null
      ? `${compact(task.usedTokens)} tokens · no cap`
      : `${compact(task.usedTokens)} / ${compact(task.tokenLimit)} tokens`;
  // Pricing is provider/model specific. Until a provider reports or the routing catalogue
  // supplies a reliable price, zero means unknown—not "free"—so do not display a fake $0.
  if (task.usedCostMicros === 0) return tokens;
  const usedCost = (task.usedCostMicros / 1_000_000).toFixed(2);
  const limitCost = (task.costMicrosLimit / 1_000_000).toFixed(2);
  return `${tokens} · $${usedCost} / $${limitCost}`;
}

export function traceTone(
  outcome: "pending" | "ok" | "blocked" | "failed",
): "running" | "ok" | "error" {
  if (outcome === "pending") return "running";
  return outcome === "ok" ? "ok" : "error";
}

/** How many grouped activity rows show before a "Show all N" expander. */
export const TRACE_PREVIEW_LIMIT = 8;

export interface GroupedWorkspaceTrace {
  readonly summary: string;
  readonly detail: string;
  readonly outcome: "pending" | "ok" | "blocked" | "failed";
  /** How many raw events this row stands for. */
  readonly count: number;
}

/**
 * Fold the start/complete event pairs the agent records into one row per tool.
 *
 * Every tool call is stored as two events — `Called X` (pending) when it starts
 * and `X completed` / `X failed` when it ends — so a long task reads as an
 * endless alternating list. Pairing them halves the rows while keeping state
 * changes, refusals, errors and anything unpaired exactly as recorded.
 */
export function groupWorkspaceTraces(
  events: readonly {
    readonly summary: string;
    readonly detail: string;
    readonly outcome: "pending" | "ok" | "blocked" | "failed";
  }[],
): GroupedWorkspaceTrace[] {
  const grouped: GroupedWorkspaceTrace[] = [];
  const pendingCalls = new Map<string, number>();
  for (const event of events) {
    const called = event.outcome === "pending" ? /^Called (.+)$/.exec(event.summary) : null;
    if (called !== null) {
      pendingCalls.set(called[1]!, grouped.length);
      grouped.push({ summary: event.summary, detail: event.detail, outcome: event.outcome, count: 1 });
      continue;
    }
    const finished = /^(.*) (completed|failed)$/.exec(event.summary);
    if (finished !== null) {
      const index = pendingCalls.get(finished[1]!);
      if (index !== undefined) {
        pendingCalls.delete(finished[1]!);
        const start = grouped[index]!;
        grouped[index] = {
          summary: finished[1]!,
          detail: start.detail,
          outcome: event.outcome,
          count: 2,
        };
        continue;
      }
    }
    grouped.push({ summary: event.summary, detail: event.detail, outcome: event.outcome, count: 1 });
  }
  return grouped;
}

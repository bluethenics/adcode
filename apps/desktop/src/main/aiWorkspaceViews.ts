/** Pure conversion from privileged task records to renderer-safe views. */
import { computeHunks, type AiWorkspaceTask, type OperationalTrace } from "@adcode/ai";
import type {
  AiWorkspaceActionView,
  AiWorkspaceChangeView,
  AiWorkspaceTaskView,
  AiWorkspaceTraceView,
} from "../shared/api.ts";
import type { AiWorkspaceActionResult } from "./aiWorkspaceService.ts";

export function toAiWorkspaceTaskView(task: AiWorkspaceTask): AiWorkspaceTaskView {
  return {
    id: task.id,
    prompt: task.prompt,
    mode: task.mode,
    reviewPolicy: task.reviewPolicy,
    state: task.state,
    sandboxKind: task.sandbox?.kind ?? null,
    changedPaths: task.changes.map((change) => change.path),
    usedTokens: task.budget.usedTokens,
    tokenLimit: task.budget.tokenLimit,
    usedCostMicros: task.budget.usedCostMicros,
    costMicrosLimit: task.budget.costMicrosLimit,
    checkpointPaths: task.checkpoint?.paths ?? [],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export function toAiWorkspaceChangeViews(task: AiWorkspaceTask): AiWorkspaceChangeView[] {
  return task.changes.map((change) => ({
    path: change.path,
    hunks: computeHunks(change.original ?? "", change.proposed).map((hunk) => ({
      id: hunk.id,
      startLine: hunk.startLine,
      original: hunk.original,
      replacement: hunk.replacement,
    })),
  }));
}

export function toAiWorkspaceTraceView(trace: OperationalTrace): AiWorkspaceTraceView {
  return {
    id: trace.id,
    at: trace.at,
    kind: trace.kind,
    summary: trace.summary,
    detail: trace.detail,
    outcome: trace.outcome,
  };
}

export function toAiWorkspaceActionView(result: AiWorkspaceActionResult): AiWorkspaceActionView {
  return {
    ok: result.ok,
    task: toAiWorkspaceTaskView(result.task),
    conflicts: result.conflicts,
    message: result.message,
  };
}

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

export interface AiWorkspaceTraceRoots {
  readonly workspaceRoot: string;
  readonly sandboxRoot: string;
}

function redactTraceRoots(value: string, roots: AiWorkspaceTraceRoots): string {
  const replacements: Array<readonly [string, string]> = [
    [roots.sandboxRoot, "[task sandbox]"],
    [roots.workspaceRoot, "[workspace]"],
  ];
  let result = value;
  for (const [root, replacement] of replacements) {
    const variants = new Set([root, root.replaceAll("\\", "/")]);
    for (const variant of variants) {
      const escaped = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(escaped, "gi"), replacement);
    }
  }
  return result;
}

export function toAiWorkspaceTraceView(
  trace: OperationalTrace,
  roots: AiWorkspaceTraceRoots,
): AiWorkspaceTraceView {
  return {
    id: trace.id,
    at: trace.at,
    kind: trace.kind,
    summary: redactTraceRoots(trace.summary, roots),
    detail: redactTraceRoots(trace.detail, roots),
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

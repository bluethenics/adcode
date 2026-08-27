/**
 * Pure contracts and decisions for isolated AI workspaces.
 *
 * This module deliberately has no filesystem, process, Electron, clock, or DOM imports.
 * Main-process adapters supply identities and timestamps; these functions decide what is
 * legal before privileged code acts.
 */

export type AiTaskMode = "single" | "team";
export type AiReviewPolicy = "review" | "trusted";
export type AiSandboxKind = "git-worktree" | "shadow-copy";

export type AiTaskState =
  | "preparing"
  | "ready"
  | "running"
  | "paused"
  | "review"
  | "applying"
  | "applied"
  | "conflict"
  | "discarded"
  | "failed"
  | "rolling-back"
  | "rolled-back";

export interface AiPermissionProfile {
  readonly readWorkspace: boolean;
  readonly editSandbox: boolean;
  readonly runCommands: boolean;
  readonly networkRead: boolean;
  readonly networkWrite: boolean;
}

export interface AiBudgetLedger {
  readonly tokenLimit: number;
  readonly costMicrosLimit: number;
  readonly usedTokens: number;
  readonly usedCostMicros: number;
}

export interface AiSandboxRecord {
  readonly kind: AiSandboxKind;
  /** Opaque main-process identifier. The renderer never receives its absolute path. */
  readonly id: string;
  readonly createdAt: number;
}

export interface AiFileChange {
  readonly path: string;
  readonly original: string | null;
  readonly proposed: string;
}

export interface AiWorkspaceTask {
  readonly id: string;
  readonly workspaceId: string;
  readonly prompt: string;
  readonly mode: AiTaskMode;
  readonly reviewPolicy: AiReviewPolicy;
  readonly state: AiTaskState;
  readonly permissions: AiPermissionProfile;
  readonly budget: AiBudgetLedger;
  readonly sandbox: AiSandboxRecord | null;
  readonly changes: readonly AiFileChange[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CreateAiWorkspaceTaskInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly prompt: string;
  readonly now: number;
  readonly tokenLimit?: number;
  readonly costMicrosLimit?: number;
}

export const DEFAULT_AI_PERMISSIONS: AiPermissionProfile = Object.freeze({
  readWorkspace: true,
  editSandbox: true,
  runCommands: false,
  networkRead: false,
  networkWrite: false,
});

export const DEFAULT_TASK_TOKEN_LIMIT = 100_000;
export const DEFAULT_TASK_COST_MICROS_LIMIT = 20_000_000;

const TASK_ID = /^[a-z0-9][a-z0-9-]{2,63}$/;
const WORKSPACE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

export function createAiWorkspaceTask(input: CreateAiWorkspaceTaskInput): AiWorkspaceTask {
  if (!TASK_ID.test(input.id)) throw new Error("Invalid task id");
  if (!WORKSPACE_ID.test(input.workspaceId)) throw new Error("Invalid workspace identity");
  if (!Number.isFinite(input.now) || input.now < 0) throw new Error("Invalid task timestamp");

  const prompt = input.prompt.trim();
  if (prompt.length === 0) throw new Error("Task prompt is required");

  return {
    id: input.id,
    workspaceId: input.workspaceId,
    prompt,
    mode: "single",
    reviewPolicy: "review",
    state: "preparing",
    permissions: { ...DEFAULT_AI_PERMISSIONS },
    budget: {
      tokenLimit: positiveInteger(input.tokenLimit ?? DEFAULT_TASK_TOKEN_LIMIT, "Token limit"),
      costMicrosLimit: positiveInteger(
        input.costMicrosLimit ?? DEFAULT_TASK_COST_MICROS_LIMIT,
        "Cost limit",
      ),
      usedTokens: 0,
      usedCostMicros: 0,
    },
    sandbox: null,
    changes: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

const TRANSITIONS: Readonly<Record<AiTaskState, readonly AiTaskState[]>> = {
  preparing: ["ready", "paused", "failed", "discarded"],
  ready: ["running", "paused", "discarded", "failed"],
  running: ["paused", "review", "failed"],
  paused: ["ready", "running", "review", "discarded", "failed"],
  review: ["applying", "discarded", "conflict", "failed"],
  applying: ["applied", "paused", "conflict", "failed"],
  applied: ["rolling-back"],
  conflict: ["review", "discarded", "failed"],
  discarded: [],
  failed: ["paused", "discarded"],
  "rolling-back": ["rolled-back", "paused", "conflict", "failed"],
  "rolled-back": [],
};

export function transitionTask(
  task: AiWorkspaceTask,
  next: AiTaskState,
  now: number,
): AiWorkspaceTask {
  if (!TRANSITIONS[task.state].includes(next)) {
    throw new Error(`Invalid task transition: ${task.state} -> ${next}`);
  }
  if (!Number.isFinite(now) || now < task.updatedAt) throw new Error("Invalid transition timestamp");
  return { ...task, state: next, updatedAt: now };
}

export interface AiUsage {
  readonly tokens: number;
  readonly costMicros: number;
}

function validUsage(usage: AiUsage): boolean {
  return (
    Number.isSafeInteger(usage.tokens) &&
    usage.tokens >= 0 &&
    Number.isSafeInteger(usage.costMicros) &&
    usage.costMicros >= 0
  );
}

export type UsageReservation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "token-limit" | "cost-limit" };

export function canReserveUsage(budget: AiBudgetLedger, usage: AiUsage): UsageReservation {
  if (!validUsage(usage)) throw new Error("Invalid usage reservation");
  if (budget.usedTokens + usage.tokens > budget.tokenLimit) {
    return { ok: false, reason: "token-limit" };
  }
  if (budget.usedCostMicros + usage.costMicros > budget.costMicrosLimit) {
    return { ok: false, reason: "cost-limit" };
  }
  return { ok: true };
}

export function addUsage(budget: AiBudgetLedger, usage: AiUsage): AiBudgetLedger {
  if (!validUsage(usage)) throw new Error("Invalid usage");
  const reservation = canReserveUsage(budget, usage);
  if (!reservation.ok) throw new Error(`Usage exceeds ${reservation.reason}`);
  return {
    ...budget,
    usedTokens: budget.usedTokens + usage.tokens,
    usedCostMicros: budget.usedCostMicros + usage.costMicros,
  };
}

function portableRelativePath(input: string): string {
  if (input.includes("\u0000")) throw new Error("Invalid relative path");
  const portable = input.replaceAll("\\", "/").replace(/^\.\//, "");
  const parts = portable.split("/");
  if (
    portable.length === 0 ||
    portable.startsWith("/") ||
    /^[A-Za-z]:\//.test(portable) ||
    parts.some((part) => part.length === 0 || part === "." || part === "..")
  ) {
    throw new Error("Invalid relative path");
  }
  return portable;
}

export function createFileChange(
  path: string,
  original: string | null,
  proposed: string,
): AiFileChange {
  return { path: portableRelativePath(path), original, proposed };
}

export type OperationalTraceKind =
  | "task"
  | "state"
  | "tool-call"
  | "tool-result"
  | "file-change"
  | "permission"
  | "budget"
  | "checkpoint"
  | "apply"
  | "rollback"
  | "error";

export interface OperationalTrace {
  readonly id: string;
  readonly taskId: string;
  readonly at: number;
  readonly kind: OperationalTraceKind;
  readonly summary: string;
  readonly detail: string;
  readonly outcome: "pending" | "ok" | "blocked" | "failed";
}

const TRACE_KINDS = new Set<OperationalTraceKind>([
  "task",
  "state",
  "tool-call",
  "tool-result",
  "file-change",
  "permission",
  "budget",
  "checkpoint",
  "apply",
  "rollback",
  "error",
]);

function redactSecrets(value: string): string {
  return value
    .replace(/(authorization\s*:\s*bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s,;]+/gi, "$1[redacted]")
    .slice(0, 8_000);
}

export function createOperationalTrace(input: OperationalTrace): OperationalTrace {
  if (!TRACE_KINDS.has(input.kind)) throw new Error("Invalid operational trace kind");
  if (!TASK_ID.test(input.taskId)) throw new Error("Invalid trace task id");
  if (input.id.trim().length === 0) throw new Error("Invalid trace id");
  if (input.summary.trim().length === 0) throw new Error("Trace summary is required");

  return {
    ...input,
    summary: redactSecrets(input.summary.trim()).slice(0, 500),
    detail: redactSecrets(input.detail),
  };
}

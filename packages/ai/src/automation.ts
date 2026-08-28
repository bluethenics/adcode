export type AiAutomationState = "pending" | "delivering" | "missed" | "delivered" | "cancelled";

export interface AiAutomation {
  readonly id: string;
  readonly workspaceId: string;
  readonly message: string;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly state: AiAutomationState;
  readonly dueAt: number;
  readonly attempts: number;
  readonly lastError: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface CreateAiAutomationInput {
  readonly id: string;
  readonly workspaceId: string;
  readonly message: string;
  readonly targetId: string;
  readonly targetLabel: string;
  readonly dueAt: number;
  readonly now: number;
}

const ID = /^[a-z0-9][a-z0-9-]{2,80}$/;
const WORKSPACE = /^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/;
const TARGET = /^[A-Za-z0-9][A-Za-z0-9:._-]{2,127}$/;

function timestamp(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}`);
  return value;
}

export function createAiAutomation(input: CreateAiAutomationInput): AiAutomation {
  if (!ID.test(input.id)) throw new Error("Invalid automation id");
  if (!WORKSPACE.test(input.workspaceId)) throw new Error("Invalid workspace id");
  if (!TARGET.test(input.targetId)) throw new Error("Invalid automation target");
  const message = input.message.trim();
  if (message.length === 0 || message.length > 8_000) throw new Error("Invalid automation message");
  const targetLabel = input.targetLabel.trim();
  if (targetLabel.length === 0 || targetLabel.length > 120) throw new Error("Invalid target label");
  const now = timestamp(input.now, "automation timestamp");
  const dueAt = timestamp(input.dueAt, "automation due time");
  if (dueAt > now + 366 * 86_400_000) throw new Error("Automation due time is too far away");
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    message,
    targetId: input.targetId,
    targetLabel,
    state: "pending",
    dueAt,
    attempts: 0,
    lastError: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function claimAiAutomation(item: AiAutomation, now: number): AiAutomation | null {
  timestamp(now, "claim timestamp");
  if (item.state !== "pending" || item.dueAt > now) return null;
  return { ...item, state: "delivering", attempts: item.attempts + 1, lastError: null, updatedAt: now };
}

export function completeAiAutomation(item: AiAutomation, now: number): AiAutomation {
  if (item.state !== "delivering") throw new Error("Automation is not delivering");
  return { ...item, state: "delivered", updatedAt: timestamp(now, "completion timestamp") };
}

export function retryAiAutomation(
  item: AiAutomation,
  error: string,
  dueAt: number,
  now: number,
): AiAutomation {
  if (item.state !== "delivering") throw new Error("Automation is not delivering");
  const message = error.trim().slice(0, 500);
  if (message.length === 0) throw new Error("Retry reason is required");
  const updatedAt = timestamp(now, "retry timestamp");
  const next = timestamp(dueAt, "retry due time");
  if (next <= updatedAt) throw new Error("Retry must be scheduled in the future");
  if (next > updatedAt + 366 * 86_400_000) throw new Error("Retry due time is too far away");
  return { ...item, state: "pending", dueAt: next, lastError: message, updatedAt };
}

export function cancelAiAutomation(item: AiAutomation, now: number): AiAutomation {
  if (item.state === "delivered" || item.state === "cancelled") return item;
  return { ...item, state: "cancelled", updatedAt: timestamp(now, "cancellation timestamp") };
}

export function missAiAutomation(item: AiAutomation, now: number): AiAutomation {
  if (item.state !== "pending" && item.state !== "delivering") {
    throw new Error("Only pending delivery can be marked missed");
  }
  return { ...item, state: "missed", updatedAt: timestamp(now, "missed timestamp") };
}

export function confirmMissedAiAutomation(item: AiAutomation, now: number): AiAutomation {
  if (item.state !== "missed") throw new Error("Automation is not missed");
  const confirmedAt = timestamp(now, "missed confirmation timestamp");
  return { ...item, state: "pending", dueAt: confirmedAt, lastError: null, updatedAt: confirmedAt };
}

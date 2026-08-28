import type { AiAutomationCreateInputView } from "../shared/api.ts";

const ID = /^[a-z0-9][a-z0-9-]{2,80}$/;
const TARGET = /^[A-Za-z0-9][A-Za-z0-9:._-]{2,127}$/;

export function validAiAutomationId(value: unknown): value is string {
  return typeof value === "string" && ID.test(value);
}

export function parseAiAutomationCreate(value: unknown): AiAutomationCreateInputView | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    typeof input["message"] !== "string" ||
    input["message"].trim().length === 0 ||
    input["message"].length > 8_000 ||
    typeof input["targetId"] !== "string" ||
    !TARGET.test(input["targetId"]) ||
    typeof input["targetLabel"] !== "string" ||
    input["targetLabel"].trim().length === 0 ||
    input["targetLabel"].length > 120 ||
    !Number.isSafeInteger(input["dueAt"]) ||
    (input["dueAt"] as number) < 0
  ) {
    return null;
  }
  return {
    message: input["message"],
    targetId: input["targetId"],
    targetLabel: input["targetLabel"],
    dueAt: input["dueAt"] as number,
  };
}

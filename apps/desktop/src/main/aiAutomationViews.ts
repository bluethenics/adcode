import type { AiAutomation } from "@adcode/ai";
import type { AiAutomationView } from "../shared/api.ts";

export function toAiAutomationView(item: AiAutomation): AiAutomationView {
  return {
    id: item.id,
    message: item.message,
    targetId: item.targetId,
    targetLabel: item.targetLabel,
    state: item.state,
    dueAt: item.dueAt,
    attempts: item.attempts,
    lastError: item.lastError,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

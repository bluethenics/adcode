import type { AiAutomationView } from "../../shared/api.ts";

export function aiAutomationCanCancel(item: AiAutomationView): boolean {
  return item.state === "pending" || item.state === "missed";
}

export function aiAutomationCanRunMissed(item: AiAutomationView): boolean {
  return item.state === "missed";
}

export function summarizeAiAutomation(item: AiAutomationView, now = Date.now()): string {
  if (item.state === "delivering") return `${item.targetLabel} · delivering`;
  if (item.state === "delivered") return `${item.targetLabel} · delivered`;
  if (item.state === "cancelled") return `${item.targetLabel} · cancelled`;
  if (item.state === "missed") return `${item.targetLabel} · missed — confirm to run`;
  const remaining = Math.max(0, item.dueAt - now);
  if (remaining < 60_000) return `${item.targetLabel} · due now`;
  if (remaining < 3_600_000) return `${item.targetLabel} · in ${String(Math.ceil(remaining / 60_000))} min`;
  if (remaining < 86_400_000) return `${item.targetLabel} · in ${String(Math.ceil(remaining / 3_600_000))} hr`;
  return `${item.targetLabel} · ${new Date(item.dueAt).toLocaleDateString()}`;
}

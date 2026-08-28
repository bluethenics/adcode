export type AiAdapterKind = "built-in" | "terminal" | "mcp" | "api" | "extension";
export type AiAdapterPromptState = "ready" | "busy" | "limited" | "paused" | "ambiguous";

export interface AiAdapterCapabilities {
  readonly scheduledPrompts: boolean;
  readonly cancellation: boolean;
  readonly safeContinuation: boolean;
}

export interface AiAdapterSnapshot {
  readonly id: string;
  readonly label: string;
  readonly kind: AiAdapterKind;
  readonly connected: boolean;
  readonly promptState: AiAdapterPromptState;
  readonly capabilities: AiAdapterCapabilities;
}

export function canAdapterReceiveSchedule(adapter: AiAdapterSnapshot): boolean {
  return adapter.connected && adapter.promptState === "ready" && adapter.capabilities.scheduledPrompts;
}

export function canAdapterAutoContinue(adapter: AiAdapterSnapshot): boolean {
  return adapter.connected && adapter.capabilities.safeContinuation && adapter.promptState === "limited";
}

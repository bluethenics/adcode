import { canAdapterReceiveSchedule, type AiAdapterSnapshot } from "@adcode/ai/adapter";

export interface AiAutomationTarget {
  readonly id: string;
  readonly label: string;
}

export interface AiAutomationAdapter {
  snapshot(): AiAdapterSnapshot;
  deliver(message: string): Promise<void> | void;
}

const adapters = new Map<string, AiAutomationAdapter>();
const targetListeners = new Set<() => void>();
let dispatching = false;
let schedulingEnabled = true;
let builtInReady = false;

export function aiAutomationTargets(): AiAutomationTarget[] {
  return [...adapters.values()]
    .map((adapter) => adapter.snapshot())
    .filter(canAdapterReceiveSchedule)
    .map(({ id, label }) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export function onAiAutomationTargetsChanged(listener: () => void): () => void {
  targetListeners.add(listener);
  return () => targetListeners.delete(listener);
}

export function refreshAiAutomationTargets(): void {
  for (const listener of targetListeners) listener();
}

/**
 * Internal extension point shared by terminal, built-in chat, and future extension hosts.
 * Stable adapter ids let a schedule survive UI re-renders; unavailable delivery becomes
 * missed so the user deliberately chooses whether to run it later.
 */
export function registerAiAutomationAdapter(adapter: AiAutomationAdapter): () => void {
  const id = adapter.snapshot().id;
  adapters.set(id, adapter);
  refreshAiAutomationTargets();
  return () => {
    if (adapters.get(id) === adapter) adapters.delete(id);
    refreshAiAutomationTargets();
  };
}

registerAiAutomationAdapter({
  snapshot: () => ({
    id: "builtin:chat",
    label: "Built-in assistant",
    kind: "built-in",
    connected: builtInReady,
    promptState: "ready",
    capabilities: { scheduledPrompts: true, cancellation: true, safeContinuation: false },
  }),
  async deliver(message) {
    const status = await window.adcode.ai.status();
    builtInReady = status.ready;
    if (!status.ready) throw new Error("The built-in AI provider is not connected");
    if (!(await window.adcode.ai.send(message))) throw new Error("The built-in AI turn did not complete");
  },
});

async function refreshBuiltInStatus(): Promise<void> {
  builtInReady = (await window.adcode.ai.status().catch(() => null))?.ready === true;
  refreshAiAutomationTargets();
}

async function tick(): Promise<void> {
  if (dispatching) return;
  dispatching = true;
  try {
    if (!schedulingEnabled) {
      await window.adcode.aiAutomation.markDueMissed();
      return;
    }
    const item = await window.adcode.aiAutomation.claimDue();
    if (item === null) return;
    const adapter = adapters.get(item.targetId);
    if (adapter === undefined || !canAdapterReceiveSchedule(adapter.snapshot())) {
      await window.adcode.aiAutomation.miss(
        item.id,
        "Target is not connected while ADCode is open",
      );
      return;
    }
    try {
      await adapter.deliver(item.message);
      await window.adcode.aiAutomation.complete(item.id);
    } catch (error) {
      await window.adcode.aiAutomation.miss(
        item.id,
        error instanceof Error ? error.message : "Target delivery failed",
      );
    }
  } catch {
    // Automation is optional. A corrupt/full store or unavailable main process must not
    // create an unhandled rejection or affect normal editing; the next tick can retry.
  } finally {
    dispatching = false;
  }
}

void window.adcode.settings
  .read()
  .then((values) => {
    schedulingEnabled = values["adcode.ai.scheduledMessages"] !== false;
  })
  .catch(() => undefined);
window.adcode.settings.onChanged((values) => {
  schedulingEnabled = values["adcode.ai.scheduledMessages"] !== false;
  void refreshBuiltInStatus();
});
void refreshBuiltInStatus();

// Renderer lifetime equals the open ADCode window. Closing the app removes this timer;
// the main-process store recovers an interrupted claim without running anything headless.
window.setInterval(() => void tick(), 1_000);

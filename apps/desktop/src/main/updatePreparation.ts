import { randomUUID } from "node:crypto";
import { CHANNELS, type UpdatePreparation } from "../shared/api.ts";

/** Only the app's two editor windows belong here, never embedded browser contents. */
export interface UpdateWindowContents {
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
  on(event: string, listener: () => void): unknown;
  removeListener(event: string, listener: () => void): unknown;
}

export function createUpdatePreparation(deps: {
  windows(): readonly UpdateWindowContents[];
  save(drafts: UpdatePreparation["drafts"]): Promise<void>;
  timeoutMs?: number;
}) {
  let active: {
    id: string;
    windows: Map<UpdateWindowContents, "waiting" | "saving" | "ready">;
    drafts: Map<string, string>;
    resolve(): void;
    reject(error: Error): void;
    cleanup(): void;
  } | null = null;

  const cancel = (): void => {
    const pending = active;
    if (!pending) return;
    active = null;
    pending.cleanup();
    for (const window of pending.windows.keys()) if (!window.isDestroyed()) {
      try { window.send(CHANNELS.updatePrepareCancel, pending.id); } catch { /* Already closing. */ }
    }
    pending.reject(new Error("Save changes in every ADCode window and try again. Close any window that is not responding."));
  };

  const prepare = (): Promise<void> => {
    if (active) return Promise.reject(new Error("Update preparation already in progress"));
    const windows = deps.windows();
    if (windows.length === 0 || windows.some(window => window.isDestroyed())) return Promise.reject(new Error("No editor window can prepare the update"));
    return new Promise<void>((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(cancel, deps.timeoutMs ?? 5_000);
      const events = ["destroyed", "render-process-gone", "did-start-loading"];
      for (const window of windows) for (const event of events) window.on(event, cancel);
      active = {
        id, windows: new Map(windows.map(window => [window, "waiting"])), drafts: new Map(), resolve, reject,
        cleanup: () => {
          clearTimeout(timer);
          for (const window of windows) for (const event of events) window.removeListener(event, cancel);
        },
      };
      try { for (const window of windows) window.send(CHANNELS.updatePrepare, id); }
      catch { cancel(); }
    });
  };

  const answer = async (sender: UpdateWindowContents, id: unknown, raw: unknown): Promise<boolean> => {
    const pending = active;
    // Object identity authenticates the actual WebContents, not a renderer-supplied ID.
    if (!pending || pending.id !== id || !pending.windows.has(sender)) return false;
    const result = raw as Partial<UpdatePreparation> | null;
    if (!result || result.ready !== true || !Array.isArray(result.drafts) || result.drafts.some(draft => typeof draft?.path !== "string" || typeof draft?.text !== "string")) {
      cancel(); return false;
    }
    if (pending.windows.get(sender) !== "waiting") return false;
    const unwritten: UpdatePreparation["drafts"][number][] = [];
    for (const draft of result.drafts) {
      if (pending.drafts.has(draft.path) && pending.drafts.get(draft.path) !== draft.text) { cancel(); return false; }
      if (!pending.drafts.has(draft.path)) { pending.drafts.set(draft.path, draft.text); unwritten.push(draft); }
    }
    pending.windows.set(sender, "saving");
    try { await deps.save(unwritten); }
    catch { cancel(); return false; }
    if (active !== pending || sender.isDestroyed()) return false;
    pending.windows.set(sender, "ready");
    if ([...pending.windows.values()].every(state => state === "ready")) {
      const current = deps.windows();
      if (current.length !== pending.windows.size || current.some(window => window.isDestroyed() || !pending.windows.has(window))) { cancel(); return false; }
      // Keep cancellation available until the installer has accepted the request, so a
      // failed installer can unlock every window without losing the prepared drafts.
      pending.resolve();
    }
    return true;
  };
  const ready = (): boolean => {
    if (!active || ![...active.windows.values()].every(state => state === "ready")) return false;
    const current = deps.windows();
    return current.length === active.windows.size && current.every(window => !window.isDestroyed() && active!.windows.has(window));
  };
  return { prepare, answer, cancel, ready, commit: () => active?.cleanup() };
}

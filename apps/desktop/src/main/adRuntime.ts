/**
 * A single lazily-constructed ad runtime, shared by the IPC handlers and app lifecycle.
 *
 * Constructing it is wrapped: §9's governing rule is that "Ad module throws at startup"
 * must be isolated, with the editor and startup time unaffected. If construction fails,
 * every method becomes a no-op and the IDE never learns that anything was wrong.
 */
import { createAdRuntime } from "./ads.ts";

type AdRuntime = ReturnType<typeof createAdRuntime>;

const NOOP_RUNTIME: AdRuntime = {
  start: async () => undefined,
  stop: () => undefined,
  notePainted: () => undefined,
  noteDismissed: () => undefined,
  noteClicked: () => undefined,
  setSuppressed: () => undefined,
  setWindowFocused: () => undefined,
  setThemeKind: () => undefined,
  setWorkspaceSignals: () => undefined,
};

let runtime: AdRuntime | null = null;

export function getAdRuntime(): AdRuntime {
  if (runtime !== null) return runtime;

  try {
    runtime = createAdRuntime();
  } catch {
    runtime = NOOP_RUNTIME;
  }

  return runtime;
}

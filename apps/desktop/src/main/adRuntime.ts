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
  // A no-op runtime still has to answer, so the report shows "waiting for the server"
  // rather than an error the user can do nothing about.
  refreshEarnings: async () => ({
    availableLabel: "$0.00",
    lifetimeLabel: "$0.00",
    hasServerBalance: false,
    enabled: false,
    pendingReceipts: 0,
    // No runtime means nothing is scheduling, which is not a suppression - the report
    // already says "waiting for the server" through `hasServerBalance`.
    suppressedReason: null,
    presets: [],
  }),
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

/**
 * Counting what the person wrote themselves, and sending it on.
 *
 * The editor host supplies the one signal worth counting - `onHumanInput`, which fires
 * for keyboard input and paste and for nothing else. Every other way a buffer changes
 * (the formatter, a git conflict resolution, a collaborator's keystroke over the wire, an
 * agent hunk landing) is somebody or something else's work, and counting it here would
 * make the manual-versus-agent split on the dashboard a lie.
 *
 * The agent's half is counted in the main process at `aiApplyHunks`, the single point
 * where a model-authored change reaches disk.
 *
 * Nothing here reads file content. A path is used to count distinct files and never
 * leaves the renderer - see `shared/activity.ts`, whose type has no field to carry one.
 */
import { createActivityLog, type ActivityLog } from "../../shared/activity.ts";

/** How often the counters go to the main process, which queues and batches from there. */
const FLUSH_MS = 120_000;

/** Just the part of the editor host this needs. Passing the whole thing would test worse. */
export interface ActivitySource {
  onHumanInput(listener: (chars: number, path: string | null) => void): () => void;
}

export interface ActivityTracker {
  /** Sends whatever is counted. Runs on a timer, on blur, and as the window goes away. */
  flush(): void;
  dispose(): void;
}

export function startActivityTracker(
  source: ActivitySource,
  report: (deltas: readonly import("../../shared/activity.ts").ActivityDelta[]) => void,
  log: ActivityLog = createActivityLog(() => Date.now()),
): ActivityTracker {
  // One per launch, so "sessions" counts runs of the app rather than ticks of the timer.
  log.add({ sessions: 1 });

  const flush = (): void => {
    if (!log.pending()) return;
    const deltas = log.drain();
    if (deltas.length > 0) report(deltas);
  };

  const stop = source.onHumanInput((chars, path) => {
    if (chars <= 0) return;
    log.add(path === null ? { manualChars: chars } : { manualChars: chars, path });
  });

  const timer = window.setInterval(flush, FLUSH_MS);

  // A window losing focus or going away is the moment most likely to be the last one.
  // `pagehide` rather than `unload`: it is the one that still fires reliably.
  const onHide = (): void => flush();
  window.addEventListener("pagehide", onHide);
  window.addEventListener("blur", onHide);

  return {
    flush,
    dispose() {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("blur", onHide);
      stop();
      flush();
    },
  };
}

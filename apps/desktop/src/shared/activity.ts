/**
 * Counting a day of editing.
 *
 * The dashboard's honest answer to "how much of this did I write?". Two numbers matter:
 * characters the person typed, and characters the AI agent wrote for them. Everything
 * else here exists to make those two trustworthy.
 *
 * **Counts, never content.** There is no field on this type that could hold a file name,
 * a path, a language, a prompt, or a line of code, and that is deliberate: it is the same
 * rule the ad tagger follows (brief §1), kept the same way. `filesTouched` is a count
 * derived from a `Set` that never leaves this module.
 *
 * **Deltas, not totals.** A flush says what happened since the last one. Two windows, a
 * crash before flush, or a reinstall all break the assumption that one client knows its
 * own running total, and a client that under-reported a total would drag the number
 * backwards with no way to tell that apart from a correction. Deltas only ever add.
 *
 * Pure but for the clock it is handed. No I/O, no Electron, no DOM - which is what lets
 * the whole thing be tested in milliseconds.
 */

/** One flush. Mirrors `ActivityBody` in `services/api/src/contract.ts`. */
export interface ActivityDelta {
  /** 'YYYY-MM-DD', UTC. */
  readonly day: string;
  readonly manualChars: number;
  readonly agentChars: number;
  readonly acceptedEdits: number;
  readonly rejectedEdits: number;
  readonly filesTouched: number;
  readonly activeMs: number;
  readonly sessions: number;
}

/**
 * The longest gap that still counts as working.
 *
 * Active time is measured as the sum of gaps between edits, each capped at this. Without
 * a cap, going to lunch mid-file would bill the afternoon as three hours of flow; with
 * one, a burst of typing counts fully and a pause counts for half a minute.
 */
const IDLE_GAP_MS = 30_000;

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** What a caller reports. Every field optional: most events move exactly one number. */
export interface ActivityEvent {
  readonly manualChars?: number;
  readonly agentChars?: number;
  readonly acceptedEdits?: number;
  readonly rejectedEdits?: number;
  readonly sessions?: number;
  /**
   * The file the event touched. Used only to count distinct files - it is put in a `Set`
   * that stays in this module, and the count is all that is ever sent.
   */
  readonly path?: string;
}

interface DayLog {
  day: string;
  manualChars: number;
  agentChars: number;
  acceptedEdits: number;
  rejectedEdits: number;
  files: Set<string>;
  activeMs: number;
  sessions: number;
  lastEventAt: number;
}

export interface ActivityLog {
  /** Records an event against the day it happened on. */
  add(event: ActivityEvent): void;
  /** Everything not yet sent, oldest day first. Empty when there is nothing to say. */
  drain(): ActivityDelta[];
  /** True when a drain would return something. Lets a caller skip an empty round trip. */
  pending(): boolean;
}

export function createActivityLog(now: () => number): ActivityLog {
  // Keyed by day, because a session that runs across midnight owes two days of numbers
  // and attributing both to whichever day the flush lands on would be wrong twice.
  const days = new Map<string, DayLog>();

  const dayLog = (at: number): DayLog => {
    const day = utcDay(at);
    const existing = days.get(day);
    if (existing !== undefined) return existing;

    const fresh: DayLog = {
      day,
      manualChars: 0,
      agentChars: 0,
      acceptedEdits: 0,
      rejectedEdits: 0,
      files: new Set(),
      activeMs: 0,
      sessions: 0,
      lastEventAt: at,
    };
    days.set(day, fresh);
    return fresh;
  };

  return {
    add(event) {
      const at = now();
      const log = dayLog(at);

      // The gap since the previous event, capped. A first event on a fresh day adds
      // nothing, which is right: no work has been observed yet, only its beginning.
      const gap = at - log.lastEventAt;
      if (gap > 0) log.activeMs += Math.min(gap, IDLE_GAP_MS);
      log.lastEventAt = at;

      log.manualChars += event.manualChars ?? 0;
      log.agentChars += event.agentChars ?? 0;
      log.acceptedEdits += event.acceptedEdits ?? 0;
      log.rejectedEdits += event.rejectedEdits ?? 0;
      log.sessions += event.sessions ?? 0;
      if (event.path !== undefined) log.files.add(event.path);
    },

    pending() {
      for (const log of days.values()) {
        if (
          log.manualChars > 0 ||
          log.agentChars > 0 ||
          log.acceptedEdits > 0 ||
          log.rejectedEdits > 0 ||
          log.sessions > 0 ||
          log.activeMs > 0
        ) {
          return true;
        }
      }
      return false;
    },

    drain() {
      const out: ActivityDelta[] = [];

      for (const log of [...days.values()].sort((a, b) => a.day.localeCompare(b.day))) {
        out.push({
          day: log.day,
          manualChars: log.manualChars,
          agentChars: log.agentChars,
          acceptedEdits: log.acceptedEdits,
          rejectedEdits: log.rejectedEdits,
          // Sent as a count. The server takes the larger of what it holds and what
          // arrives rather than summing, because a file edited in two flushes is one
          // file - so the running set is kept rather than cleared.
          filesTouched: log.files.size,
          activeMs: log.activeMs,
          sessions: log.sessions,
        });

        // The counters reset; the file set and `lastEventAt` do not. Clearing the set
        // would make the next flush report the same files as new ones.
        log.manualChars = 0;
        log.agentChars = 0;
        log.acceptedEdits = 0;
        log.rejectedEdits = 0;
        log.activeMs = 0;
        log.sessions = 0;
      }

      // Yesterday is finished: its counters are drained and nothing can add to it again.
      // Keeping the entry would hold its file set alive for the rest of the run.
      const today = utcDay(now());
      for (const day of [...days.keys()]) {
        if (day !== today) days.delete(day);
      }

      return out.filter(
        (delta) =>
          delta.manualChars > 0 ||
          delta.agentChars > 0 ||
          delta.acceptedEdits > 0 ||
          delta.rejectedEdits > 0 ||
          delta.sessions > 0 ||
          delta.activeMs > 0,
      );
    },
  };
}

/** Adds two deltas for the same day. Used to merge the renderer's flush into the queue. */
export function mergeDeltas(a: ActivityDelta, b: ActivityDelta): ActivityDelta {
  return {
    day: a.day,
    manualChars: a.manualChars + b.manualChars,
    agentChars: a.agentChars + b.agentChars,
    acceptedEdits: a.acceptedEdits + b.acceptedEdits,
    rejectedEdits: a.rejectedEdits + b.rejectedEdits,
    // Not a sum, for the same reason the server does not sum it.
    filesTouched: Math.max(a.filesTouched, b.filesTouched),
    activeMs: a.activeMs + b.activeMs,
    sessions: a.sessions + b.sessions,
  };
}

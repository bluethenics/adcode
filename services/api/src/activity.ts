/**
 * How the editor was actually used.
 *
 * The dashboard's honest answer to "how much of this did I write?". The desktop app
 * counts two things while you work - characters you typed, and characters the AI agent
 * inserted on your behalf - and flushes the difference here.
 *
 * **What is deliberately not here.** No file names, no paths, no content, no language,
 * no repository, no prompt, no model output. Counts and durations only. That is the same
 * promise the ad tagger makes (brief §1) and it is kept the same way: there is no field
 * on the wire that could carry it, so no future change can start sending it by accident.
 *
 * **Deltas, not totals.** A flush says what happened since the last one. Two editor
 * windows, a crash before flush, a reinstall, or a second machine all break the
 * assumption that one client knows the running total; a client that under-reported a
 * total would drag the number backwards, and there is no honest way to tell that apart
 * from a correction. Deltas only ever add.
 */
import type { ActivityBody } from "./contract.ts";
import { utcDay, utcDayBefore } from "./day.ts";
import type { ActivityDay, Clock, Store } from "./store.ts";

export interface ActivityDeps {
  store: Store;
  clock: Clock;
}

/** How far back a read may reach. A year of days is 365 rows - cheap, and enough. */
export const ACTIVITY_LIMITS = { maxDays: 365, defaultDays: 30 } as const;

export interface ActivityView {
  days: ActivityDay[];
  /** Totals over the window, so the dashboard does not re-derive them in three places. */
  totals: {
    manualChars: number;
    agentChars: number;
    acceptedEdits: number;
    rejectedEdits: number;
    activeMs: number;
    sessions: number;
    /** Agent share of characters written, 0-100. Null when nothing was written at all. */
    agentPercent: number | null;
  };
}

/**
 * Records one flush.
 *
 * The day comes from the body, not the server clock: a flush at 00:00:03 UTC covering
 * work done just before midnight belongs to the day the work happened on. It is clamped
 * to a window around now so a wrong clock - or a client trying it on - cannot write into
 * next year and sit at the top of every chart forever.
 */
export async function recordActivity(
  deps: ActivityDeps,
  uid: string,
  body: ActivityBody,
): Promise<void> {
  const now = deps.clock.now();
  const today = utcDay(now);
  const earliest = utcDayBefore(now, 7);

  const day = body.day > today ? today : body.day < earliest ? earliest : body.day;

  await deps.store.addActivity({
    uid,
    at: now,
    day,
    manualChars: body.manualChars,
    agentChars: body.agentChars,
    acceptedEdits: body.acceptedEdits,
    rejectedEdits: body.rejectedEdits,
    filesTouched: body.filesTouched,
    activeMs: body.activeMs,
    sessions: body.sessions,
  });
}

export async function readActivity(
  deps: ActivityDeps,
  uid: string,
  days: number,
): Promise<ActivityView> {
  const window = Math.max(1, Math.min(days, ACTIVITY_LIMITS.maxDays));
  const rows = await deps.store.activityForUser(uid, utcDayBefore(deps.clock.now(), window));

  const totals = rows.reduce(
    (sum, row) => ({
      manualChars: sum.manualChars + row.manualChars,
      agentChars: sum.agentChars + row.agentChars,
      acceptedEdits: sum.acceptedEdits + row.acceptedEdits,
      rejectedEdits: sum.rejectedEdits + row.rejectedEdits,
      activeMs: sum.activeMs + row.activeMs,
      sessions: sum.sessions + row.sessions,
    }),
    { manualChars: 0, agentChars: 0, acceptedEdits: 0, rejectedEdits: 0, activeMs: 0, sessions: 0 },
  );

  const written = totals.manualChars + totals.agentChars;

  return {
    days: rows,
    totals: {
      ...totals,
      // Null rather than zero when nothing was written: "the agent wrote 0% of nothing"
      // is a claim, and the dashboard should say "no activity yet" instead of making it.
      agentPercent: written === 0 ? null : Math.round((totals.agentChars / written) * 100),
    },
  };
}

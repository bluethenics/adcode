/**
 * What one launch of the editor is allowed to send, decided without a clock or a disk.
 *
 * Retention needs "did this ever happen" and "how often did it go wrong", not a keystroke
 * log. So a funnel step goes once per launch, `day_active` once per UTC day, and each kind
 * of friction (an event name with its code) at most `FRICTION_PER_LAUNCH` times - a turn
 * that fails in a loop says so twenty times, not two thousand.
 */
import { FUNNEL_STEPS, sanitizeEvent, type RetentionEvent } from "./events.ts";
import { dayOf } from "./rules.ts";

export const FRICTION_PER_LAUNCH = 20;

/** A machine offline for weeks keeps the earliest of these and drops the rest. */
export const MAX_PENDING_EVENTS = 300;

/** At most this many travel in one request; the service refuses more. */
export const MAX_EVENTS_PER_REQUEST = 100;

const ONCE_PER_LAUNCH: ReadonlySet<string> = new Set<string>([...FUNNEL_STEPS, "session_start"]);

export class LaunchBudget {
  private readonly seen = new Map<string, number>();
  private readonly days = new Set<number>();

  /** Whether `raw` may be queued; returns the clean event, or null to drop it. */
  admit(raw: unknown): RetentionEvent | null {
    const event = sanitizeEvent(raw);
    if (event === null) return null;
    if (event.name === "day_active") {
      const day = dayOf(event.at);
      if (this.days.has(day)) return null;
      this.days.add(day);
      return event;
    }
    if (ONCE_PER_LAUNCH.has(event.name)) {
      if (this.seen.has(event.name)) return null;
      this.seen.set(event.name, 1);
      return event;
    }
    const key = `${event.name}:${event.code ?? ""}`;
    const used = this.seen.get(key) ?? 0;
    if (used >= FRICTION_PER_LAUNCH) return null;
    this.seen.set(key, used + 1);
    return event;
  }
}

/** Adds `event` to a pending list, keeping the earliest `MAX_PENDING_EVENTS`. */
export function enqueueEvent(pending: readonly RetentionEvent[], event: RetentionEvent): RetentionEvent[] {
  return pending.length >= MAX_PENDING_EVENTS ? [...pending] : [...pending, event];
}

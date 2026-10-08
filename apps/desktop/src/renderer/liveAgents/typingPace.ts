/**
 * How fast a live window types.
 *
 * A model's code arrives in bursts - nothing for half a second, then three hundred characters
 * at once. Drawn as it arrives, that reads as a page stuttering, not as someone typing. So
 * the window reveals the code it has at a pace: steady when little is waiting, faster when a
 * lot is, so the text on screen never trails the model by more than about a second.
 *
 * The speed is set when new text arrives - enough to clear what is waiting in under a second
 * - and held until the next arrival. Recomputing it every frame from what is left would slow
 * down as the backlog shrank, and a burst would take several seconds to finish.
 */

/** The slowest the window ever types, in characters a second. */
const MIN_RATE = 90;
/** How long a backlog may take to clear, in seconds. */
const CATCH_UP_SECONDS = 0.9;

export interface TypingPace {
  /** How many more characters to show this frame, given what is shown, what exists, and the time since the last frame. */
  next(shown: number, target: number, dtMs: number): number;
}

export function createTypingPace(): TypingPace {
  let rate = MIN_RATE;
  let lastTarget = -1;
  let carry = 0;
  return {
    next(shown, target, dtMs) {
      const remaining = target - shown;
      if (remaining <= 0) {
        lastTarget = target;
        carry = 0;
        return 0;
      }
      if (target !== lastTarget) {
        rate = Math.max(MIN_RATE, remaining / CATCH_UP_SECONDS);
        lastTarget = target;
      }
      const exact = (rate * Math.max(0, dtMs)) / 1_000 + carry;
      const count = Math.max(1, Math.floor(exact));
      carry = Math.max(0, exact - count);
      return Math.min(count, remaining);
    },
  };
}

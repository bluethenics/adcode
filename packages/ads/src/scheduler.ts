/**
 * Should an ad be shown right now, and if not, why not.
 *
 * Pure (brief §8): a function of its argument alone. `now` arrives inside the state
 * because a module that reads a clock cannot be exhaustively tested, and the
 * interruption behaviour is the thing users judge this product on.
 */
import type { FrequencyCaps, RemoteCaps, SchedulerDecision, SchedulerState } from "./types.ts";

/**
 * Brief §8.1's order, and it is load-bearing rather than cosmetic: user intent first,
 * then context, then rate limits, then inventory. Because the first applicable reason
 * wins, that ordering is what keeps the returned reason meaningful as telemetry - a
 * user who switched ads off reports `ads-disabled`, not whatever incidental condition
 * also happened to hold.
 */
export function decide(state: SchedulerState): SchedulerDecision {
  // User intent.
  if (!state.adsEnabled) return { show: false, reason: "ads-disabled" };
  if (state.killSwitch) return { show: false, reason: "kill-switch" };
  if (state.preset === "off") return { show: false, reason: "frequency-off" };

  // Context.
  if (state.now - state.launchedAt < state.settleMs) return { show: false, reason: "settling" };
  if (!state.windowFocused) return { show: false, reason: "window-unfocused" };
  if (state.debugActive) return { show: false, reason: "debug-active" };
  if (state.doNotDisturb) return { show: false, reason: "do-not-disturb" };

  // Rate limits.
  if (state.impressionsToday >= state.caps.dailyCap) return { show: false, reason: "daily-cap" };
  if (
    state.lastImpressionAt !== null &&
    state.now - state.lastImpressionAt < state.caps.minIntervalMs
  ) {
    return { show: false, reason: "min-interval" };
  }

  // Inventory.
  if (!state.creativeAvailable) return { show: false, reason: "no-creative" };

  return { show: true };
}

/**
 * A remote value is usable only if it is a finite, non-negative number. Anything else -
 * a string, `null`, `NaN`, `Infinity`, a negative - is discarded rather than coerced,
 * because every coercion of a hostile value is a chance to widen a cap.
 */
function usable(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Brief §1: "Remote config may only *tighten* them, never loosen them. A compromised or
 * misconfigured server must not be able to make the IDE more annoying than its shipped
 * defaults."
 *
 * Takes the stricter of each field independently: the longer interval, the smaller cap.
 */
export function tightenCaps(local: FrequencyCaps, remote: RemoteCaps): FrequencyCaps {
  return {
    minIntervalMs: usable(remote.minIntervalMs)
      ? Math.max(local.minIntervalMs, remote.minIntervalMs)
      : local.minIntervalMs,
    dailyCap: usable(remote.dailyCap)
      ? Math.min(local.dailyCap, Math.floor(remote.dailyCap))
      : local.dailyCap,
  };
}

/**
 * Is this receipt worth paying for?
 *
 * Spec §9: anonymous UIDs are free and unlimited to mint, so identity is not a defence.
 * The defence is that money is only ever created by a receipt matching a serve this
 * server itself issued, which caps an attacker at the same rate limit an honest user has.
 * Everything else here is a secondary check on top of that one.
 *
 * Pure: the caller supplies the serve record and the time.
 */
import type { SubmittedReceipt } from "./contract.ts";
import type { ServeRecord } from "./store.ts";

/** Below this, the ad cannot have been read. */
export const MIN_DWELL_MS = 1_000;

/** Above this, the client was left open on a desk and the impression is not attention. */
export const MAX_DWELL_MS = 300_000;

/** Tolerance for a client clock that runs slightly fast. */
const CLOCK_SKEW_MS = 30_000;

export type RejectReason =
  | "no-serve"
  | "dwell-too-short"
  | "dwell-too-long"
  | "shown-in-future"
  | "not-earning";

export type Verdict = { ok: true } | { ok: false; reason: RejectReason };

export function checkReceipt(
  receipt: SubmittedReceipt,
  serve: ServeRecord | null,
  now: number,
): Verdict {
  // The load-bearing check. Without it, /v1/receipts mints money for anyone with a token.
  if (serve === null) return { ok: false, reason: "no-serve" };

  if (receipt.outcome === "dismissed") return { ok: false, reason: "not-earning" };
  if (receipt.shownAt > now + CLOCK_SKEW_MS) return { ok: false, reason: "shown-in-future" };
  if (receipt.dwellMs < MIN_DWELL_MS) return { ok: false, reason: "dwell-too-short" };
  if (receipt.dwellMs > MAX_DWELL_MS) return { ok: false, reason: "dwell-too-long" };

  return { ok: true };
}

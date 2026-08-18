/**
 * Micros arithmetic, in BigInt.
 *
 * Spec D4: money is bigint in the service, int64 in Firestore, and a decimal string on
 * the wire. A JS number never holds a micros value - above 2^53 it has already lost
 * precision, and the point of the string form on the wire is that JSON has no bigint.
 *
 * Pure: no imports, no I/O, no clock.
 */

/** int64 bounds. `packages/ads/src/validation.ts` rejects anything outside these. */
export const INT64_MAX = 9_223_372_036_854_775_807n;
export const INT64_MIN = -9_223_372_036_854_775_808n;

/**
 * Exactly the shape the client accepts: an optional minus, then 1-19 digits.
 *
 * Deliberately stricter than BigInt's own parser, which would take "0x10", " 1 " and
 * "1_000". A server that accepts more than the client does produces values the client
 * will later reject, which surfaces as a bug in the client.
 */
const DECIMAL_INT = /^-?[0-9]{1,19}$/;

export function parseMicros(raw: string): bigint | null {
  if (typeof raw !== "string" || !DECIMAL_INT.test(raw)) return null;
  const value = BigInt(raw);
  if (value > INT64_MAX || value < INT64_MIN) return null;
  return value;
}

export function formatMicros(value: bigint): string {
  return value.toString();
}

/**
 * What the advertiser pays for one impression.
 *
 * CPM is cost per mille, so one impression is a thousandth of the rate.
 */
export function advertiserCostMicros(cpmMicros: bigint): bigint {
  return cpmMicros / 1000n;
}

/**
 * The user's cut of that cost.
 *
 * Both divisions truncate, which is specified behaviour rather than an accident of the
 * type (spec §8.1). Truncation is deterministic, and the reconciliation job recomputes
 * these values and compares them exactly - a rule that depended on floating point would
 * make that comparison unreliable.
 */
export function userCreditMicros(costMicros: bigint, revSharePercent: bigint): bigint {
  return (costMicros * revSharePercent) / 100n;
}

/**
 * Ad earnings into AI credits, in one step.
 *
 * Somebody who has built up ad earnings can spend them on paid models without going
 * through a payout and a top-up. The money moves from the withdrawable balance
 * (`balances.available_micros`, the same figure /v1/balance reports) into the AI credit
 * wallet (`model_wallet_balances`, the figure /v1/ai/wallet reports) in one database
 * transaction, so it is never in both places and never in neither.
 *
 * **The server decides everything that matters.** The client names an amount and a request
 * id, and nothing else: the rate, the limits and both balances live here and in the
 * database. A client that sends a rate is refused, not ignored, so a stale build that
 * thinks it knows the rate finds out at once instead of showing one number and receiving
 * another.
 *
 * Pure: no I/O and no clock. Money is bigint micros throughout, as everywhere else in this
 * service (money.ts).
 */
import { parseMicros } from "./money.ts";
import type { LedgerEntry } from "./ledger.ts";

/**
 * One dollar of earnings buys one dollar of AI credits.
 *
 * A ratio rather than a multiplier so a future rate stays exact in integer arithmetic.
 * Credits are spent at each model's listed price, which already carries its own pricing,
 * so a straight 1:1 move is the honest one: no fee, no bonus, nothing to explain.
 */
export const CONVERSION_RATE = { earningsMicros: 1n, creditMicros: 1n } as const;

/** Fifty cents: below this the request costs more to record than it moves. */
export const CONVERSION_MIN_MICROS = 500_000n;
/** $1,000 in one go, the same ceiling as the largest typed credit top-up. */
export const CONVERSION_MAX_MICROS = 1_000_000_000n;
/**
 * $1,000 per account per UTC day, in total.
 *
 * A stolen session can already spend credits; this caps how much of somebody's earnings it
 * can turn into credits in one day before anybody notices. Generous enough that nobody
 * converting their own money meets it.
 */
export const CONVERSION_DAILY_CAP_MICROS = 1_000_000_000n;
/** Whole cents. Earnings are kept to the micro, credits are shown to the cent. */
export const CONVERSION_STEP_MICROS = 10_000n;

const DAY_MS = 86_400_000;
/** RFC 4122 shape, any version: the editor uses `crypto.randomUUID()`. */
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ConversionRefusal =
  | "below-minimum"
  | "above-maximum"
  | "not-whole-cents"
  | "insufficient-funds"
  | "daily-cap";

/** What the credit wallet receives for this much earnings, rounded down to the micro. */
export function creditsForEarnings(earningsMicros: bigint): bigint {
  if (earningsMicros <= 0n) return 0n;
  return (earningsMicros * CONVERSION_RATE.creditMicros) / CONVERSION_RATE.earningsMicros;
}

/** Midnight UTC of the day `now` falls in. The daily cap counts from here. */
export function utcDayStart(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

/** Rounds down to whole cents, so "everything" never asks for more than is there. */
export function floorToStep(micros: bigint): bigint {
  if (micros <= 0n) return 0n;
  return micros - (micros % CONVERSION_STEP_MICROS);
}

/**
 * The most this account may convert right now.
 *
 * The smallest of: what it has (to the cent), the per-conversion ceiling, and what is left
 * of today's cap. Below `CONVERSION_MIN_MICROS` the answer is "nothing", and the caller
 * says why with `blockedReason`.
 */
export function convertibleMaxMicros(input: {
  availableMicros: bigint;
  convertedTodayMicros: bigint;
}): bigint {
  const remainingToday = CONVERSION_DAILY_CAP_MICROS - input.convertedTodayMicros;
  const candidates = [floorToStep(input.availableMicros), CONVERSION_MAX_MICROS, floorToStep(remainingToday)];
  const max = candidates.reduce((low, next) => (next < low ? next : low));
  return max < CONVERSION_MIN_MICROS ? 0n : max;
}

/**
 * Why nothing can be converted, or `null` when something can.
 *
 * Today's cap is named before the balance because it is the more surprising of the two:
 * "you have $3" is visible on the panel, "you already converted $1,000 today" is not.
 */
export function blockedReason(input: {
  availableMicros: bigint;
  convertedTodayMicros: bigint;
}): "daily-cap" | "below-minimum" | null {
  if (convertibleMaxMicros(input) > 0n) return null;
  if (CONVERSION_DAILY_CAP_MICROS - input.convertedTodayMicros < CONVERSION_MIN_MICROS) return "daily-cap";
  return "below-minimum";
}

/**
 * The rules that depend only on the amount, never on a balance.
 *
 * Separate because the route checks these *before* asking the store, and must not check
 * the balance itself there: a retry of a conversion that already went through arrives
 * after the balance fell, and has to be answered "done" rather than "not enough".
 */
export function checkAmount(amountMicros: bigint): "below-minimum" | "above-maximum" | "not-whole-cents" | null {
  if (amountMicros % CONVERSION_STEP_MICROS !== 0n) return "not-whole-cents";
  if (amountMicros < CONVERSION_MIN_MICROS) return "below-minimum";
  if (amountMicros > CONVERSION_MAX_MICROS) return "above-maximum";
  return null;
}

/**
 * Every rule a conversion must pass, checked before the database is asked.
 *
 * The database checks the balance and the daily total again under its lock, because two
 * requests can both pass this check and only one of them can be paid. This exists so the
 * common refusals have a precise answer without a round trip.
 */
export function checkConversion(input: {
  amountMicros: bigint;
  availableMicros: bigint;
  convertedTodayMicros: bigint;
}): { ok: true; creditMicros: bigint } | { ok: false; error: ConversionRefusal } {
  const { amountMicros, availableMicros, convertedTodayMicros } = input;
  const shape = checkAmount(amountMicros);
  if (shape !== null) return { ok: false, error: shape };
  if (convertedTodayMicros + amountMicros > CONVERSION_DAILY_CAP_MICROS) return { ok: false, error: "daily-cap" };
  if (amountMicros > availableMicros) return { ok: false, error: "insufficient-funds" };
  return { ok: true, creditMicros: creditsForEarnings(amountMicros) };
}

/**
 * The body of `POST /v1/earnings/convert`: exactly `{ requestId, amountMicros }`.
 *
 * `amountMicros` is a decimal string, like every other micros value on the wire. Any other
 * key is refused - in particular a client-supplied rate or credit amount, which this
 * service never reads and must not appear to accept.
 */
export function parseConversionRequest(
  raw: unknown,
): { ok: true; requestId: string; amountMicros: bigint } | { ok: false; error: "invalid-request" | "invalid-request-id" | "invalid-amount" } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false, error: "invalid-request" };
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some((key) => key !== "requestId" && key !== "amountMicros")) {
    return { ok: false, error: "invalid-request" };
  }
  const requestId = body["requestId"];
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return { ok: false, error: "invalid-request-id" };
  const rawAmount = body["amountMicros"];
  const amountMicros = typeof rawAmount === "string" ? parseMicros(rawAmount) : null;
  if (amountMicros === null || amountMicros <= 0n) return { ok: false, error: "invalid-amount" };
  return { ok: true, requestId: requestId.toLowerCase(), amountMicros };
}

/** The earnings ledger line for a conversion. Negative: it leaves the withdrawable balance. */
export function conversionEntry(input: {
  uid: string;
  requestId: string;
  amountMicros: bigint;
  creditMicros: bigint;
  now: number;
}): LedgerEntry {
  return {
    entryId: conversionEntryId(input.uid, input.requestId),
    uid: input.uid,
    kind: "credit_conversion",
    micros: -input.amountMicros,
    refId: input.requestId,
    createdAt: input.now,
    description: "Converted to AI credits",
  };
}

/** Scoped by account, so two people can never collide on the same client-chosen id. */
export function conversionEntryId(uid: string, requestId: string): string {
  return `conv-${uid}-${requestId}`;
}

/** What the store records and returns for one conversion. */
export interface EarningsConversionRecord {
  requestId: string;
  uid: string;
  earningsMicros: bigint;
  creditMicros: bigint;
  createdAt: number;
}

/**
 * The store's answer.
 *
 * `replayed` is a request id this account already used with the same amount: nothing moved
 * this time, and the original conversion is returned. `conflict` is the same id with a
 * different amount, which is a client bug and is refused rather than guessed at.
 */
export type EarningsConversionOutcome =
  | {
      status: "converted" | "replayed";
      conversion: EarningsConversionRecord;
      availableMicros: bigint;
      creditBalanceMicros: bigint;
    }
  | { status: "insufficient-funds"; availableMicros: bigint }
  | { status: "daily-cap"; convertedTodayMicros: bigint }
  | { status: "conflict" };

export interface EarningsConversionInput {
  uid: string;
  requestId: string;
  earningsMicros: bigint;
  creditMicros: bigint;
  dailyCapMicros: bigint;
  dayStart: number;
  now: number;
  entry: LedgerEntry;
}

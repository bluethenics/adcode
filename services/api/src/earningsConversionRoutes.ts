/**
 * GET and POST /v1/earnings/convert.
 *
 * GET is the quote the editor shows before anybody confirms: both balances, the rate and
 * the limits, all from here. POST does the move. The editor computes nothing it then
 * sends back - it names an amount and a request id, and the store decides the rest under
 * its lock (earningsConversion.ts says why each rule exists).
 *
 * Who may convert: a signed-in account with a confirmed email - the same bar as being paid
 * out, because credits are spent with real model providers - whose paid models are not
 * blocked. Both are checked on every request, so a replay cannot outlive a block.
 */
import {
  CONVERSION_DAILY_CAP_MICROS,
  CONVERSION_MAX_MICROS,
  CONVERSION_MIN_MICROS,
  CONVERSION_RATE,
  CONVERSION_STEP_MICROS,
  blockedReason,
  checkAmount,
  conversionEntry,
  convertibleMaxMicros,
  creditsForEarnings,
  parseConversionRequest,
  utcDayStart,
} from "./earningsConversion.ts";
import type { Store } from "./store.ts";

export interface ConversionRouteResult {
  status: number;
  body: Record<string, unknown>;
}

type Refusal = "verify-email" | "blocked" | "unavailable";

/** Who may convert at all, before any amount is looked at. */
async function eligibility(store: Store, uid: string): Promise<Refusal | null> {
  if (store.convertEarningsToCredits === undefined || store.earningsConvertedSince === undefined) return "unavailable";
  const user = await store.getUser(uid);
  if (user?.emailVerified !== true) return "verify-email";
  if ((await store.getTagflowPolicy(uid))?.blocked === true) return "blocked";
  return null;
}

const REFUSAL_STATUS: Record<Refusal, number> = { "verify-email": 403, blocked: 403, unavailable: 503 };

/** The quote. Always 200 for a signed-in caller: a refusal is a field, so the panel can say why. */
export async function handleConversionQuote(store: Store, uid: string, now: number): Promise<ConversionRouteResult> {
  const refusal = await eligibility(store, uid);
  const [balance, wallet, convertedTodayMicros] = await Promise.all([
    store.getBalance(uid),
    store.getModelWallet(uid, now),
    refusal === "unavailable" ? Promise.resolve(0n) : (store.earningsConvertedSince?.(uid, utcDayStart(now)) ?? Promise.resolve(0n)),
  ]);
  const limits = { availableMicros: balance.availableMicros, convertedTodayMicros };
  return {
    status: 200,
    body: {
      availableMicros: balance.availableMicros.toString(),
      creditBalanceMicros: BigInt(wallet.balanceMicros).toString(),
      convertedTodayMicros: convertedTodayMicros.toString(),
      minMicros: CONVERSION_MIN_MICROS.toString(),
      maxMicros: CONVERSION_MAX_MICROS.toString(),
      dailyCapMicros: CONVERSION_DAILY_CAP_MICROS.toString(),
      stepMicros: CONVERSION_STEP_MICROS.toString(),
      convertibleMaxMicros: (refusal === null ? convertibleMaxMicros(limits) : 0n).toString(),
      rate: { earningsMicros: CONVERSION_RATE.earningsMicros.toString(), creditMicros: CONVERSION_RATE.creditMicros.toString() },
      blocked: refusal ?? blockedReason(limits),
    },
  };
}

/** The move. Idempotent on the request id: a retry of a success answers with that success. */
export async function handleConvertEarnings(store: Store, uid: string, raw: unknown, now: number): Promise<ConversionRouteResult> {
  const refusal = await eligibility(store, uid);
  if (refusal !== null) return { status: REFUSAL_STATUS[refusal], body: { error: refusal } };

  const parsed = parseConversionRequest(raw);
  if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
  const shape = checkAmount(parsed.amountMicros);
  if (shape !== null) return { status: 422, body: { error: shape } };

  const creditMicros = creditsForEarnings(parsed.amountMicros);
  // `eligibility` returned null, so the store has the method.
  const outcome = await store.convertEarningsToCredits!({
    uid,
    requestId: parsed.requestId,
    earningsMicros: parsed.amountMicros,
    creditMicros,
    dailyCapMicros: CONVERSION_DAILY_CAP_MICROS,
    dayStart: utcDayStart(now),
    now,
    entry: conversionEntry({ uid, requestId: parsed.requestId, amountMicros: parsed.amountMicros, creditMicros, now }),
  });

  switch (outcome.status) {
    case "converted":
    case "replayed":
      return {
        status: 200,
        body: {
          status: outcome.status,
          requestId: outcome.conversion.requestId,
          earningsMicros: outcome.conversion.earningsMicros.toString(),
          creditMicros: outcome.conversion.creditMicros.toString(),
          availableMicros: outcome.availableMicros.toString(),
          creditBalanceMicros: outcome.creditBalanceMicros.toString(),
        },
      };
    case "insufficient-funds":
      return { status: 422, body: { error: "insufficient-funds", availableMicros: outcome.availableMicros.toString() } };
    case "daily-cap":
      return { status: 422, body: { error: "daily-cap", convertedTodayMicros: outcome.convertedTodayMicros.toString() } };
    case "conflict":
      return { status: 409, body: { error: "request-id-reused" } };
  }
}

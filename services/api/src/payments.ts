/**
 * Taking money from an advertiser.
 *
 * A port, for the same reason the store is one: the whole funding path can be built and
 * tested with no payment account in existence, and the adapter that actually talks to
 * Dodo stays a thin translation layer.
 *
 * Note what is NOT here. Nothing in this interface returns a balance or moves money in
 * our own records - a checkout only produces a link for the advertiser to pay at. The
 * balance moves when the signed webhook arrives, and nowhere else. Crediting on a
 * "checkout created" response would credit people who never paid.
 */

export interface CheckoutRequest {
  orderId: string;
  advertiserId: string;
  advertiserName: string;
  /** Dodo requires a customer; the signed-in advertiser's address is used. */
  advertiserEmail: string;
  /** ISO 3166-1 alpha-2. Dodo requires a billing country for tax. */
  billingCountry: string;
  amountMicros: bigint;
  /** Where Dodo returns the browser once payment finishes. */
  returnUrl: string;
  cancelUrl: string;
}

/** Two uppercase letters. Anything else is refused rather than sent on to the provider. */
export function parseCountry(raw: unknown): string | null {
  return typeof raw === "string" && /^[A-Z]{2}$/.test(raw) ? raw : null;
}

export interface CheckoutSession {
  sessionId: string;
  /** The hosted page to send the advertiser to. */
  checkoutUrl: string;
}

export interface PaymentProvider {
  /** Null on any provider failure; the caller turns that into a 502 rather than a 500. */
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession | null>;
}

/** Smallest currency unit, which is what Dodo takes and returns. Micros are a millionth. */
export function microsToMinorUnits(micros: bigint): number {
  return Number(micros / 10_000n);
}

/** Funding bounds, so a typo cannot create a $4m payment link. */
export const FUNDING_LIMITS = {
  minMicros: 1_000_000n, // $1 — one 500-impression block at the auction floor
  maxMicros: 10_000_000_000n, // $10,000
} as const;

export function parseFundingAmount(raw: unknown): bigint | null {
  if (typeof raw !== "string" || !/^[0-9]{1,19}$/.test(raw)) return null;
  const value = BigInt(raw);
  if (value < FUNDING_LIMITS.minMicros || value > FUNDING_LIMITS.maxMicros) return null;
  // Dodo bills in whole minor units, so anything finer than a cent cannot be charged and
  // would silently round - better to refuse it than to take a different amount than asked.
  if (value % 10_000n !== 0n) return null;
  return value;
}

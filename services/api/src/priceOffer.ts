/**
 * Price offer: for a set number of days, every model paid from USD credits costs a set
 * percentage less. It changes what each request is charged and every price the service lists,
 * so the website, the AI credits page and the editor's model picker all show the offer price.
 *
 * Stored on the Tagflow config record beside the usage campaign, so an administrator starts and
 * stops it from the web admin with no desktop release. The discount comes out of ADCode's own
 * margin, so it is capped where a price would fall below what the provider charges. Public copy
 * says "N% off", never where the discount comes from. Pure.
 */
import { WALLET_MARKUP_PERCENT } from "./modelWallet.ts";

export interface PriceOffer { name: string; percent: number; startsAt: number; endsAt: number }
/** What the website and editors are told: enough to say "15% off until 30 November". */
export interface PublicPriceOffer { name: string; percent: number; endsAt: number }

/** The deepest discount that still leaves every price at or above the provider's own price. */
export const MAX_OFFER_PERCENT = Math.floor(100 * WALLET_MARKUP_PERCENT / (100 + WALLET_MARKUP_PERCENT));
export const MAX_OFFER_DAYS = 90;
export const MAX_OFFER_NAME = 60;
/**
 * How long after an offer ends requests are still charged the offer price. Listed prices are
 * cached for up to a minute at the edge and again in browsers and the pricing page, so for a
 * few minutes someone may still be looking at an offer price: they are never charged more.
 */
export const OFFER_GRACE_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

const isPercent = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_OFFER_PERCENT;

export function parseOffer(raw: unknown): PriceOffer | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some((key) => !["name", "percent", "startsAt", "endsAt"].includes(key))) return null;
  const { name, percent, startsAt, endsAt } = r;
  if (typeof name !== "string" || name.trim().length === 0 || name.trim().length > MAX_OFFER_NAME || !isPercent(percent)) return null;
  const at = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 9_000_000_000_000;
  if (!at(startsAt) || !at(endsAt) || endsAt <= startsAt || endsAt - startsAt > MAX_OFFER_DAYS * DAY_MS) return null;
  return { name: name.trim(), percent, startsAt, endsAt };
}

/** The offer running at `now`, or null. */
export function activeOffer(offer: PriceOffer | undefined, now: number): PriceOffer | null {
  return offer !== undefined && offer.startsAt <= now && now < offer.endsAt ? offer : null;
}

/** Percent off the prices listed at `now`: 0 when no offer is running. */
export function offerDiscount(offer: PriceOffer | undefined, now: number): number {
  return activeOffer(offer, now)?.percent ?? 0;
}

/** Percent off what a request starting at `now` is charged: the listed discount, kept through the grace period. */
export function chargeDiscount(offer: PriceOffer | undefined, now: number): number {
  return offer !== undefined && offer.startsAt <= now && now < offer.endsAt + OFFER_GRACE_MS ? offer.percent : 0;
}

/** The offer ended at `now`, kept on record so its grace period still applies. Unchanged if it already ended. */
export function endOffer(offer: PriceOffer, now: number): PriceOffer {
  return now >= offer.endsAt ? offer : { ...offer, endsAt: Math.max(offer.startsAt + 1, now) };
}

/** The running offer as the public config and the wallet report it, or null. */
export function publicOffer(offer: PriceOffer | undefined, now: number): PublicPriceOffer | null {
  const running = activeOffer(offer, now);
  return running === null ? null : { name: running.name, percent: running.percent, endsAt: running.endsAt };
}

/** An offer that starts now and runs for whole days. Null for a name, percent or length that is not allowed. */
export function startOffer(name: unknown, percent: unknown, days: unknown, now: number): PriceOffer | null {
  if (typeof days !== "number" || !Number.isSafeInteger(days) || days < 1 || days > MAX_OFFER_DAYS) return null;
  return parseOffer({ name, percent, startsAt: now, endsAt: now + days * DAY_MS });
}

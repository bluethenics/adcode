/**
 * Ad safety: the administrator's switches for who may advertise and who is paid for cards,
 * and the money held while an ad partner disputes it (2026-11-26).
 *
 * Written after Zeekend suspended ADCode on 2026-11-25 and the same-day audit
 * (docs/security, not published) found three things an administrator could not do from the
 * panel: stop one ad network on purpose, see or release earnings held for a partner's review,
 * and keep a brand-new advertiser's card off screens until somebody had looked at it. Each is
 * one setting or one button here, written to the audit log.
 *
 *  - `creativeReview`: "all" holds every new card for a decision in Admin > Creatives; "new-
 *    advertisers" (the default) holds the cards of an advertiser who has none approved yet, so
 *    a known advertiser's next card goes live as before; "auto" approves on submission, as
 *    ADCode did until 2.7.0. `parseCreative` checks the shape of a card either way.
 *  - `cardsNeedVerifiedEmail`: partner cards pay only accounts with a verified email (the
 *    default). Anonymous accounts cost nothing to make, so without this anybody could mint
 *    accounts and claims; the audit's finding 2.
 *
 * Both are read on every claim and every submission, through a short cache, and fall back to
 * these defaults when the table is not there yet, so this code can ship before its migration.
 */

export type CreativeReview = "auto" | "new-advertisers" | "all";
export const CREATIVE_REVIEWS: readonly CreativeReview[] = ["auto", "new-advertisers", "all"];

export interface AdSafetySettings {
  readonly creativeReview: CreativeReview;
  readonly cardsNeedVerifiedEmail: boolean;
  readonly updatedAt: number | null;
  readonly updatedBy: string | null;
}

export const DEFAULT_AD_SAFETY: AdSafetySettings = { creativeReview: "new-advertisers", cardsNeedVerifiedEmail: true, updatedAt: null, updatedBy: null };

export interface AdSafetyStore {
  get(): Promise<AdSafetySettings>;
  put(next: Pick<AdSafetySettings, "creativeReview" | "cardsNeedVerifiedEmail">, adminUid: string, now: number): Promise<void>;
}

/** What the earn route answers an unverified account when only verified accounts are paid. */
export const UNVERIFIED_CARD_MESSAGE = "Confirm your email to earn from sponsored cards. Cards still show until then, but pay nothing.";

/** The reason a breaker an administrator opened by hand carries (adIntegrity.ts). */
export const MANUAL_PAUSE_REASON = "manual";

/** The settings an administrator sent, or null when anything in them is not one of the choices. */
export function parseAdSafety(raw: unknown): Pick<AdSafetySettings, "creativeReview" | "cardsNeedVerifiedEmail"> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { creativeReview, cardsNeedVerifiedEmail } = raw as Record<string, unknown>;
  if (!CREATIVE_REVIEWS.includes(creativeReview as CreativeReview) || typeof cardsNeedVerifiedEmail !== "boolean") return null;
  return { creativeReview: creativeReview as CreativeReview, cardsNeedVerifiedEmail };
}

/** Whether a newly submitted card waits for an administrator, given the advertiser's history. */
export function creativeNeedsReview(settings: Pick<AdSafetySettings, "creativeReview">, advertiserHasApprovedCreative: boolean): boolean {
  if (settings.creativeReview === "all") return true;
  if (settings.creativeReview === "new-advertisers") return !advertiserHasApprovedCreative;
  return false;
}

/** The settings, or the defaults when they cannot be read: a missing table never stops ads. */
export async function readAdSafety(store: AdSafetyStore | undefined): Promise<AdSafetySettings> {
  if (store === undefined) return DEFAULT_AD_SAFETY;
  try { return await store.get(); } catch { return DEFAULT_AD_SAFETY; }
}

export function createMemoryAdSafetyStore(initial: AdSafetySettings = DEFAULT_AD_SAFETY): AdSafetyStore {
  let current = initial;
  return {
    async get() { return current; },
    async put(next, adminUid, now) { current = { ...next, updatedAt: now, updatedBy: adminUid }; },
  };
}

/* ── Earnings held for a partner's review (migrations 20261125135000 and 136000) ── */

export interface EarningHold {
  readonly uid: string;
  readonly reason: string;
  readonly heldMicros: string;
  readonly sourceMicros: string;
  readonly alreadySpentMicros: string;
  readonly placedAt: number;
  readonly placedBy: string;
  readonly note: string | null;
}

export interface EarningHoldSummary {
  readonly holds: readonly EarningHold[];
  /** Every active hold's money, not only the page shown. */
  readonly accounts: number;
  readonly heldMicros: string;
}

export interface EarningHoldStore {
  /** Active holds, largest first. */
  list(limit: number): Promise<EarningHoldSummary>;
  /** Releases one account's hold, or every active hold for `reason` when `uid` is null; answers how many. */
  release(input: { uid: string | null; reason: string; adminUid: string; now: number }): Promise<number>;
}

export const HOLD_REASON = /^[a-z][a-z0-9-]{1,39}$/;

/** A release request: one account (`uid`) or all of them (`all: true`), for one reason. */
export function parseHoldRelease(raw: unknown): { uid: string | null; reason: string } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const { uid, all, reason } = raw as Record<string, unknown>;
  const why = reason === undefined ? "zeekend-review" : reason;
  if (typeof why !== "string" || !HOLD_REASON.test(why)) return null;
  if (all === true && uid === undefined) return { uid: null, reason: why };
  if (typeof uid === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(uid) && all !== true) return { uid, reason: why };
  return null;
}

export function createMemoryEarningHoldStore(initial: readonly EarningHold[] = []): EarningHoldStore & { readonly active: () => readonly EarningHold[] } {
  let holds = [...initial];
  return {
    active: () => holds,
    async list(limit) {
      const sorted = [...holds].sort((a, b) => Number(BigInt(b.heldMicros) - BigInt(a.heldMicros)));
      return { holds: sorted.slice(0, limit), accounts: holds.length, heldMicros: holds.reduce((total, hold) => total + BigInt(hold.heldMicros), 0n).toString() };
    },
    async release({ uid, reason }) {
      const before = holds.length;
      holds = holds.filter((hold) => !(hold.reason === reason && (uid === null || hold.uid === uid)));
      return before - holds.length;
    },
  };
}

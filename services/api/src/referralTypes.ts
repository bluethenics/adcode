/**
 * The referral shapes `store.ts` has to name, on their own so it can name them without
 * importing `referrals.ts` - which imports `store.ts` back, a cycle the firewall refuses.
 * What they mean, and how they are computed, lives in `referrals.ts`.
 */

/** What one account's invites have come to. */
export interface ReferrerSummary {
  /** People who claimed this account's code. */
  claimed: number;
  /** Of them, seen using ADCode at least once. */
  seen: number;
  /** Of them, seen on two or more different days. */
  cameBack: number;
  advertisers: number;
  earnedMicros: bigint;
  last30Micros: bigint;
}

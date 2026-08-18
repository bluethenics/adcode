/**
 * The money ledger.
 *
 * Spec §6.2: nothing here is ever updated or deleted. A correction is a new entry that
 * references the one it corrects. An admin who can edit history is an admin who can
 * steal, so the structure - not a policy document - is what prevents it.
 *
 * Pure: a balance is a fold over entries. `balances/{uid}` in Firestore is a cache of
 * this function's output, and where the two disagree, this function wins.
 */

export type LedgerKind =
  | "impression"
  | "click"
  | "reversal"
  | "adjustment"
  | "withdrawal_requested"
  | "withdrawal_paid"
  | "withdrawal_failed";

export interface LedgerEntry {
  entryId: string;
  uid: string;
  kind: LedgerKind;
  /** Signed. Credits positive, debits negative. */
  micros: bigint;
  /** The entry this one corrects or settles, when there is one. */
  refId: string | null;
  createdAt: number;
  description: string;
  /** Present only on `adjustment`. */
  reason?: string;
  /** Present only on `adjustment`. */
  adminUid?: string;
  /** Present only on the withdrawal kinds. Shaped for Wise. */
  providerRef?: string;
  /** Present only on the withdrawal kinds. ISO 4217. */
  currency?: string;
}

export interface Balance {
  availableMicros: bigint;
  lifetimeMicros: bigint;
  pendingWithdrawalMicros: bigint;
}

export const EMPTY_BALANCE: Balance = {
  availableMicros: 0n,
  lifetimeMicros: 0n,
  pendingWithdrawalMicros: 0n,
};

/**
 * Fold one entry into a balance.
 *
 * `lifetimeMicros` tracks what was actually earned, so a reversal reduces it - otherwise
 * a user whose fraudulent earnings were clawed back keeps a lifetime figure they never
 * legitimately earned, which is exactly the number a dashboard shows most prominently.
 * An adjustment leaves it alone for the mirror-image reason: a correction is not
 * something the user earned.
 */
export function applyEntry(balance: Balance, entry: LedgerEntry): Balance {
  const { kind, micros } = entry;

  switch (kind) {
    case "impression":
    case "click":
    case "reversal":
      return {
        ...balance,
        availableMicros: balance.availableMicros + micros,
        lifetimeMicros: balance.lifetimeMicros + micros,
      };

    case "adjustment":
      return { ...balance, availableMicros: balance.availableMicros + micros };

    case "withdrawal_requested":
      // `micros` is negative: available falls, the same magnitude becomes pending.
      return {
        ...balance,
        availableMicros: balance.availableMicros + micros,
        pendingWithdrawalMicros: balance.pendingWithdrawalMicros - micros,
      };

    case "withdrawal_paid":
      // The hold settles. Available already fell at request time.
      return {
        ...balance,
        pendingWithdrawalMicros: balance.pendingWithdrawalMicros + micros,
      };

    case "withdrawal_failed":
      // The hold is released and the money comes back.
      return {
        ...balance,
        availableMicros: balance.availableMicros + micros,
        pendingWithdrawalMicros: balance.pendingWithdrawalMicros - micros,
      };
  }
}

export function foldBalance(entries: readonly LedgerEntry[]): Balance {
  return entries.reduce(applyEntry, EMPTY_BALANCE);
}

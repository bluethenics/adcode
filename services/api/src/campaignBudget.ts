/**
 * Moving budget from one of an advertiser's campaigns to another.
 *
 * An advertiser who put most of their credits behind one campaign should be able to shift
 * some of it to another without ending the first. Budget is not money on its own, though:
 * an *active* campaign's unspent budget is held out of the advertiser's available credits
 * (`reservedMicros`), and a paused one's is not. So the move has to carry the reservation
 * with it, and this is the one rule for how - every store applies it inside its own
 * transaction, and the Supabase function mirrors it line for line.
 *
 *   from active, to active   reserved unchanged: the held credits change campaign
 *   from active, to paused   reserved -= amount: the credits come back to available
 *   from paused, to active   reserved += amount: needs that much available
 *   from paused, to paused   reserved unchanged: neither held anything
 *
 * Only unspent budget moves. The source keeps at least what it has already spent, which
 * is why the caller must read the source's spend in the same transaction: a receipt that
 * settles between a read and the write could otherwise leave it below its spend.
 */
import type { AdvertiserRecord, CampaignBudgetMoveRefusal, CampaignRecord } from "./store.ts";

export interface BudgetMoveInput {
  advertiser: AdvertiserRecord;
  from: CampaignRecord;
  to: CampaignRecord;
  /** The source campaign's spend, read in the same transaction as everything else. */
  fromSpentMicros: bigint;
  amountMicros: bigint;
  /** The largest budget a campaign may carry; the destination may not pass it. */
  maxBudgetMicros: bigint;
}

export type BudgetMovePlan =
  | { ok: true; fromBudgetMicros: bigint; toBudgetMicros: bigint; reservedMicros: bigint }
  | { ok: false; reason: CampaignBudgetMoveRefusal };

export function planBudgetMove(input: BudgetMoveInput): BudgetMovePlan {
  const { advertiser, from, to, fromSpentMicros, amountMicros, maxBudgetMicros } = input;
  if (from.advertiserId !== advertiser.advertiserId || to.advertiserId !== advertiser.advertiserId) {
    return { ok: false, reason: "not-found" };
  }
  // An ended campaign has already given its unspent budget back, and cannot take more.
  if (from.campaignId === to.campaignId || from.status === "ended" || to.status === "ended") {
    return { ok: false, reason: "invalid-state" };
  }
  if (amountMicros <= 0n) return { ok: false, reason: "invalid-state" };

  const unspent = from.budgetMicros - fromSpentMicros;
  if (amountMicros > unspent) return { ok: false, reason: "exceeds-unspent" };

  const toBudgetMicros = to.budgetMicros + amountMicros;
  if (toBudgetMicros > maxBudgetMicros) return { ok: false, reason: "budget-limit" };

  // Only an increase in what is held needs covering. A move between two active campaigns
  // is neutral, so it goes through even for an advertiser whose credits have since shrunk.
  const held = (to.status === "active" ? amountMicros : 0n) - (from.status === "active" ? amountMicros : 0n);
  if (held > 0n && held > advertiser.fundedMicros - advertiser.reservedMicros) {
    return { ok: false, reason: "insufficient-funds" };
  }
  const reserved = advertiser.reservedMicros + held;

  return {
    ok: true,
    fromBudgetMicros: from.budgetMicros - amountMicros,
    toBudgetMicros,
    reservedMicros: reserved < 0n ? 0n : reserved,
  };
}

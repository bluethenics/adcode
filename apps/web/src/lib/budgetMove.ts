/**
 * Moving credits from one campaign's budget to another's, as the portal explains it.
 *
 * The server decides (`services/api/src/campaignBudget.ts`); this only says beforehand
 * what it will decide, so the advertiser reads what happens to their balance before they
 * press the button rather than after. All money stays in BigInt micros, as in `money.ts`.
 */
import { money } from "@/components/money";
import type { AdvertiserView, CampaignView } from "./api";

/** The largest budget a campaign may carry, as the API's `ADVERTISER_LIMITS` sets it. */
export const MAX_BUDGET_MICROS = 100_000_000_000n;

/** What a campaign could still spend - the only part of its budget that can move. */
export function unspentMicros(campaign: CampaignView): bigint {
  const left = BigInt(campaign.budgetMicros) - BigInt(campaign.spentMicros);
  return left > 0n ? left : 0n;
}

/**
 * Micros as the amount field takes them back: "40.00", or "12.345678" when the figure has
 * sub-cent spend in it, so "all unspent" moves exactly that and not a rounded neighbour.
 */
export function dollarsInput(micros: bigint): string {
  const whole = micros / 1_000_000n;
  let frac = (micros % 1_000_000n).toString().padStart(6, "0");
  while (frac.length > 2 && frac.endsWith("0")) frac = frac.slice(0, -1);
  return `${whole}.${frac}`;
}

/** Ended campaigns have already given their unspent budget back, and cannot take more. */
export function canHoldBudget(campaign: CampaignView): boolean {
  return campaign.status === "active" || campaign.status === "paused";
}

/** Where `from`'s credits can go: every other campaign still running or paused. */
export function moveTargets(campaigns: readonly CampaignView[], from: CampaignView): CampaignView[] {
  return campaigns.filter((c) => c.campaignId !== from.campaignId && canHoldBudget(c));
}

export type MoveCheck = { ok: true } | { ok: false; reason: string };

/** The refusals the server would give, in words, so the button can say why it is off. */
export function checkMove(
  from: CampaignView,
  to: CampaignView,
  amountMicros: bigint,
  advertiser: AdvertiserView | null,
): MoveCheck {
  if (amountMicros <= 0n) return { ok: false, reason: "Enter an amount to move." };
  const unspent = unspentMicros(from);
  if (amountMicros > unspent) {
    return { ok: false, reason: `${from.name} has ${money(unspent.toString())} left unspent; only that can move.` };
  }
  if (BigInt(to.budgetMicros) + amountMicros > MAX_BUDGET_MICROS) {
    return { ok: false, reason: `That would take ${to.name} past the ${money(MAX_BUDGET_MICROS.toString())} budget limit.` };
  }
  if (to.status === "active" && from.status !== "active" && advertiser !== null) {
    const available = BigInt(advertiser.availableMicros);
    if (amountMicros > available) {
      return {
        ok: false,
        reason: `${to.name} is live, so this needs ${money(amountMicros.toString())} available and you have ${money(available.toString())}. Add credits, or pause ${to.name} first.`,
      };
    }
  }
  return { ok: true };
}

/**
 * What the move does to the advertiser's balance.
 *
 * A live campaign's unspent budget is held out of "available"; a paused one's is not.
 * So the same move can free credits, commit them, or do neither, and an advertiser who
 * moves budget out of a paused campaign into a live one should not be surprised that it
 * comes out of their balance.
 */
export function describeMove(from: CampaignView, to: CampaignView, amountMicros: bigint): string {
  const amount = money(amountMicros.toString());
  const fromLive = from.status === "active";
  const toLive = to.status === "active";
  if (fromLive && toLive) return `Your available balance stays the same: the ${amount} stays committed, now to ${to.name}.`;
  if (fromLive) return `${amount} comes back to your available balance until ${to.name} goes live.`;
  if (toLive) return `${to.name} is live, so ${amount} is committed from your available balance.`;
  return "Neither campaign is live, so your available balance stays the same.";
}

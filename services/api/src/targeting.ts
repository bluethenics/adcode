/**
 * Which campaigns may be served, and in what order.
 *
 * Pure: takes candidates and returns a ranked subset. No store, no clock. v1 ranks by
 * CPM alone - an auction is a pricing decision the contract does not constrain, and can
 * replace this function without touching anything that calls it.
 */
import { advertiserCostMicros } from "./money.ts";
import type { CampaignRecord } from "./store.ts";

export interface Candidate {
  campaign: CampaignRecord;
  spentMicros: bigint;
}

export function selectCampaigns(
  candidates: readonly Candidate[],
  tags: readonly string[],
  count: number,
): CampaignRecord[] {
  if (count <= 0) return [];

  const wanted = new Set(tags);

  const eligible = candidates.filter(({ campaign, spentMicros }) => {
    if (campaign.status !== "active") return false;

    // An empty target list matches everyone. That is how a house ad reaches a user whose
    // tags we have never seen.
    const matches =
      campaign.targetTags.length === 0 || campaign.targetTags.some((t) => wanted.has(t));
    if (!matches) return false;

    // Serving an ad the campaign cannot pay for creates a user credit with no funding
    // behind it, so the check is 'can it afford one more', not 'is there anything left'.
    const remaining = campaign.budgetMicros - spentMicros;
    return remaining >= advertiserCostMicros(campaign.cpmMicros) && remaining > 0n;
  });

  eligible.sort((a, b) => {
    if (a.campaign.cpmMicros === b.campaign.cpmMicros) {
      // A stable tiebreak keeps serving reproducible, which matters when a test or a
      // support ticket asks why a particular user saw a particular ad.
      return a.campaign.campaignId.localeCompare(b.campaign.campaignId);
    }
    return a.campaign.cpmMicros > b.campaign.cpmMicros ? -1 : 1;
  });

  return eligible.slice(0, count).map((c) => c.campaign);
}

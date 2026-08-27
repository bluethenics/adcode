/**
 * Which campaigns may be served, and in what order.
 *
 * Pure: takes candidates and returns winners with the captured price for this serve. No
 * store and no clock; the caller provides the tie seed and market controls explicitly.
 */
import { advertiserCostMicros } from "./money.ts";
import type { CampaignRecord } from "./store.ts";

export interface Candidate {
  campaign: CampaignRecord;
  spentMicros: bigint;
}

export interface AuctionInput {
  candidates: readonly Candidate[];
  tags: readonly string[];
  count: number;
  floorCpmMicros: bigint;
  incrementCpmMicros: bigint;
  tieSeed: string;
}

export interface AuctionWinner {
  campaign: CampaignRecord;
  maxBidCpmMicros: bigint;
  clearingCpmMicros: bigint;
  costMicros: bigint;
}

function hashSeed(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function eligibleCandidates(
  candidates: readonly Candidate[],
  tags: readonly string[],
  floorCpmMicros = 0n,
): Candidate[] {
  const wanted = new Set(tags);
  return candidates.filter(({ campaign, spentMicros }) => {
    if (campaign.status !== "active" || campaign.cpmMicros < floorCpmMicros) return false;

    const matches =
      campaign.targetTags.length === 0 || campaign.targetTags.some((tag) => wanted.has(tag));
    if (!matches) return false;

    const remaining = campaign.budgetMicros - spentMicros;
    return remaining >= advertiserCostMicros(campaign.cpmMicros) && remaining > 0n;
  });
}

function rankCandidates(candidates: Candidate[], tieSeed: string): Candidate[] {
  const byBid = new Map<bigint, Candidate[]>();
  for (const candidate of candidates) {
    const group = byBid.get(candidate.campaign.cpmMicros) ?? [];
    group.push(candidate);
    byBid.set(candidate.campaign.cpmMicros, group);
  }

  const bids = [...byBid.keys()].sort((a, b) => (a === b ? 0 : a > b ? -1 : 1));
  return bids.flatMap((bid) => {
    const group = byBid.get(bid) ?? [];
    group.sort((a, b) => a.campaign.campaignId.localeCompare(b.campaign.campaignId));
    if (group.length < 2) return group;
    const offset = hashSeed(`${tieSeed}:${bid}`) % group.length;
    return [...group.slice(offset), ...group.slice(0, offset)];
  });
}

/**
 * A generalized second-price auction for one serving batch.
 *
 * Each winner pays one increment above the next ranked bid. The price can never exceed
 * its own maximum bid, and never falls below the configured market floor.
 */
export function runAuction(input: AuctionInput): AuctionWinner[] {
  if (input.count <= 0) return [];

  const ranked = rankCandidates(
    eligibleCandidates(input.candidates, input.tags, input.floorCpmMicros),
    input.tieSeed,
  );

  return ranked.slice(0, input.count).map(({ campaign }, index) => {
    const nextBid = ranked[index + 1]?.campaign.cpmMicros;
    const competitivePrice =
      nextBid === undefined ? input.floorCpmMicros : nextBid + input.incrementCpmMicros;
    const clearingCpmMicros =
      competitivePrice > campaign.cpmMicros ? campaign.cpmMicros : competitivePrice;

    return {
      campaign,
      maxBidCpmMicros: campaign.cpmMicros,
      clearingCpmMicros,
      costMicros: advertiserCostMicros(clearingCpmMicros),
    };
  });
}

export function selectCampaigns(
  candidates: readonly Candidate[],
  tags: readonly string[],
  count: number,
): CampaignRecord[] {
  if (count <= 0) return [];

  const eligible = eligibleCandidates(candidates, tags);

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

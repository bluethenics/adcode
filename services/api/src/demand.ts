import { advertiserCostMicros, formatMicros } from "./money.ts";
import type { Store } from "./store.ts";

export interface DemandView {
  clearingCpmMicros: string;
  activeCampaigns: number;
  demandLevel: "low" | "medium" | "high";
  floorCpmMicros: string;
  asOf: number;
  history: Array<{ at: number; clearingCpmMicros: string }>;
}

export async function readDemand(store: Store, now: number): Promise<DemandView> {
  const [config, history] = await Promise.all([
    store.getConfig(),
    store.marketPriceHistory(now - 24 * 60 * 60 * 1000),
  ]);
  const bids: bigint[] = [];

  for (const advertiser of await store.listAdvertisers()) {
    if (
      advertiser.status !== "active" ||
      advertiser.fundedMicros <= 0n ||
      advertiser.fundedMicros < advertiser.reservedMicros
    ) {
      continue;
    }
    for (const campaign of await store.campaignsForAdvertiser(advertiser.advertiserId)) {
      if (campaign.status !== "active" || campaign.cpmMicros < config.floorCpmMicros) continue;
      const spent = await store.getSpend(campaign.campaignId);
      if (campaign.budgetMicros - spent < advertiserCostMicros(campaign.cpmMicros)) continue;
      if (!(await store.creativesForCampaign(campaign.campaignId)).some((creative) => creative.status === "approved")) continue;
      bids.push(campaign.cpmMicros);
    }
  }

  bids.sort((a, b) => (a === b ? 0 : a > b ? -1 : 1));
  const top = bids[0];
  const runnerUp = bids[1];
  const competitive =
    runnerUp === undefined ? config.floorCpmMicros : runnerUp + config.auctionIncrementCpmMicros;
  const clearing = top !== undefined && competitive > top ? top : competitive;
  const activeCampaigns = bids.length;

  return {
    clearingCpmMicros: formatMicros(clearing),
    activeCampaigns,
    demandLevel: activeCampaigns >= 5 ? "high" : activeCampaigns >= 2 ? "medium" : "low",
    floorCpmMicros: formatMicros(config.floorCpmMicros),
    asOf: now,
    history: history.map((point) => ({
      at: point.at,
      clearingCpmMicros: formatMicros(point.clearingCpmMicros),
    })),
  };
}

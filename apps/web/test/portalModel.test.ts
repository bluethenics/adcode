import { describe, expect, it } from "vitest";
import type { AdvertiserView, CampaignView } from "../src/lib/api";
import { campaignState, compact, ctr, dollarsFromMicros, estimateReach, isHttpsUrl, legacyPortalTarget, range } from "../src/lib/portalModel";

const campaign = (patch: Partial<CampaignView>): CampaignView => ({
  campaignId: "camp_1", name: "Tracewell", status: "paused", cpmMicros: "2000000", budgetMicros: "100000000", spentMicros: "0",
  targetTags: [], createdAt: 0, serves: 0, impressions: 0, clicks: 0, ...patch,
});
const advertiser = (available: string): AdvertiserView => ({ advertiserId: "adv_1", name: "Tracewell", status: "active", fundedMicros: available, reservedMicros: "0", availableMicros: available });

describe("the advertiser portal's rules", () => {
  it("names a paused campaign the balance cannot cover as waiting, with the exact shortfall", () => {
    const state = campaignState(campaign({ budgetMicros: "250000000" }), advertiser("40000000"));
    expect(state).toEqual({ label: "Needs credits", tone: "waiting", shortfallMicros: 210_000_000n });
    expect(dollarsFromMicros(state.shortfallMicros)).toBe("210.00");
    expect(campaignState(campaign({}), advertiser("100000000")).label).toBe("Paused");
    expect(campaignState(campaign({ status: "active" }), null).label).toBe("Live");
    expect(campaignState(campaign({ status: "active", spentMicros: "100000000" }), null).label).toBe("Budget spent");
    expect(campaignState(campaign({ status: "ended" }), null).label).toBe("Ended");
  });

  it("estimates views as a range between the bid and the floor, and clicks only from a sane rate", () => {
    // $100 at a $1.40 block bid: 71 blocks. At the $1 floor: 100 blocks.
    const plain = estimateReach(100_000_000n, 1_400_000n);
    expect([plain.viewsLow, plain.viewsHigh, plain.clicksLow]).toEqual([35_500, 50_000, null]);
    expect(range(plain.viewsLow, plain.viewsHigh)).toBe("35.5K-50K");

    const network = estimateReach(100_000_000n, 1_000_000n, { network: { clicks: 5_861, impressions: 412_930 } });
    expect(network.clickRateSource).toBe("network");
    expect(network.clicksHigh).toBe(710);
    // More clicks than views is not a rate to project from.
    expect(estimateReach(100_000_000n, 1_000_000n, { network: { clicks: 84_093, impressions: 20_116 } }).clicksLow).toBeNull();
    // Your own rate wins once you have one.
    expect(estimateReach(100_000_000n, 1_000_000n, { yours: { clicks: 50, views: 5_000 }, network: { clicks: 1, impressions: 1_000 } }).clickRateSource).toBe("yours");
  });

  it("formats and validates the way the API expects", () => {
    expect(isHttpsUrl("https://tracewell.dev/x")).toBe(true);
    expect(isHttpsUrl("http://tracewell.dev")).toBe(false);
    expect(isHttpsUrl("https://localhost")).toBe(false);
    expect(ctr(389, 28_413)).toBe("1.37%");
    expect(ctr(0, 0)).toBeNull();
    expect(compact(15_284)).toBe("15.3K");
  });

  it("sends the old one-page anchors and return addresses to their new pages", () => {
    expect(legacyPortalTarget("#new-campaign", "")).toBe("/portal/campaigns/new");
    expect(legacyPortalTarget("#credits", "")).toBe("/portal/billing");
    expect(legacyPortalTarget("", "?campaign=camp_9&created=1")).toBe("/portal/campaigns/camp_9?created=1");
    expect(legacyPortalTarget("", "?checkout=success&order=o1")).toBeNull();
    expect(legacyPortalTarget("", "?campaign=../../x")).toBeNull();
  });
});

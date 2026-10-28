import { describe, expect, it } from "vitest";
import { MAX_CAMPAIGN_DAYS, activeCampaign, parseCampaign, startCampaign } from "../src/usageCampaign.ts";

const DAY = 86_400_000;

describe("usage campaign rules", () => {
  it("starts now and runs for whole days", () => {
    expect(startCampaign("Free week", 4, 1000)).toEqual({ name: "Free week", startsAt: 1000, endsAt: 1000 + 4 * DAY });
    expect(startCampaign("  Free week  ", 4, 1000)?.name).toBe("Free week");
  });

  it("refuses a missing name, a fractional or oversized length, and unknown fields", () => {
    expect(startCampaign("", 4, 1000)).toBeNull();
    expect(startCampaign(7, 4, 1000)).toBeNull();
    expect(startCampaign("x".repeat(81), 4, 1000)).toBeNull();
    expect(startCampaign("A", 0, 1000)).toBeNull();
    expect(startCampaign("A", 1.5, 1000)).toBeNull();
    expect(startCampaign("A", MAX_CAMPAIGN_DAYS + 1, 1000)).toBeNull();
    expect(parseCampaign({ name: "A", startsAt: 1, endsAt: 2, extra: true })).toBeNull();
    expect(parseCampaign({ name: "A", startsAt: 5, endsAt: 5 })).toBeNull();
  });

  it("is active from its start up to, but not including, its end", () => {
    const campaign = { name: "A", startsAt: 100, endsAt: 200 };
    expect(activeCampaign(campaign, 99)).toBeNull();
    expect(activeCampaign(campaign, 100)).toBe(campaign);
    expect(activeCampaign(campaign, 199)).toBe(campaign);
    expect(activeCampaign(campaign, 200)).toBeNull();
    expect(activeCampaign(undefined, 150)).toBeNull();
  });
});

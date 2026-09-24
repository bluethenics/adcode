import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";

describe("public network statistics", () => {
  it("counts lifetime paid impressions and clicks, excludes tests, and exposes no identities", async () => {
    const store = createMemoryStore();
    const receipt = { uid: "private-user", campaignId: "private-campaign", creativeId: "private-creative", creditedMicros: 500n, costMicros: 1000n, createdAt: 1 };
    await store.createReceiptIfAbsent({ ...receipt, receiptId: "view", outcome: "view" });
    await store.createReceiptIfAbsent({ ...receipt, receiptId: "click", outcome: "click" });
    await store.createReceiptIfAbsent({ ...receipt, receiptId: "test", outcome: "view", costMicros: 0n, creditedMicros: 0n });
    await store.createReceiptIfAbsent({ ...receipt, receiptId: "view", outcome: "view" });
    const campaign = { advertiserId: "private-advertiser", name: "Private", cpmMicros: 2000000n, budgetMicros: 10000000n, targetTags: [], createdAt: 1 };
    await store.putCampaign({ ...campaign, campaignId: "active", status: "active" });
    await store.putCampaign({ ...campaign, campaignId: "paused", status: "paused" });
    const handler = createFetchHandler({ store, verifier: { verify: async () => null } });
    const response = await handler(new Request("https://example.test/v1/stats"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    const value = await response.json();
    expect(value).toEqual({ impressions: 1, clicks: 1, activeCampaigns: 1, asOf: expect.any(Number) });
    expect(JSON.stringify(value)).not.toContain("private");
  });
  it("distinguishes empty data from an unavailable database", async () => {
    const store = createMemoryStore();
    expect(await store.publicStats()).toEqual({ impressions: 0, clicks: 0, activeCampaigns: 0 });
    store.publicStats = async () => { throw new Error("unavailable"); };
    const handler = createFetchHandler({ store, verifier: { verify: async () => null } });
    expect((await handler(new Request("https://example.test/v1/stats"))).status).toBe(500);
  });
});

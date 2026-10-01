import { describe, expect, it } from "vitest";
import { createMemoryStore } from "../src/memoryStore.ts";
import { createFetchHandler } from "../src/fetchHandler.ts";

const NOW = Date.UTC(2026, 9, 2, 12);

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
    await store.putUser({ uid: "active-developer", status: "active", createdAt: 1 });
    await store.putUser({ uid: "banned-developer", status: "banned", createdAt: 1 });
    await store.putUser({ uid: "new-developer", status: "active", createdAt: NOW - 86_400_000 });
    const handler = createFetchHandler({ store, clock: { now: () => NOW }, verifier: { verify: async () => null } });
    const response = await handler(new Request("https://example.test/v1/stats"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("max-age=60");
    const value = await response.json();
    expect(value).toEqual({ impressions: 1, clicks: 1, activeCampaigns: 1, developers: 2, developersThisWeek: 1, asOf: NOW });
    expect(JSON.stringify(value)).not.toContain("private");
  });
  it("distinguishes empty data from an unavailable database", async () => {
    const store = createMemoryStore();
    expect(await store.publicStats(NOW)).toEqual({ impressions: 0, clicks: 0, activeCampaigns: 0, developers: 0, developersThisWeek: 0 });
    store.publicStats = async () => { throw new Error("unavailable"); };
    const handler = createFetchHandler({ store, verifier: { verify: async () => null } });
    expect((await handler(new Request("https://example.test/v1/stats"))).status).toBe(500);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { readDemand } from "../src/demand.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

let store: ReturnType<typeof createMemoryStore>;

beforeEach(() => {
  store = createMemoryStore();
});

async function marketCampaign(id: string, bid: bigint, status: "active" | "paused" = "active") {
  await store.putAdvertiser({
    advertiserId: `adv-${id}`,
    name: id,
    ownerUids: [`u-${id}`],
    status: "active",
    fundedMicros: 100_000_000n,
    reservedMicros: 50_000_000n,
    createdAt: 1,
  });
  await store.putCampaign({
    campaignId: id,
    advertiserId: `adv-${id}`,
    name: id,
    createdAt: 1,
    cpmMicros: bid,
    budgetMicros: 50_000_000n,
    targetTags: ["lang:rust"],
    status,
  });
  await store.putCreative({
    creativeId: `cr-${id}`,
    campaignId: id,
    advertiser: id,
    headline: id,
    body: null,
    clickUrl: "https://example.test",
    logoLight: "https://example.test/l.png",
    logoDark: "https://example.test/d.png",
    status: "approved",
  });
}

describe("readDemand", () => {
  it("returns only a redacted indicative market aggregate", async () => {
    await marketCampaign("high", 8_000_000n);
    await marketCampaign("runner", 5_000_000n);
    await marketCampaign("paused-secret", 20_000_000n, "paused");

    const result = await readDemand(store, 1234);
    expect(result).toEqual({
      clearingCpmMicros: "5020000",
      activeCampaigns: 2,
      demandLevel: "medium",
      floorCpmMicros: "2000000",
      asOf: 1234,
      history: [],
    });
    expect(JSON.stringify(result)).not.toMatch(/advertiser|campaignId|budget|tags|8000000/);
  });

  it("labels zero or one eligible campaigns low and five or more high", async () => {
    expect(await readDemand(store, 1)).toMatchObject({
      clearingCpmMicros: "2000000",
      floorCpmMicros: "2000000",
      demandLevel: "low",
    });
    for (let index = 0; index < 5; index += 1) await marketCampaign(`c${index}`, 4_000_000n);
    expect((await readDemand(store, 2)).demandLevel).toBe("high");
  });

  it("publishes hourly history from real non-test serves without campaign detail", async () => {
    const hour = 3_600_000;
    await store.recordServe({
      serveId: "old",
      uid: "u-secret",
      creativeId: "cr-secret",
      campaignId: "campaign-secret",
      servedAt: 100 * hour,
      expiresAt: 101 * hour,
      maxBidCpmMicros: 8_000_000n,
      clearingCpmMicros: 4_000_000n,
      costMicros: 4_000n,
    });
    await store.recordServe({
      serveId: "recent-a",
      uid: "u-secret",
      creativeId: "cr-secret",
      campaignId: "campaign-secret",
      servedAt: 125 * hour + 1,
      expiresAt: 126 * hour,
      maxBidCpmMicros: 8_000_000n,
      clearingCpmMicros: 3_000_000n,
      costMicros: 3_000n,
    });
    await store.recordServe({
      serveId: "recent-b",
      uid: "u-other",
      creativeId: "cr-other",
      campaignId: "campaign-other",
      servedAt: 125 * hour + 2,
      expiresAt: 126 * hour,
      maxBidCpmMicros: 9_000_000n,
      clearingCpmMicros: 5_000_000n,
      costMicros: 5_000n,
    });
    await store.recordServe({
      serveId: "test",
      uid: "admin",
      creativeId: "cr-test",
      campaignId: "campaign-test",
      servedAt: 125 * hour + 3,
      expiresAt: 126 * hour,
      maxBidCpmMicros: 0n,
      clearingCpmMicros: 0n,
      costMicros: 0n,
      test: true,
    });

    const result = await readDemand(store, 126 * hour);
    expect(result.history).toEqual([{ at: 125 * hour, clearingCpmMicros: "4000000" }]);
    expect(JSON.stringify(result.history)).not.toMatch(/secret|campaign|creative|uid/);
  });
});

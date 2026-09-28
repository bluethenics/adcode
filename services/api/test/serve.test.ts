import { describe, it, expect, beforeEach } from "vitest";
import { handleServe } from "../src/serve.ts";
import { createMemoryStore, DEFAULT_CONFIG } from "../src/memoryStore.ts";

let store: ReturnType<typeof createMemoryStore>;
let counter = 0;
const deps = () => ({
  store,
  clock: { now: () => 5_000 },
  ids: { next: (p: string) => `${p}-${++counter}` },
  random: () => 0,
});

beforeEach(async () => {
  counter = 0;
  store = createMemoryStore();
  await store.putCampaign({
    campaignId: "camp-1",
    advertiserId: "adv-1",
    name: "camp-1 campaign",
    createdAt: 0,
    cpmMicros: 8_000_000n,
    budgetMicros: 1_000_000n,
    targetTags: ["lang:rust"],
    status: "active",
  });
  await store.putCreative({
    creativeId: "c-1",
    campaignId: "camp-1",
    advertiser: "Acme",
    headline: "Ship faster",
    body: "A tool for Rust teams",
    clickUrl: "https://acme.test/x",
    logoLight: "https://cdn.test/l.png",
    logoDark: "https://cdn.test/d.png",
    status: "approved",
  });
});

describe("handleServe", () => {
  it("returns a matching creative", async () => {
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(res.creatives).toHaveLength(1);
    expect(res.creatives[0]?.creativeId).toBe("c-1");
    expect(res.creatives[0]?.headline).toBe("Ship faster");
  });

  it("writes a serve record, so the matching receipt can later be trusted", async () => {
    await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(await store.findServe("u-1", "c-1", 5_500)).not.toBeNull();
  });

  it("snapshots the winning bid and clearing price on the serve record", async () => {
    await store.putCampaign({
      campaignId: "camp-2",
      advertiserId: "adv-2",
      name: "runner-up",
      createdAt: 0,
      cpmMicros: 5_000_000n,
      budgetMicros: 1_000_000n,
      targetTags: ["lang:rust"],
      status: "active",
    });

    await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    const serve = await store.findServe("u-1", "c-1", 5_500);

    expect(serve).toMatchObject({
      maxBidCpmMicros: 8_000_000n,
      clearingCpmMicros: 5_020_000n,
      costMicros: 5_020n,
    });
  });

  it("gives that record a TTL from config", async () => {
    await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    const beyondTtl = 5_000 + DEFAULT_CONFIG.serveTtlMs + 1;
    expect(await store.findServe("u-1", "c-1", beyondTtl)).toBeNull();
  });

  it("records only one slot's winner even when older clients request ten cards", async () => {
    await store.putCampaign({
      campaignId: "camp-2",
      advertiserId: "adv-2",
      name: "runner-up",
      createdAt: 0,
      cpmMicros: 5_000_000n,
      budgetMicros: 1_000_000n,
      targetTags: ["lang:rust"],
      status: "active",
    });
    await store.putCreative({
      ...(await store.getCreative("c-1"))!,
      creativeId: "c-2",
      campaignId: "camp-2",
    });

    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 10 });

    expect(res.creatives.map((creative) => creative.creativeId)).toEqual(["c-1"]);
    expect(await store.findServe("u-1", "c-1", 5_500)).toMatchObject({
      clearingCpmMicros: 5_020_000n,
      costMicros: 5_020n,
    });
    expect(await store.findServe("u-1", "c-2", 5_500)).toBeNull();
  });

  it("backfills the single slot when the highest bidder has no approved creative", async () => {
    await store.putCampaign({
      campaignId: "camp-2",
      advertiserId: "adv-2",
      name: "no artwork",
      createdAt: 0,
      cpmMicros: 9_000_000n,
      budgetMicros: 1_000_000n,
      targetTags: ["lang:rust"],
      status: "active",
    });

    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });

    expect(res.creatives.map((creative) => creative.creativeId)).toEqual(["c-1"]);
    expect(await store.findServe("u-1", "c-1", 5_500)).not.toBeNull();
  });

  it("gives every eligible campaign an equal share of draws despite different bids", async () => {
    for (const [id, bid] of [[2, 5_000_000n], [3, 2_000_000n]] as const) {
      await store.putCampaign({
        ...(await store.getCampaign("camp-1"))!,
        campaignId: `camp-${id}`,
        cpmMicros: bid,
      });
      await store.putCreative({
        ...(await store.getCreative("c-1"))!,
        creativeId: `c-${id}`,
        campaignId: `camp-${id}`,
      });
    }

    const counts = new Map<string, number>();
    // Sweep the draw range without relying on luck or a fixed user assignment.
    for (let draw = 0; draw < 300; draw += 1) {
      const res = await handleServe({ ...deps(), random: () => draw / 300 }, "u-1", {
        tags: ["lang:rust"], themeKind: "dark", count: 10,
      });
      expect(res.creatives).toHaveLength(1);
      const id = res.creatives[0]!.creativeId;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }

    expect(Object.fromEntries(counts)).toEqual({ "c-1": 100, "c-2": 100, "c-3": 100 });
    expect(await store.findServe("u-1", "c-3", 5_500)).toMatchObject({
      campaignId: "camp-3",
      maxBidCpmMicros: 2_000_000n,
      clearingCpmMicros: DEFAULT_CONFIG.floorCpmMicros,
      costMicros: DEFAULT_CONFIG.floorCpmMicros / 1_000n,
    });
    // Fetching a card alone must not bill any campaign.
    for (const id of ["camp-1", "camp-2", "camp-3"]) {
      expect(await store.getSpend(id)).toBe(0n);
    }
  });

  it("shares delivery only among funded, matching, live campaigns with approved artwork", async () => {
    const original = (await store.getCampaign("camp-1"))!;
    const creative = (await store.getCreative("c-1"))!;
    const ineligible = [
      { ...original, campaignId: "paused", status: "paused" as const },
      { ...original, campaignId: "spent", budgetMicros: 0n },
      { ...original, campaignId: "insufficient", budgetMicros: 1n },
      { ...original, campaignId: "unmatched", targetTags: ["lang:php"] },
      { ...original, campaignId: "below-floor", cpmMicros: DEFAULT_CONFIG.floorCpmMicros - 1n },
      { ...original, campaignId: "pending" },
    ];
    for (const campaign of ineligible) {
      await store.putCampaign(campaign);
      await store.putCreative({
        ...creative,
        creativeId: campaign.campaignId,
        campaignId: campaign.campaignId,
        status: campaign.campaignId === "pending" ? "pending" : "approved",
      });
    }

    for (const draw of [0, 0.5, 0.999999]) {
      const res = await handleServe({ ...deps(), random: () => draw }, "u-1", {
        tags: ["lang:rust"], themeKind: "dark", count: 10,
      });
      expect(res.creatives.map((card) => card.creativeId)).toEqual(["c-1"]);
    }
    for (const campaign of ineligible) {
      expect(await store.findServe("u-1", campaign.campaignId, 5_500)).toBeNull();
    }
  });

  it("reports the same TTL to the client that it enforces", async () => {
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(res.creatives[0]?.ttlMs).toBe(DEFAULT_CONFIG.serveTtlMs);
  });

  it("serves nothing when the kill switch is on", async () => {
    await store.putConfig({ ...DEFAULT_CONFIG, killSwitch: true });
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(res.creatives).toEqual([]);
  });

  it("writes no serve record when the kill switch is on", async () => {
    await store.putConfig({ ...DEFAULT_CONFIG, killSwitch: true });
    await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(await store.findServe("u-1", "c-1", 5_500)).toBeNull();
  });

  it("serves nothing when no campaign matches the tags", async () => {
    const res = await handleServe(deps(), "u-1", { tags: ["lang:php"], themeKind: "dark", count: 1 });
    expect(res.creatives).toEqual([]);
  });

  it("skips a campaign with no approved creative", async () => {
    await store.putCreative({
      creativeId: "c-1",
      campaignId: "camp-1",
      advertiser: "Acme",
      headline: "Ship faster",
      body: null,
      clickUrl: "https://acme.test/x",
      logoLight: "https://cdn.test/l.png",
      logoDark: "https://cdn.test/d.png",
      status: "pending",
    });
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(res.creatives).toEqual([]);
  });

  it("never exceeds the count asked for", async () => {
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 0 });
    expect(res.creatives).toEqual([]);
  });

  it("serves nothing to a campaign that has exhausted its budget", async () => {
    await store.addSpend("camp-1", 1_000_000n);
    const res = await handleServe(deps(), "u-1", { tags: ["lang:rust"], themeKind: "dark", count: 1 });
    expect(res.creatives).toEqual([]);
  });
});

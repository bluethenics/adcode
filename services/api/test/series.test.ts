import { describe, it, expect, beforeEach } from "vitest";
import { campaignSeries, createAdvertiser, createCampaign } from "../src/advertisers.ts";
import { parseCampaign } from "../src/contract.ts";
import { createMemoryStore } from "../src/memoryStore.ts";

const NOW = Date.UTC(2026, 7, 24, 12, 0, 0);
const DAY = 86_400_000;

let store: ReturnType<typeof createMemoryStore>;
let counter = 0;
const deps = () => ({
  store,
  clock: { now: () => NOW },
  ids: { next: (p: string) => `${p}-${++counter}` },
});

const CAMPAIGN = {
  name: "Rust developers, Q3",
  cpmMicros: "8000000",
  budgetMicros: "50000000",
  targetTags: ["lang:rust"],
};

beforeEach(() => {
  counter = 0;
  store = createMemoryStore();
});

/** A receipt at a chosen moment. The timestamp is the whole point of these tests. */
async function receipt(campaignId: string, at: number, outcome = "impression"): Promise<void> {
  await store.createReceiptIfAbsent({
    receiptId: `r-${++counter}`,
    uid: "viewer",
    creativeId: "cr-1",
    campaignId,
    outcome,
    creditedMicros: 4_000n,
    costMicros: 8_000n,
    createdAt: at,
  });
}

async function withCampaign(uid: string, name: string): Promise<string> {
  const created = await createCampaign(deps(), uid, parseCampaign({ ...CAMPAIGN, name })!);
  if (!created.ok) throw new Error("campaign not created");
  return created.value.campaignId;
}

describe("campaignSeries", () => {
  it("refuses someone with no advertiser account", async () => {
    const result = await campaignSeries(deps(), "nobody", 30);
    expect(result).toEqual({ ok: false, error: "no-advertiser" });
  });

  it("is empty, not an error, before anything has been served", async () => {
    await createAdvertiser(deps(), "u-1", { name: "Acme" });
    const result = await campaignSeries(deps(), "u-1", 30);
    expect(result).toEqual({ ok: true, value: [] });
  });

  it("buckets receipts by day and campaign", async () => {
    await createAdvertiser(deps(), "u-1", { name: "Acme" });
    const first = await withCampaign("u-1", "First");
    const second = await withCampaign("u-1", "Second");

    await receipt(first, NOW);
    await receipt(first, NOW);
    await receipt(first, NOW, "click");
    await receipt(first, NOW - 2 * DAY);
    await receipt(second, NOW);

    const result = await campaignSeries(deps(), "u-1", 30);
    if (!result.ok) throw new Error(result.error);

    expect(result.value).toHaveLength(3);

    const today = result.value.filter((p) => p.day === "2026-08-24");
    expect(today).toHaveLength(2);

    const todayFirst = today.find((p) => p.campaignId === first);
    expect(todayFirst).toMatchObject({ impressions: 2, clicks: 1, spentMicros: "24000" });

    const earlier = result.value.find((p) => p.day === "2026-08-22");
    expect(earlier).toMatchObject({ impressions: 1, clicks: 0 });
  });

  it("comes back oldest day first, so a line chart can read it straight through", async () => {
    await createAdvertiser(deps(), "u-1", { name: "Acme" });
    const campaignId = await withCampaign("u-1", "First");

    await receipt(campaignId, NOW);
    await receipt(campaignId, NOW - 3 * DAY);
    await receipt(campaignId, NOW - DAY);

    const result = await campaignSeries(deps(), "u-1", 30);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.map((p) => p.day)).toEqual(["2026-08-21", "2026-08-23", "2026-08-24"]);
  });

  it("leaves receipts older than the window out", async () => {
    await createAdvertiser(deps(), "u-1", { name: "Acme" });
    const campaignId = await withCampaign("u-1", "First");

    await receipt(campaignId, NOW);
    await receipt(campaignId, NOW - 40 * DAY);

    const result = await campaignSeries(deps(), "u-1", 7);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.map((p) => p.day)).toEqual(["2026-08-24"]);
  });

  it("never shows one advertiser another advertiser's campaign", async () => {
    await createAdvertiser(deps(), "u-1", { name: "Acme" });
    await createAdvertiser(deps(), "u-2", { name: "Rival" });

    const mine = await withCampaign("u-1", "Mine");
    const theirs = await withCampaign("u-2", "Theirs");

    await receipt(mine, NOW);
    await receipt(theirs, NOW);
    await receipt(theirs, NOW);

    const result = await campaignSeries(deps(), "u-1", 30);
    if (!result.ok) throw new Error(result.error);
    expect(result.value).toHaveLength(1);
    expect(result.value[0]?.campaignId).toBe(mine);
  });
});

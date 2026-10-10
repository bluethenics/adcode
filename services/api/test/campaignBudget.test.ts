import { beforeEach, describe, expect, it } from "vitest";
import { getMyAdvertiser, moveCampaignBudget } from "../src/advertisers.ts";
import { planBudgetMove, type BudgetMoveInput } from "../src/campaignBudget.ts";
import { ADVERTISER_LIMITS, parseBudgetMove } from "../src/contract.ts";
import { createMemoryStore } from "../src/memoryStore.ts";
import type { AdvertiserRecord, CampaignRecord } from "../src/store.ts";

const ADVERTISER: AdvertiserRecord = {
  advertiserId: "adv-1",
  name: "Acme",
  ownerUids: ["u-1"],
  status: "active",
  fundedMicros: 100_000_000n,
  reservedMicros: 60_000_000n,
  createdAt: 1,
};

const campaign = (campaignId: string, over: Partial<CampaignRecord> = {}): CampaignRecord => ({
  campaignId,
  advertiserId: "adv-1",
  name: campaignId,
  createdAt: 1,
  cpmMicros: 8_000_000n,
  budgetMicros: 60_000_000n,
  targetTags: [],
  status: "active",
  ...over,
});

const input = (over: Partial<BudgetMoveInput> = {}): BudgetMoveInput => ({
  advertiser: ADVERTISER,
  from: campaign("camp-a"),
  to: campaign("camp-b", { budgetMicros: 5_000_000n, status: "paused" }),
  fromSpentMicros: 0n,
  amountMicros: 20_000_000n,
  maxBudgetMicros: ADVERTISER_LIMITS.maxBudgetMicros,
  ...over,
});

describe("planBudgetMove: the reservation follows the money", () => {
  it("active to active leaves the held credits where they are", () => {
    const plan = planBudgetMove(input({ to: campaign("camp-b", { budgetMicros: 5_000_000n }) }));
    expect(plan).toEqual({ ok: true, fromBudgetMicros: 40_000_000n, toBudgetMicros: 25_000_000n, reservedMicros: 60_000_000n });
  });

  it("active to paused gives the moved credits back to available", () => {
    expect(planBudgetMove(input())).toMatchObject({ ok: true, reservedMicros: 40_000_000n });
  });

  it("paused to active holds the moved credits, out of what is available", () => {
    const plan = planBudgetMove(input({
      from: campaign("camp-a", { status: "paused" }),
      to: campaign("camp-b", { budgetMicros: 5_000_000n }),
    }));
    expect(plan).toMatchObject({ ok: true, reservedMicros: 80_000_000n });
  });

  it("paused to active is refused when available cannot cover it", () => {
    const plan = planBudgetMove(input({
      from: campaign("camp-a", { status: "paused" }),
      to: campaign("camp-b", { budgetMicros: 5_000_000n }),
      amountMicros: 40_000_001n,
    }));
    expect(plan).toEqual({ ok: false, reason: "insufficient-funds" });
  });

  it("paused to paused holds nothing either side", () => {
    const plan = planBudgetMove(input({ from: campaign("camp-a", { status: "paused" }) }));
    expect(plan).toMatchObject({ ok: true, reservedMicros: 60_000_000n });
  });

  it("lets a neutral move through for an advertiser whose credits have since shrunk", () => {
    const plan = planBudgetMove(input({
      advertiser: { ...ADVERTISER, fundedMicros: 10_000_000n },
      to: campaign("camp-b", { budgetMicros: 5_000_000n }),
    }));
    expect(plan.ok).toBe(true);
  });
});

describe("planBudgetMove: what may move", () => {
  it("moves only what is unspent, all of it if asked", () => {
    expect(planBudgetMove(input({ fromSpentMicros: 45_000_000n, amountMicros: 15_000_000n })))
      .toMatchObject({ ok: true, fromBudgetMicros: 45_000_000n });
    expect(planBudgetMove(input({ fromSpentMicros: 45_000_000n, amountMicros: 15_000_001n })))
      .toEqual({ ok: false, reason: "exceeds-unspent" });
  });

  it("keeps the destination under the budget ceiling", () => {
    const plan = planBudgetMove(input({ maxBudgetMicros: 24_999_999n }));
    expect(plan).toEqual({ ok: false, reason: "budget-limit" });
  });

  it("refuses an ended campaign on either side", () => {
    expect(planBudgetMove(input({ from: campaign("camp-a", { status: "ended" }) })))
      .toEqual({ ok: false, reason: "invalid-state" });
    expect(planBudgetMove(input({ to: campaign("camp-b", { status: "ended" }) })))
      .toEqual({ ok: false, reason: "invalid-state" });
  });

  it("refuses a move to the same campaign, or of nothing", () => {
    expect(planBudgetMove(input({ to: campaign("camp-a") }))).toEqual({ ok: false, reason: "invalid-state" });
    expect(planBudgetMove(input({ amountMicros: 0n }))).toEqual({ ok: false, reason: "invalid-state" });
  });

  it("refuses another advertiser's campaign as missing", () => {
    expect(planBudgetMove(input({ to: campaign("camp-b", { advertiserId: "adv-2" }) })))
      .toEqual({ ok: false, reason: "not-found" });
  });
});

describe("parseBudgetMove", () => {
  it("accepts a whole number of micros to a different campaign", () => {
    expect(parseBudgetMove("camp-a", { toCampaignId: "camp-b", amountMicros: "5000000" }))
      .toEqual({ fromCampaignId: "camp-a", toCampaignId: "camp-b", amountMicros: "5000000" });
  });

  it("refuses nothing, a fraction, a number, a negative and the same campaign", () => {
    for (const amountMicros of ["0", "1.5", 5_000_000, "-5", "", "99999999999999999999"]) {
      expect(parseBudgetMove("camp-a", { toCampaignId: "camp-b", amountMicros })).toBeNull();
    }
    expect(parseBudgetMove("camp-a", { toCampaignId: "camp-a", amountMicros: "5" })).toBeNull();
    expect(parseBudgetMove("camp-a", { amountMicros: "5" })).toBeNull();
  });
});

describe("moveCampaignBudget", () => {
  let store: ReturnType<typeof createMemoryStore>;
  const deps = () => ({ store, clock: { now: () => 9_000 }, ids: { next: (p: string) => `${p}-1` } });

  beforeEach(async () => {
    store = createMemoryStore();
    await store.putAdvertiser(ADVERTISER);
    await store.putCampaign(campaign("camp-a"));
    await store.putCampaign(campaign("camp-b", { budgetMicros: 5_000_000n, status: "paused" }));
  });

  it("moves budget between two of the advertiser's campaigns and reports the new balance", async () => {
    await store.addSpend("camp-a", 10_000_000n);
    const moved = await moveCampaignBudget(deps(), "u-1", {
      fromCampaignId: "camp-a",
      toCampaignId: "camp-b",
      amountMicros: "20000000",
    });

    expect(moved).toMatchObject({
      ok: true,
      value: {
        advertiser: { reservedMicros: "40000000", availableMicros: "60000000" },
        from: { campaignId: "camp-a", budgetMicros: "40000000", status: "active" },
        to: { campaignId: "camp-b", budgetMicros: "25000000", status: "paused" },
      },
    });
    expect((await store.getCampaign("camp-a"))?.budgetMicros).toBe(40_000_000n);
    expect((await getMyAdvertiser(deps(), "u-1")).ok).toBe(true);
  });

  it("counts spend that settles before the move", async () => {
    await store.addSpend("camp-a", 50_000_000n);
    const moved = await moveCampaignBudget(deps(), "u-1", {
      fromCampaignId: "camp-a",
      toCampaignId: "camp-b",
      amountMicros: "10000001",
    });
    expect(moved).toEqual({ ok: false, error: "exceeds-unspent" });
  });

  it("never moves the same credits twice when two moves race", async () => {
    await store.putCampaign(campaign("camp-c", { status: "paused" }));
    const results = await Promise.all([
      moveCampaignBudget(deps(), "u-1", { fromCampaignId: "camp-a", toCampaignId: "camp-b", amountMicros: "40000000" }),
      moveCampaignBudget(deps(), "u-1", { fromCampaignId: "camp-a", toCampaignId: "camp-c", amountMicros: "40000000" }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect((await store.getCampaign("camp-a"))?.budgetMicros).toBe(20_000_000n);
  });

  it("reports another advertiser's campaign as missing, in either direction", async () => {
    await store.putAdvertiser({ ...ADVERTISER, advertiserId: "adv-2", ownerUids: ["u-2"] });
    await store.putCampaign(campaign("camp-x", { advertiserId: "adv-2" }));

    for (const [fromCampaignId, toCampaignId] of [["camp-a", "camp-x"], ["camp-x", "camp-a"]] as const) {
      expect(await moveCampaignBudget(deps(), "u-1", { fromCampaignId, toCampaignId, amountMicros: "1" }))
        .toEqual({ ok: false, error: "not-found" });
    }
    expect((await store.getCampaign("camp-x"))?.budgetMicros).toBe(60_000_000n);
  });

  it("refuses a suspended advertiser", async () => {
    await store.putAdvertiser({ ...ADVERTISER, status: "suspended" });
    expect(await moveCampaignBudget(deps(), "u-1", {
      fromCampaignId: "camp-a",
      toCampaignId: "camp-b",
      amountMicros: "1",
    })).toEqual({ ok: false, error: "suspended" });
  });
});

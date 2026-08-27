import { describe, it, expect } from "vitest";
import { runAuction, selectCampaigns, type Candidate } from "../src/targeting.ts";
import type { CampaignRecord } from "../src/store.ts";

const campaign = (id: string, cpm: bigint, tags: string[], budget = 1_000_000n): CampaignRecord => ({
  campaignId: id,
  advertiserId: "adv-1",
  name: id,
  createdAt: 0,
  cpmMicros: cpm,
  budgetMicros: budget,
  targetTags: tags,
  status: "active",
});

const candidate = (c: CampaignRecord, spent = 0n): Candidate => ({ campaign: c, spentMicros: spent });

describe("selectCampaigns", () => {
  it("ranks by CPM, highest first", () => {
    const picked = selectCampaigns(
      [
        candidate(campaign("low", 2_000_000n, ["lang:rust"])),
        candidate(campaign("high", 9_000_000n, ["lang:rust"])),
        candidate(campaign("mid", 5_000_000n, ["lang:rust"])),
      ],
      ["lang:rust"],
      3,
    );
    expect(picked.map((c) => c.campaignId)).toEqual(["high", "mid", "low"]);
  });

  it("breaks a CPM tie deterministically, so serving is reproducible", () => {
    const picked = selectCampaigns(
      [
        candidate(campaign("zebra", 5_000_000n, [])),
        candidate(campaign("apple", 5_000_000n, [])),
      ],
      [],
      2,
    );
    expect(picked.map((c) => c.campaignId)).toEqual(["apple", "zebra"]);
  });

  it("drops campaigns whose tags do not intersect the request", () => {
    const picked = selectCampaigns(
      [
        candidate(campaign("rust", 9_000_000n, ["lang:rust"])),
        candidate(campaign("php", 9_000_000n, ["lang:php"])),
      ],
      ["lang:rust"],
      5,
    );
    expect(picked.map((c) => c.campaignId)).toEqual(["rust"]);
  });

  it("keeps an untargeted campaign, which is how house ads reach anyone", () => {
    const picked = selectCampaigns([candidate(campaign("house", 1_000_000n, []))], ["lang:rust"], 5);
    expect(picked.map((c) => c.campaignId)).toEqual(["house"]);
  });

  it("drops a paused campaign even if it matches", () => {
    const paused = { ...campaign("paused", 9_000_000n, []), status: "paused" as const };
    expect(selectCampaigns([candidate(paused)], [], 5)).toEqual([]);
  });

  it("drops a campaign that has spent its budget", () => {
    const picked = selectCampaigns(
      [
        candidate(campaign("spent", 9_000_000n, ["lang:rust"], 5000n), 5000n),
        candidate(campaign("funded", 1_000_000n, ["lang:rust"], 5000n), 0n),
      ],
      ["lang:rust"],
      5,
    );
    expect(picked.map((c) => c.campaignId)).toEqual(["funded"]);
  });

  it("drops a campaign that cannot afford even one more impression", () => {
    // 8 CPM costs 8000 micros per impression; 100 micros left is not enough.
    const picked = selectCampaigns(
      [candidate(campaign("nearly", 8_000_000n, ["lang:rust"], 8000n), 7900n)],
      ["lang:rust"],
      5,
    );
    expect(picked).toEqual([]);
  });

  it("never returns more than asked for", () => {
    const picked = selectCampaigns(
      [candidate(campaign("a", 3_000_000n, [])), candidate(campaign("b", 2_000_000n, []))],
      [],
      1,
    );
    expect(picked).toHaveLength(1);
  });

  it("returns nothing when asked for nothing", () => {
    expect(selectCampaigns([candidate(campaign("a", 1_000_000n, []))], [], 0)).toEqual([]);
  });

  it("returns nothing when there are no candidates", () => {
    expect(selectCampaigns([], ["lang:rust"], 5)).toEqual([]);
  });
});

describe("runAuction", () => {
  const auction = (candidates: Candidate[], count = 1, tieSeed = "serve-1") =>
    runAuction({
      candidates,
      tags: ["lang:rust"],
      count,
      floorCpmMicros: 3_000_000n,
      incrementCpmMicros: 10_000n,
      tieSeed,
    });

  it("charges the winner one increment above the runner-up, capped at its bid", () => {
    const [winner] = auction([
      candidate(campaign("high", 8_000_000n, ["lang:rust"])),
      candidate(campaign("runner-up", 5_000_000n, ["lang:rust"])),
    ]);

    expect(winner).toMatchObject({
      maxBidCpmMicros: 8_000_000n,
      clearingCpmMicros: 5_010_000n,
      costMicros: 5_010n,
    });
  });

  it("uses the floor when there is no competing eligible bid", () => {
    const [winner] = auction([candidate(campaign("only", 8_000_000n, ["lang:rust"]))]);
    expect(winner?.clearingCpmMicros).toBe(3_000_000n);
    expect(winner?.costMicros).toBe(3_000n);
  });

  it("excludes bids below the market floor", () => {
    expect(auction([candidate(campaign("too-low", 2_990_000n, ["lang:rust"]))])).toEqual([]);
  });

  it("charges each batched winner from the next-ranked bid", () => {
    const winners = auction(
      [
        candidate(campaign("first", 9_000_000n, ["lang:rust"])),
        candidate(campaign("second", 7_000_000n, ["lang:rust"])),
        candidate(campaign("third", 4_000_000n, ["lang:rust"])),
      ],
      2,
    );

    expect(winners.map((winner) => winner.clearingCpmMicros)).toEqual([
      7_010_000n,
      4_010_000n,
    ]);
  });

  it("rotates equal bids deterministically across different serve seeds", () => {
    const candidates = [
      candidate(campaign("apple", 5_000_000n, ["lang:rust"])),
      candidate(campaign("zebra", 5_000_000n, ["lang:rust"])),
    ];
    const observed = new Set(
      Array.from({ length: 32 }, (_, index) => auction(candidates, 1, `serve-${index}`)[0]?.campaign.campaignId),
    );

    expect(observed).toEqual(new Set(["apple", "zebra"]));
    expect(auction(candidates, 1, "same-seed")[0]?.campaign.campaignId).toBe(
      auction(candidates, 1, "same-seed")[0]?.campaign.campaignId,
    );
  });
});

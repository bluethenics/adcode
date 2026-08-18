import { describe, it, expect } from "vitest";
import { selectCampaigns, type Candidate } from "../src/targeting.ts";
import type { CampaignRecord } from "../src/store.ts";

const campaign = (id: string, cpm: bigint, tags: string[], budget = 1_000_000n): CampaignRecord => ({
  campaignId: id,
  advertiserId: "adv-1",
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

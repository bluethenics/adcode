import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignBudgetMove } from "../src/components/CampaignBudgetMove";
import {
  checkMove,
  describeMove,
  dollarsInput,
  moveTargets,
  unspentMicros,
} from "../src/lib/budgetMove";
import type { AdvertiserView, CampaignView } from "../src/lib/api";

const campaign = (campaignId: string, over: Partial<CampaignView> = {}): CampaignView => ({
  campaignId,
  name: campaignId,
  status: "active",
  cpmMicros: "8000000",
  budgetMicros: "60000000",
  spentMicros: "10000000",
  targetTags: [],
  createdAt: 1,
  serves: 0,
  impressions: 0,
  clicks: 0,
  ...over,
});

const advertiser: AdvertiserView = {
  advertiserId: "adv-1",
  name: "Acme",
  status: "active",
  fundedMicros: "100000000",
  reservedMicros: "70000000",
  availableMicros: "30000000",
};

describe("moving credits between campaigns", () => {
  it("offers every other campaign that can still hold a budget", () => {
    const all = [campaign("a"), campaign("b", { status: "paused" }), campaign("c", { status: "ended" })];
    expect(moveTargets(all, all[0]!).map((c) => c.campaignId)).toEqual(["b"]);
  });

  it("moves only what is unspent, and never less than nothing", () => {
    expect(unspentMicros(campaign("a"))).toBe(50_000_000n);
    expect(unspentMicros(campaign("a", { spentMicros: "70000000" }))).toBe(0n);
  });

  it("fills 'all unspent' with the exact figure, sub-cent spend included", () => {
    expect(dollarsInput(40_000_000n)).toBe("40.00");
    expect(dollarsInput(12_345_678n)).toBe("12.345678");
    expect(dollarsInput(500_000n)).toBe("0.50");
  });

  it("says why a move would be refused before it is sent", () => {
    const from = campaign("a");
    expect(checkMove(from, campaign("b"), 0n, advertiser).ok).toBe(false);
    expect(checkMove(from, campaign("b"), 50_000_001n, advertiser)).toMatchObject({ ok: false });
    expect(checkMove(from, campaign("b", { budgetMicros: "99990000000" }), 20_000_000n, advertiser))
      .toMatchObject({ ok: false });
    expect(checkMove(from, campaign("b"), 50_000_000n, advertiser)).toEqual({ ok: true });
  });

  it("asks a paused-to-live move to fit what is available", () => {
    const paused = campaign("a", { status: "paused" });
    expect(checkMove(paused, campaign("b"), 30_000_000n, advertiser)).toEqual({ ok: true });
    expect(checkMove(paused, campaign("b"), 30_000_001n, advertiser)).toMatchObject({ ok: false });
  });

  it("explains what the move does to the balance in each case", () => {
    const live = campaign("Live");
    const paused = campaign("Paused", { status: "paused" });
    expect(describeMove(live, campaign("Other"), 5_000_000n)).toMatch(/stays the same/);
    expect(describeMove(live, paused, 5_000_000n)).toMatch(/comes back to your available balance/);
    expect(describeMove(paused, live, 5_000_000n)).toMatch(/committed from your available balance/);
    expect(describeMove(paused, campaign("P2", { status: "paused" }), 5_000_000n)).toMatch(/Neither campaign is live/);
  });
});

describe("the Move credits control", () => {
  const render = (from: CampaignView, all: CampaignView[]): string =>
    renderToStaticMarkup(<CampaignBudgetMove campaign={from} campaigns={all} advertiser={advertiser} onMoved={() => {}} />);

  it("offers the other campaigns, the amount, and all of the unspent budget", () => {
    const from = campaign("Launch");
    const html = render(from, [from, campaign("Rust devs", { status: "paused", budgetMicros: "5000000" })]);
    expect(html).toContain("Move credits to another campaign");
    expect(html).toContain("Rust devs · Paused · $5.00 budget");
    expect(html).toContain("All unspent ($50.00)");
    expect(html).toContain("Up to $50.00 can move.");
  });

  it("is not offered on an ended campaign", () => {
    const from = campaign("Done", { status: "ended" });
    expect(render(from, [from, campaign("b")])).toBe("");
  });

  it("points to creating a second campaign when there is nowhere to move to", () => {
    const from = campaign("Only");
    expect(render(from, [from, campaign("Old", { status: "ended" })])).toContain('href="#new-campaign"');
  });

  it("says so when the whole budget is spent", () => {
    const from = campaign("Spent", { spentMicros: "60000000" });
    expect(render(from, [from, campaign("b")])).toContain("no credits left to move");
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PricingPage, { metadata } from "../src/app/pricing/page";
import { PricingContent } from "../src/app/pricing/PricingContent";
import { FreePlan } from "../src/components/FreePlan";
import { selectedPricingPlan } from "../src/app/ai-tokens/AiTokens";
import { PlanCards } from "../src/app/ai-tokens/Plans";
import { pricingOffer } from "../src/lib/pricingOffer";
import { FREE_WEEKLY_TOKENS, PLANS, STANDARD_PRICING } from "../src/lib/pricing";
import { readApi } from "../src/lib/apiRead";
import { FAQ } from "../src/lib/schema";
import { url } from "../src/lib/site";

vi.mock("../src/lib/apiRead", () => ({ readApi: vi.fn() }));
afterEach(() => vi.resetAllMocks());

describe("public pricing and existing checkout", () => {
  it("shows the complete source catalogue without requiring sign-in or a successful API call", async () => {
    vi.mocked(readApi).mockRejectedValue(new Error("offline"));
    const html = renderToStaticMarkup(await PricingPage());
    expect(metadata.alternates?.canonical).toBe(url("/pricing"));
    for (const amount of ["$3", "$9", "$29", "$10", "$25", "$50", "5M", "20M", "100M", "Unlimited", "55M", "154M", "330M"]) expect(html).toContain(amount);
    expect(html).toContain("Weekly and Monthly refill each day; Pro has unlimited tokens");
    expect(html).toContain("Purchased tokens never expire");
    expect(html).toContain("The standard catalogue is shown");
    expect(html).not.toContain("Sign in to see");
    for (const plan of PLANS) expect(html).toContain(`href="/ai-tokens?plan=${plan.id}#plans"`);
    expect(html).toContain("first subscription becomes active while your Pro plan is active");
    expect(html).toContain("4.4M extra tokens");
    expect(html).toContain("Each friend can earn the reward once");
  });

  it("uses the current bounded sale configuration and explains a sales pause", async () => {
    vi.mocked(readApi).mockResolvedValue(Response.json({ paid: { enabled: false, providers: ["custom-heabsy"], freeWeeklyTokens: 12_000_000, packs: [{ id: "extra", priceCents: 1250, tokens: 55_000_000 }] } }));
    const offer = await pricingOffer();
    expect(readApi).toHaveBeenCalledWith("/v1/ai/tagflow/config", 60);
    const html = renderToStaticMarkup(<PricingContent offer={offer} />);
    expect(html).toContain("12M free tokens each day");
    expect(html).toContain("55M"); expect(html).toContain("$12.50 once");
    expect(html).not.toContain("330M");
    expect(html).toContain("Plan and token sales are temporarily paused");
    expect(html).not.toContain("standard catalogue is shown");
  });

  it("falls back safely instead of rendering malformed or unsafe advertised products", async () => {
    for (const body of [null, { paid: null }, { paid: { enabled: true, providers: ["custom-heabsy"], freeWeeklyTokens: 5_000_000, packs: [{ id: "https://bad.example", priceCents: 1, tokens: -1 }] } }]) {
      vi.mocked(readApi).mockResolvedValue(Response.json(body));
      expect(await pricingOffer()).toBe(STANDARD_PRICING);
    }
    vi.mocked(readApi).mockResolvedValue(new Response(null, { status: 503 }));
    expect(await pricingOffer()).toBe(STANDARD_PRICING);
  });

  it("carries only a recognized plan to review and does not confuse it with a paid checkout return", () => {
    expect(selectedPricingPlan("?plan=pro")).toBe("pro");
    expect(selectedPricingPlan("?plan=monthly")).toBe("monthly");
    expect(selectedPricingPlan("?plan=invalid")).toBeNull();
    expect(selectedPricingPlan("?plan=pro&order=aip_123")).toBeNull();
    const html = renderToStaticMarkup(<PlanCards plans={PLANS} current={null} busy={null} selected="pro" onChoose={() => undefined} />);
    expect(html.match(/data-selected="true"/g)).toHaveLength(1);
    expect(html).toContain("Selected from pricing");
    expect(html).toContain("Choose Pro");
    expect(html).not.toContain("Opening checkout");
  });

  it("keeps homepage and search answers honest about free access and optional paid AI", () => {
    const html = renderToStaticMarkup(<FreePlan />);
    expect(FREE_WEEKLY_TOKENS).toBe(5_000_000);
    expect(html).toContain("5M"); expect(html).toContain('href="/pricing"');
    expect(html).not.toContain("Start with unlimited included AI");
    const facts = FAQ.map(item => item.a).join("\n");
    expect(facts).toContain("Weekly $3/week");
    expect(facts).toContain("Monthly $9/month");
    expect(facts).toContain("Pro $29/month");
    expect(facts).not.toContain("no paid tier");
    expect(facts).not.toContain("no subscription, no trial");
  });
});
